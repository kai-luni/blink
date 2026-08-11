import type { FimParts, ManagedClient } from "../types.js";
import {
  requestTimeoutFor,
  type ModelConfig,
  type OpenAiModelConfig,
} from "../../config/models.js";
import type { ILogger } from "../../common/logging.js";
import { writeLlmLog } from "../../common/llmDebugLog.js";

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

export class OpenAICompletionClient implements ManagedClient {
  private opts: OpenAiOpts | undefined;
  private model: OpenAiModelConfig | undefined;

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

    const usesPrefixSuffix =
      opts.promptStyle === "prefix-suffix" &&
      parts !== undefined;

    const usesDeepSeekFim =
      opts.promptStyle === "raw" &&
      this.isDeepSeekFimModel(opts.model) &&
      parts !== undefined;

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

      const text = data.choices?.[0]?.text;

      return typeof text === "string"
        ? text
        : "";
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
     * Example:
     *
     * <｜fim▁begin｜>
     * prefix
     * <｜fim▁hole｜>
     * suffix
     * <｜fim▁end｜>
     *
     * Important:
     * These characters are intentional. Do not replace the full-width
     * vertical bars or the ▁ character with ordinary ASCII characters.
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
        max_tokens: opts.maxTokens,
        temperature: 0.1,
        frequency_penalty: 0.2,
        ...(stop.length > 0 ? { stop } : {}),
      };
    }

    /*
     * Native prefix/suffix API, e.g. Mistral Codestral.
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
     *
     * The prompt has already been rendered by Blink.
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