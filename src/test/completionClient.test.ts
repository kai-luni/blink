import * as assert from "assert";
import { OpenAICompletionClient } from "../clients/openai/openAiClient.js";
import { openAiModel } from "./fixtures.js";

function fakeFetch(captured: { url?: string; body?: any; headers?: any }) {
  return async (url: any, init: any): Promise<Response> => {
    captured.url = String(url);
    captured.headers = init.headers;
    captured.body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ choices: [{ text: "  completed()" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

suite("OpenAICompletionClient", () => {
  test("POSTs to /v1/completions with prompt, model, stop and bearer key", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({
      apiBaseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId: "qwen2.5-coder",
      maxTokens: 256,
      requestTimeoutMs: 3000,
    }));

    const text = await client.complete("PROMPT", ["<|endoftext|>"], new AbortController().signal);

    assert.strictEqual(text, "  completed()");
    assert.strictEqual(captured.url, "https://api.example.com/v1/completions");
    assert.strictEqual(captured.body.model, "qwen2.5-coder");
    assert.strictEqual(captured.body.prompt, "PROMPT");
    assert.strictEqual(captured.body.max_tokens, 256);
    assert.strictEqual(captured.body.temperature, 0);
    assert.deepStrictEqual(captured.body.stop, ["<|endoftext|>"]);
    assert.strictEqual(captured.headers.Authorization, "Bearer sk-test");
  });

  test("returns '' when complete is called before setConfig", async () => {
    const client = new OpenAICompletionClient((async () => new Response("{}")) as any);
    const text = await client.complete("p", [], new AbortController().signal);
    assert.strictEqual(text, "");
  });

  test("returns empty string on a non-200 response", async () => {
    const errFetch = async (): Promise<Response> =>
      new Response("rate limited", { status: 429 });
    const client = new OpenAICompletionClient(errFetch as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    const text = await client.complete("P", [], new AbortController().signal);
    assert.strictEqual(text, "");
  });

  test("normalizes a baseUrl that already ends with a slash", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://api.example.com/v1/", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    await client.complete("P", [], new AbortController().signal);
    assert.strictEqual(captured.url, "https://api.example.com/v1/completions");
  });

  test("uses an apiBaseUrl that already ends with /completions as-is (Mistral-style full URL)", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://api.mistral.ai/v1/fim/completions", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    await client.complete("P", [], new AbortController().signal);
    assert.strictEqual(captured.url, "https://api.mistral.ai/v1/fim/completions");
  });

  test("prefix-suffix style sends the raw prefix as prompt and the suffix separately", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({ promptStyle: "prefix-suffix", apiBaseUrl: "https://api.mistral.ai/v1/fim", apiKey: "k", modelId: "codestral-2508", maxTokens: 10, requestTimeoutMs: 1000 }));
    await client.complete("RENDERED", ["</s>"], new AbortController().signal, { prefix: "const x = ", suffix: ";" });
    // The entry prepends a completion instruction to the prefix.
    assert.ok(
      String(captured.body.prompt).endsWith("const x = "),
      `expected the prefix at the end of the prompt, got: ${JSON.stringify(captured.body.prompt)}`,
    );
    assert.strictEqual(captured.body.suffix, ";");
    assert.deepStrictEqual(captured.body.stop, ["</s>"]);
  });

  test("raw style (default) sends the rendered prompt and no suffix field even when parts are given", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    await client.complete("RENDERED", [], new AbortController().signal, { prefix: "PRE", suffix: "SUF" });
    assert.strictEqual(captured.body.prompt, "RENDERED");
    assert.strictEqual("suffix" in captured.body, false);
  });

  test("prefix-suffix style falls back to the rendered prompt when no parts are given", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({ promptStyle: "prefix-suffix", apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    await client.complete("RENDERED", [], new AbortController().signal);
    assert.strictEqual(captured.body.prompt, "RENDERED");
    assert.strictEqual("suffix" in captured.body, false);
  });

  test("parses a chat-shaped response (choices[].message.content) like Mistral's FIM endpoint returns", async () => {
    const chatFetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          object: "chat.completion",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "DONE" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const client = new OpenAICompletionClient(chatFetch as any);
    client.setConfig(openAiModel({ promptStyle: "prefix-suffix", apiBaseUrl: "https://api.mistral.ai/v1/fim", apiKey: "k", modelId: "codestral-2508", maxTokens: 10, requestTimeoutMs: 1000 }));
    const text = await client.complete("P", [], new AbortController().signal, { prefix: "p", suffix: "s" });
    assert.strictEqual(text, "DONE");
  });

  test("logs the status and a body snippet on a non-OK response", async () => {
    const messages: string[] = [];
    const errFetch = async (): Promise<Response> =>
      new Response("Unauthorized: invalid api key", { status: 401 });
    const client = new OpenAICompletionClient(errFetch as any, {
      info: (m: string) => messages.push(m),
      error: (m: string) => messages.push(m),
    });
    client.setConfig(openAiModel({ apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    const text = await client.complete("P", [], new AbortController().signal);
    assert.strictEqual(text, "");
    assert.ok(
      messages.some((m) => m.includes("401") && m.includes("Unauthorized")),
      `expected a log line with status and body, got: ${JSON.stringify(messages)}`,
    );
  });

  test("does not abort a slow response when the model entry omits requestTimeoutMs (backend default applies)", async () => {
    const slowFetch = (_url: any, init: any): Promise<Response> =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        setTimeout(() => resolve(new Response(
          JSON.stringify({ choices: [{ text: "SLOW-OK" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        )), 30);
      });
    const client = new OpenAICompletionClient(slowFetch as any);
    client.setConfig(openAiModel({
      apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10,
      requestTimeoutMs: undefined as unknown as number,
    }));
    const text = await client.complete("P", [], new AbortController().signal);
    assert.strictEqual(text, "SLOW-OK");
  });

  test("aborts when the configured requestTimeoutMs elapses", async () => {
    const slowFetch = (_url: any, init: any): Promise<Response> =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        setTimeout(() => resolve(new Response("{}", { status: 200 })), 300);
      });
    const client = new OpenAICompletionClient(slowFetch as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 20 }));
    const text = await client.complete("P", [], new AbortController().signal);
    assert.strictEqual(text, "");
  });

  test("returns empty string when the caller signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let fetchCalled = false;
    const hangFetch = (() => {
      fetchCalled = true;
      return new Promise<Response>(() => {}); // never resolves
    });
    const client = new OpenAICompletionClient(hangFetch as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://x/v1", apiKey: "k", modelId: "m", maxTokens: 10, requestTimeoutMs: 60000 }));
    const text = await client.complete("P", [], ctrl.signal);
    assert.strictEqual(text, "");
    void fetchCalled;
  });
});

/** Probe pair: answers `usage.prompt_tokens` per request, suffix-aware. */
function probeFetch(tokens: { withSuffix: number; withoutSuffix: number }) {
  const seen: any[] = [];
  const fn = async (_url: any, init: any): Promise<Response> => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const prompt_tokens = "suffix" in body ? tokens.withSuffix : tokens.withoutSuffix;
    return new Response(
      JSON.stringify({ choices: [{ text: "" }], usage: { prompt_tokens } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fn, seen };
}

const DS_BEGIN = "<\uff5cfim\u2581begin\uff5c>";
const DS_HOLE = "<\uff5cfim\u2581hole\uff5c>";
const DS_END = "<\uff5cfim\u2581end\uff5c>";

suite("OpenAICompletionClient — suffix support probe", () => {
  const entry = (over: any = {}) => openAiModel({
    promptStyle: "prefix-suffix", apiBaseUrl: "https://api.example.com/v1",
    modelId: "m", maxTokens: 10, requestTimeoutMs: 1000, ...over,
  });

  test("reports 'ignored' when the token count does not move", async () => {
    const { fn, seen } = probeFetch({ withSuffix: 12, withoutSuffix: 12 });
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(entry());
    assert.strictEqual(await client.probeSuffixSupport(), "ignored");
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(typeof seen[0].suffix, "string");
    assert.strictEqual("suffix" in seen[1], false);
  });

  test("reports 'accepted' when the suffix enlarges the prompt", async () => {
    const { fn } = probeFetch({ withSuffix: 47, withoutSuffix: 12 });
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(entry());
    assert.strictEqual(await client.probeSuffixSupport(), "accepted");
  });

  test("probes once and caches the verdict", async () => {
    const { fn, seen } = probeFetch({ withSuffix: 12, withoutSuffix: 12 });
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(entry());
    await client.probeSuffixSupport();
    await client.probeSuffixSupport();
    assert.strictEqual(seen.length, 2);
  });

  test("raw entries never probe (no request leaves the client)", async () => {
    let called = 0;
    const fn = async (): Promise<Response> => { called++; return new Response("{}", { status: 200 }); };
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(openAiModel({ apiBaseUrl: "https://x/v1", modelId: "m", maxTokens: 10, requestTimeoutMs: 1000 }));
    assert.strictEqual(await client.probeSuffixSupport(), "unknown");
    assert.strictEqual(called, 0);
  });

  test("keeps 'unknown' when the provider returns no usage block", async () => {
    const fn = async (): Promise<Response> =>
      new Response(JSON.stringify({ choices: [{ text: "" }] }), { status: 200 });
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(entry());
    assert.strictEqual(await client.probeSuffixSupport(), "unknown");
  });

  test("names the provider and the fix in the log when the suffix is ignored", async () => {
    const messages: string[] = [];
    const { fn } = probeFetch({ withSuffix: 12, withoutSuffix: 12 });
    const client = new OpenAICompletionClient(fn as any, {
      info: (m: string) => messages.push(m),
      error: (m: string) => messages.push(m),
    });
    client.setConfig(entry());
    await client.probeSuffixSupport();
    assert.ok(
      messages.some((m) => m.includes("suffix") && m.includes("raw")),
      `expected a warning naming the field and the fix, got: ${JSON.stringify(messages)}`,
    );
  });

  test("a prefix-suffix entry keeps the context inside the prompt (no FIM markers there)", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(openAiModel({
      promptStyle: "prefix-suffix", apiBaseUrl: "https://api.mistral.ai/v1/fim/completions",
      modelId: "codestral-latest", maxTokens: 10, requestTimeoutMs: 1000,
    }));
    await client.complete("RENDERED", [], new AbortController().signal, {
      prefix: "const x = ", suffix: ";", contextPrefix: "### package.json\n{}",
    });
    const prompt = String(captured.body.prompt);
    assert.ok(prompt.includes("### package.json"), `context lost: ${JSON.stringify(prompt)}`);
    assert.ok(prompt.endsWith("const x = "), `prefix missing: ${JSON.stringify(prompt)}`);
    assert.strictEqual(captured.body.suffix, ";");
  });

  test("after an 'ignored' verdict a plain prefix-suffix entry falls back to the rendered prompt", async () => {
    const captured: any = {};
    let calls = 0;
    const fn = async (_url: any, init: any): Promise<Response> => {
      const body = JSON.parse(init.body);
      calls++;
      if (calls <= 2) {
        return new Response(
          JSON.stringify({ choices: [{ text: "" }], usage: { prompt_tokens: 12 } }),
          { status: 200 },
        );
      }
      captured.body = body;
      return new Response(JSON.stringify({ choices: [{ text: "OK" }] }), { status: 200 });
    };
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(entry({ apiBaseUrl: "https://api.tokenfactory.nebius.com/v1" }));
    await client.probeSuffixSupport();
    const text = await client.complete("RENDERED", [], new AbortController().signal, { prefix: "PRE", suffix: "SUF" });
    assert.strictEqual(text, "OK");
    assert.strictEqual(captured.body.prompt, "RENDERED");
    assert.strictEqual("suffix" in captured.body, false);
  });

  test("after an 'ignored' verdict a DeepSeek entry falls back to the native FIM tokens", async () => {
    const captured: any = {};
    let calls = 0;
    const fn = async (_url: any, init: any): Promise<Response> => {
      const body = JSON.parse(init.body);
      calls++;
      if (calls <= 2) {
        return new Response(
          JSON.stringify({ choices: [{ text: "" }], usage: { prompt_tokens: 12 } }),
          { status: 200 },
        );
      }
      captured.body = body;
      return new Response(JSON.stringify({ choices: [{ text: "OK" }] }), { status: 200 });
    };
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(entry({
      apiBaseUrl: "https://api.tokenfactory.nebius.com/v1",
      modelId: "deepseek-ai/DeepSeek-V4.1-Flash",
    }));
    await client.probeSuffixSupport();
    await client.complete("RENDERED", [], new AbortController().signal, { prefix: "PRE", suffix: "SUF" });
    assert.strictEqual(captured.body.prompt, DS_BEGIN + "PRE" + DS_HOLE + "SUF" + DS_END);
    assert.strictEqual("suffix" in captured.body, false);
  });
});

suite("OpenAICompletionClient — DeepSeek-V4.1-Flash (Nebius)", () => {
  const deepSeekEntry = (over: any = {}) => openAiModel({
    promptStyle: "raw",
    apiBaseUrl: "https://api.tokenfactory.nebius.com/v1",
    modelId: "deepseek-ai/DeepSeek-V4.1-Flash",
    maxTokens: 10, requestTimeoutMs: 1000, ...over,
  });

  test("raw mode renders the native DeepSeek FIM prompt, not the generic template", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry());
    await client.complete("GENERIC-RENDERED", [], new AbortController().signal, { prefix: "def f():\n    return ", suffix: "\n\nx = 1\n" });
    assert.strictEqual(captured.body.prompt, DS_BEGIN + "def f():\n    return " + DS_HOLE + "\n\nx = 1\n" + DS_END);
    assert.strictEqual("suffix" in captured.body, false);
  });

  test("raw mode never probes (the endpoint contract is not needed)", async () => {
    let called = 0;
    const fn = async (): Promise<Response> => { called++; return new Response("{}", { status: 200 }); };
    const client = new OpenAICompletionClient(fn as any);
    client.setConfig(deepSeekEntry());
    assert.strictEqual(await client.probeSuffixSupport(), "unknown");
    assert.strictEqual(called, 0);
  });

  test("stop carries the FIM end token, deduplicated — the blank-line stops are gone", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry());
    await client.complete("P", ["</s>", "\n\n"], new AbortController().signal, { prefix: "a", suffix: "b" });
    // The engine's stop list passes through, plus the FIM end marker; a blank line is
    // NOT a stop any more (removed in 3fcd7a2), so multi-block answers survive.
    assert.deepStrictEqual(captured.body.stop, ["</s>", "\n\n", DS_END]);
  });

  test("max_tokens is capped for the FIM path (measured: 512 yielded 1700-character answers)", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry({ maxTokens: 25600 }));
    await client.complete("P", [], new AbortController().signal, { prefix: "a", suffix: "b" });
    assert.strictEqual(captured.body.max_tokens, 192);
  });

  test("a smaller maxTokens from the entry wins over the cap", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry({ maxTokens: 64 }));
    await client.complete("P", [], new AbortController().signal, { prefix: "a", suffix: "b" });
    assert.strictEqual(captured.body.max_tokens, 64);
  });

  test("temperature stays low (0.2) — raising it made the model repeat instead of filling", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry());
    await client.complete("P", [], new AbortController().signal, { prefix: "a", suffix: "b" });
    assert.strictEqual(captured.body.temperature, 0.2);
  });

  test("a lowercase model id from another gateway is detected too", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry({ apiBaseUrl: "https://api.deepseek.com/beta", modelId: "deepseek-v4-pro" }));
    await client.complete("GENERIC", [], new AbortController().signal, { prefix: "a", suffix: "b" });
    assert.strictEqual(captured.body.prompt, DS_BEGIN + "a" + DS_HOLE + "b" + DS_END);
  });

  test("the open-tab context stays outside the FIM markers", async () => {
    const captured: any = {};
    const client = new OpenAICompletionClient(fakeFetch(captured) as any);
    client.setConfig(deepSeekEntry());
    await client.complete("GENERIC", [], new AbortController().signal, {
      prefix: "a", suffix: "b", contextPrefix: "### package.json\n{}",
    });
    assert.strictEqual(
      captured.body.prompt,
      "### package.json\n{}\n\n" + DS_BEGIN + "a" + DS_HOLE + "b" + DS_END,
    );
  });
});
