# Change Log

## [0.2.2] — 2026-09-17

- **The cursor's completion items are out of the prompt.** Measured against
  DeepSeek-V4.1-Flash (Nebius): up to 80 items — for a TypeScript file the whole
  global symbol table — turned a completion into a 12.603-character request, of
  which only 464 characters were the real prefix before the cursor. With that much
  noise ahead of the FIM hole the model continued the "### <file>" document instead
  of filling the hole. The **open tabs stay** in the prompt; the lookup also no
  longer costs a `executeCompletionItemProvider` round-trip per completion.
- **DeepSeek FIM path tuned** (`openAiClient`): `max_tokens` capped at 512 (a loop
  with the entry's 25600 kept writing whole blocks), `temperature` 0.5 → 0.2
  (0.7 produced a pure repetition loop), and `stop` now carries the blank-line
  breaks (`\n\n`, `\r\n\r\n`) next to the FIM end token — measured effect:
  1139 → 111 characters of output, focused instead of document-wide.

## [0.2.1] — 2026-09-17

- **Endpoints that silently drop the `suffix` field are detected.** With
  `promptStyle: "prefix-suffix"` blink now probes once per config change (same
  prompt sent twice, once with a long suffix) and compares `usage.prompt_tokens`.
  A provider that ignores the field answers with the same count — no error, which
  is why this went unnoticed (Nebius Token Factory `/v1/completions` is one).
  The verdict is written to `~/blink-llm.log` (`SUFFIX_PROBE`) and, when the field
  is ignored, reported in the blink output channel.
- **Fallback instead of silent degradation.** An ignored suffix no longer sends a
  prefix-only request: DeepSeek models fall back to the native FIM tokens
  (`<｜fim▁begin｜>…<｜fim▁hole｜>…<｜fim▁end｜>`), every other model to the locally
  templated prompt.
- **DeepSeek-V4.1-Flash on Nebius** works through the native FIM path
  (`promptStyle: "raw"`, model id `deepseek-ai/DeepSeek-V4.1-Flash`): verified
  live against the endpoint, including the sampling parameters.
- The DeepSeek FIM request always carries the FIM end token in `stop`, so it
  cannot leak into the ghost text.

## [0.1.5] — 2026-07-17

- **Mistral Codestral support**: the `openai` backend gained
  `promptStyle: "prefix-suffix"` for endpoints that apply the FIM template
  server-side (`prompt` + `suffix` request fields, chat-shaped responses), and
  full endpoint URLs like `https://api.mistral.ai/v1/fim/completions` are used
  as-is.
- **Double-press `Escape`** in the editor to toggle completions on/off (single
  `Escape` keeps its normal behavior — it only counts when there's nothing to
  dismiss). Also new in the Command Palette: **blink: Toggle Inline
  Completions**.
- New **remote APIs** section in **blink: Select Model…**: add a Mistral
  Codestral preset (model id + API key) or any OpenAI-compatible endpoint
  (URL + model id + API key) without editing settings.
- Remote requests now default to a 10 s timeout (local stays 3 s); failed HTTP
  responses are logged to the blink output channel instead of failing silently.
- What's New in the status bar: a dot on the blink icon marks a fresh update —
  hover for the highlights and the full changelog.
- CUDA acceleration via one-click runtime download (Windows/Linux x64,
  NVIDIA): blink offers the prebuilt CUDA binaries (~580 MB) when it detects
  an NVIDIA GPU, verifies them against the npm registry, and survives
  extension updates without re-downloading. `"cuda"` is back in the `gpu`
  setting enum.


## [0.1.0] — 2026-06-10

Initial release.

- Inline ghost-text completions via native fill-in-the-middle (FIM).
- Local GGUF models in-process via llama.cpp, with GPU acceleration: Vulkan
  (Windows/Linux x64), Metal (Apple Silicon).
- OpenAI-compatible `/v1/completions` backend (bring your own key).
- Model registry (`blink.models`) + **blink: Select Model…** picker with
  curated, downloadable Qwen2.5-Coder models (0.5B–7B).
- Status bar indicator with hover actions: settings, model switch,
  enable/disable.
