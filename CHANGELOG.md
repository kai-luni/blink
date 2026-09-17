# Change Log

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
