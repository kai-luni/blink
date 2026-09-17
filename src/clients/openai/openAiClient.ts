import type { FimParts, ManagedClient } from "../types.js";
import {
  requestTimeoutFor,
  type ModelConfig,
  type OpenAiModelConfig,
} from "../../config/models.js";
import type { ILogger } from "../../common/logging.js";
import { writeLlmLog } from "../../common/llmDebugLog.js";
import { suffixVerdict, type SuffixSupport } from "../../completion/suffixSupport.js";

interface OpenAiOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  promptStyle: "raw" | "prefix-suffix";
}

interface CompletionResponse {
  choices?: Array<{
    text?: string;
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const DEEPSEEK_FIM_BEGIN = "<｜fim▁begin｜>";
const DEEPSEEK_FIM_HOLE = "<｜fim▁hole｜>";
const DEEPSEEK_FIM_END = "<｜fim▁end｜>";

/**
 * Ghost text is a few lines at most. Measured 2026-09-17 against Nebius: with the
 * entry's 25600 the model kept writing whole blocks (and repeated them) whenever it
 * left the FIM hole; 512 bounds the request without cutting a plausible block off.
 */
const DEEPSEEK_FIM_MAX_TOKENS = 512;

/**
 * Stop at the first blank line as well. The DeepSeek prompt carries the open-tabs
 * context, and without this the model continues that document instead of filling the
 * hole (measured: 1139 -> 111 characters of output; both line endings, because the
 * files arrive with \r\n).
 */
const DEEPSEEK_FIM_EXTRA_STOP = ["\n\n", "\r\n\r\n"];

/** Suffix sent with the probe: long enough to visibly move the prompt token count. */
const PROBE_SUFFIX = "// suffix support probe line\n".repeat(8);

export class OpenAICompletionClient implements ManagedClient {
  private opts: OpenAiOpts | undefined;
  private model: OpenAiModelConfig | undefined;
  private suffixSupport: SuffixSupport = "unknown";
  private probeInFlight: Promise<SuffixSupport> | undefined;

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly logger?: ILogger,
  ) {}

  setConfig(model: ModelConfig): void {
    const m = model as OpenAiModelConfig;

    this.model = m;

    this.opts = {
      baseUrl: m.apiBaseUrl,
      apiKey: m.apiKey,
      model: m.modelId,
      maxTokens: m.maxTokens,
      timeoutMs: requestTimeoutFor(m),
      promptStyle: m.promptStyle ?? "raw",
    };
    // A new entry may point at a different endpoint: forget the old verdict.
    this.suffixSupport = "unknown";
    this.probeInFlight = undefined;
  }

  onLoadError(): void {
    // Stateless HTTP client.
  }

  async dispose(): Promise<void> {
    // Stateless HTTP client.
  }

  public get config(): ModelConfig | undefined {
    return this.model;
  }

  public async getFimPrefix(): Promise<string | null> {
    return this.model?.fim ?? null;
  }

  /**
   * One-time capability check for `promptStyle: "prefix-suffix"`. A provider that
   * does not support the field accepts it (additionalProperties: true) and drops
   * it without any error, so the only way to know is to send the same prompt
   * twice — once with a long suffix — and compare `usage.prompt_tokens`. Never
   * throws; "unknown" leaves the request shape exactly as it was.
   */
  async probeSuffixSupport(): Promise<SuffixSupport> {
    const opts = this.opts;

    if (!opts || opts.promptStyle !== "prefix-suffix") {
      return this.suffixSupport;
    }

    if (this.suffixSupport !== "unknown") {
      return this.suffixSupport;
    }

    this.probeInFlight ??= this.runProbe(opts);

    const verdict = await this.probeInFlight;

    this.probeInFlight = undefined;
    this.suffixSupport = verdict;

    await writeLlmLog("SUFFIX_PROBE", {
      url: this.buildCompletionUrl(opts.baseUrl),
      model: opts.model,
      verdict,
      probeSuffixChars: PROBE_SUFFIX.length,
    });

    if (verdict === "ignored") {
      this.logger?.error(
        `blink: ${opts.baseUrl} ignores the "suffix" field (usage.prompt_tokens is the same with and ` +
        `without it) — the code after the cursor never reaches the model. Falling back to a locally ` +
        `templated prompt; set "promptStyle": "raw" for this entry to make that explicit.`,
      );
    }

    return verdict;
  }

  private async runProbe(opts: OpenAiOpts): Promise<SuffixSupport> {
    const [withSuffix, without] = await Promise.all([
      this.probeOnce(opts, PROBE_SUFFIX),
      this.probeOnce(opts, undefined),
    ]);

    return suffixVerdict(withSuffix, without);
  }

  /** One probe request; returns usage.prompt_tokens, or undefined on any failure. */
  private async probeOnce(
    opts: OpenAiOpts,
    suffix: string | undefined,
  ): Promise<number | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, opts.timeoutMs);

    try {
      const res = await this.fetchFn(this.buildCompletionUrl(opts.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          prompt: "probe",
          ...(suffix ? { suffix } : {}),
          max_tokens: 1,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        return undefined;
      }

      const data = (await res.json()) as CompletionResponse;

      return data.usage?.prompt_tokens;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(
    prompt: string,
    stop: string[],
    signal: AbortSignal,
    parts?: FimParts,
  ): Promise<string> {
    const opts = this.opts;

    if (!opts) {
      return "";
    }

    /*
     * A prefix-suffix entry behind an endpoint that drops the suffix (probed
     * once per config change) must not go out as prefix-only — the code after
     * the cursor would be missing. DeepSeek models then get the native FIM
     * tokens instead, everything else the locally templated prompt.
     */
    const suffixIgnored =
      opts.promptStyle === "prefix-suffix" &&
      this.suffixSupport === "ignored";

    const usesPrefixSuffix =
      opts.promptStyle === "prefix-suffix" &&
      !suffixIgnored &&
      parts !== undefined;

    const usesDeepSeekFim =
      parts !== undefined &&
      !usesPrefixSuffix &&
      this.isDeepSeekFimModel(opts.model);

    const url = this.buildCompletionUrl(opts.baseUrl);

    const requestBody = this.buildCompletionRequest(
      opts,
      prompt,
      stop,
      parts,
      usesPrefixSuffix,
      usesDeepSeekFim,
    );

    const internalController = new AbortController();

    const timer = setTimeout(() => {
      internalController.abort();
    }, opts.timeoutMs);

    const onAbort = () => {
      internalController.abort();
    };

    signal.addEventListener("abort", onAbort);

    if (signal.aborted) {
      internalController.abort();
    }

    try {
      if (internalController.signal.aborted) {
        return "";
      }

      await writeLlmLog("HTTP_REQUEST", {
        url,
        method: "POST",
        promptStyle: opts.promptStyle,
        usesPrefixSuffix,
        usesDeepSeekFim,
        requestBody,
      });

      const res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: internalController.signal,
      });

      const rawBody = await res.text();

      if (!res.ok) {
        await writeLlmLog("HTTP_RAW_RESPONSE", {
          status: res.status,
          statusText: res.statusText,
          body: rawBody,
        });

        this.logger?.info(
          `openai completion failed: HTTP ${res.status} ${rawBody.slice(0, 200)}`,
        );

        return "";
      }

      let data: CompletionResponse;

      try {
        data = JSON.parse(rawBody) as CompletionResponse;
      } catch (error) {
        await writeLlmLog("HTTP_RAW_RESPONSE", {
          status: res.status,
          statusText: res.statusText,
          body: rawBody,
          parseError: String(error),
        });

        this.logger?.info(
          `openai completion returned invalid JSON: ${String(error)}`,
        );

        return "";
      }

      await writeLlmLog("HTTP_RAW_RESPONSE", {
        status: res.status,
        statusText: res.statusText,
        body: rawBody,
        data,
      });

      const choice = data.choices?.[0];

      return choice?.text ?? choice?.message?.content ?? "";
    } catch (error) {
      await writeLlmLog("HTTP_ERROR", {
        url,
        error: String(error),
        aborted: internalController.signal.aborted,
        timeoutMs: opts.timeoutMs,
      });

      this.logger?.info(
        `openai completion failed: ${String(error)}`,
      );

      return "";
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  private buildCompletionUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, "");

    if (base.endsWith("/completions")) {
      return base;
    }

    return `${base}/completions`;
  }

  private buildCompletionRequest(
    opts: OpenAiOpts,
    prompt: string,
    stop: string[],
    parts: FimParts | undefined,
    usesPrefixSuffix: boolean,
    usesDeepSeekFim: boolean,
  ): Record<string, unknown> {
    /*
     * DeepSeek native FIM.
     *
     * Format:
     *
     * <｜fim▁begin｜>prefix<｜fim▁hole｜>suffix<｜fim▁end｜>
     *
     * Important:
     * The full-width vertical bars and ▁ character are intentional.
     */
    if (usesDeepSeekFim && parts) {
      const fimPrompt =
        DEEPSEEK_FIM_BEGIN +
        parts.prefix +
        DEEPSEEK_FIM_HOLE +
        parts.suffix +
        DEEPSEEK_FIM_END;

      return {
        model: opts.model,
        prompt: fimPrompt,
        max_tokens: Math.min(opts.maxTokens, DEEPSEEK_FIM_MAX_TOKENS),
        /*
         * 0.2, not 0.5: raising it made the model repeat the last line instead of
         * filling the hole (measured: temperature 0.7 -> "export" 28 times in a row).
         */
        temperature: 0.2,
        frequency_penalty: 0.2,
        repetition_penalty: 1.05,
        stop: [...new Set([...stop, DEEPSEEK_FIM_END, ...DEEPSEEK_FIM_EXTRA_STOP])],
      };
    }

    /*
     * Native prefix/suffix API.
     *
     * Used by Mistral Codestral.
     */
    if (usesPrefixSuffix && parts) {
      const completionInstruction =
        "// Use English for new comments unless surrounding comments use another language.\n";

      return {
        model: opts.model,
        prompt: `${completionInstruction}${parts.prefix}`,
        suffix: parts.suffix,
        max_tokens: opts.maxTokens,
        temperature: 0,
        ...(stop.length > 0 ? { stop } : {}),
      };
    }

    /*
     * Generic raw completion.
     */
    return {
      model: opts.model,
      prompt,
      max_tokens: opts.maxTokens,
      temperature: 0,
      ...(stop.length > 0 ? { stop } : {}),
    };
  }

  private isDeepSeekFimModel(model: string): boolean {
    return (
      /^deepseek-ai\/deepseek-v4/i.test(model) ||
      /^deepseek-v4/i.test(model)
    );
  }
}