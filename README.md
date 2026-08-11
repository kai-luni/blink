# Blink — Local AI Code Completions

**AI ghost text that appears in a Blink — local-first, fast, and under your control.**

Blink brings inline AI code completions to VS Code with two ways to run models:

- **Local GGUF models** run directly inside the VS Code extension through `llama.cpp`.
- **Remote FIM/completion APIs** can be used with your own API key, including **Mistral Codestral** through its native FIM endpoint.

There is no Blink account, no subscription, and no telemetry.

> **Development status**
>
> Blink is currently also being actively developed and tested in a personal fork.
> The current development work focuses on better repository context, more useful
> diagnostics, safer remote context handling, and improved Codestral/Mistral
> completions.
>
> The extension is therefore still evolving fairly quickly. The current codebase
> should be regarded as an experimental but increasingly practical development
> version rather than a finished coding assistant.

---

## Quick start

1. Install Blink and open any code file.
2. Run **Blink: Select Model…** from the Command Palette or click the Blink
   status bar item.
3. Pick a recommended local model or configure a remote API.
4. Start typing.
5. Ghost text appears inline; press `Tab` to accept it.

For a local model there is no API key or account required.

For a remote model, choose one under **remote APIs** or configure an entry in
`blink.models`.

---

## Why Blink?

- **Private by default** — with a local model, your code stays on your machine.
- **Fast local inference** — GGUF models run in-process through `llama.cpp`.
- **Native fill-in-the-middle** — Blink is built around code completion rather
  than chat prompting.
- **Bring your own model or endpoint** — use a local GGUF, a self-hosted
  OpenAI-compatible endpoint, or Mistral Codestral.
- **Repository-aware context** — Blink can include code from other open files
  to improve completions.
- **No telemetry** — Blink does not send usage analytics.

---

## Features

### Inline completions

Blink provides native VS Code inline ghost-text completions.

Type normally and press `Tab` to accept a suggestion.

The completion engine works with code before and after the cursor using
fill-in-the-middle where the configured model supports it.

---

### Local models

Blink can run recommended **Qwen2.5-Coder GGUF** models directly inside the VS
Code extension.

Recommended model sizes currently range from approximately 0.5B to 7B.

Local inference uses `node-llama-cpp` / `llama.cpp`, so no separate inference
server is required.

---

### Mistral Codestral

Blink supports Mistral's native FIM API using the `prefix-suffix` prompt style.

Example:

    {
      "name": "mistral-codestral",
      "backend": "openai",
      "modelId": "codestral-2508",
      "apiBaseUrl": "https://api.mistral.ai/v1/fim/completions",
      "apiKey": "…",
      "promptStyle": "prefix-suffix"
    }

For this mode Blink sends:

- the code before the cursor as `prompt`
- the code after the cursor as `suffix`

Mistral applies the actual FIM template server-side.

Blink also gives the Mistral FIM path a small completion instruction so that new
comments default to English unless the surrounding code clearly uses another
language.

---

## Repository context

Blink now includes additional context from open editor tabs.

For every completion request it considers open text files and selects the
**first four eligible tabs**.

A context tab must:

- be a normal file
- belong to the current workspace
- not be the currently active file
- not be empty
- not be a `.env` file

The active file is deliberately excluded from this list because its code is
already supplied separately as the completion prefix and suffix.

Files named

    .env
    .env.local
    .env.production
    .env.development
    ...

are excluded from remote model context.

Each additional tab contributes at most **20,000 characters**, with a maximum
combined additional context size of **80,000 characters**.

Conceptually, a remote request can therefore look like:

    ### helper.ts
    ...

    ### service.ts
    ...

    ### models.ts
    ...

    ### utils.ts
    ...

    ### active-file.ts

    <code before cursor>

with the remaining active-file code sent separately as the suffix when using a
`prefix-suffix` backend such as Mistral Codestral.

This context strategy is intentionally simple for now. More relevance-based
context selection may replace or extend it later.

---

## Context safety

Blink excludes `.env` and `.env.*` files from the additional editor-tab
context.

This is an important safeguard for remote APIs because environment files often
contain API keys, client secrets, tokens, or credentials.

However, this is **not a general-purpose secret scanner**.

Credentials hard-coded in ordinary source files may still become part of the
prompt if those files are selected as context. When using a remote endpoint,
you should therefore still treat the selected provider as a recipient of the
code sent in each completion request.

Local models do not have this concern because their inference remains on the
machine.

---

## GPU support

Blink supports GPU acceleration for local models.

Current options include:

- **Vulkan** on Windows/Linux
- **Metal** on Apple Silicon
- **CUDA** for NVIDIA GPUs
- **CPU fallback**

On NVIDIA systems Blink can offer a separate CUDA runtime download of roughly
580 MB for better performance.

The configured `gpu` value can be:

    auto
    cuda
    vulkan
    metal
    off

---

## Status and startup diagnostics

Blink has a permanent status-bar integration for model and completion state.

During extension startup an additional temporary status indicator is now shown:

    ⟳ blink

If initialization succeeds, the normal Blink status item takes over.

If startup fails, Blink leaves an error indicator visible:

    ⓧ blink

The extension also logs startup information including:

    blink activation started
    version: ...
    mode: development | test | production
    path: ...
    creating BlinkExtension
    starting BlinkExtension
    blink ready

This is particularly useful for distinguishing between:

- an extension that VS Code never activated
- an extension that activated but failed during dependency construction
- an extension that started but later failed to load a model

Logs are available through:

    View → Output → blink

---

## Model registry

Blink stores configured models in `blink.models`.

Example:

    "blink.models": [
      {
        "name": "local-qwen",
        "backend": "llamacpp",
        "modelId": "qwen2.5-coder",
        "localModelPath": "C:/models/Qwen2.5-Coder-3B-Q6_K.gguf",
        "gpu": "auto"
      },
      {
        "name": "my-endpoint",
        "backend": "openai",
        "modelId": "qwen2.5-coder-7b",
        "apiBaseUrl": "https://my-host/v1",
        "apiKey": "sk-…",
        "fim": "<|fim_prefix|>"
      },
      {
        "name": "mistral-codestral",
        "backend": "openai",
        "modelId": "codestral-2508",
        "apiBaseUrl": "https://api.mistral.ai/v1/fim/completions",
        "apiKey": "…",
        "promptStyle": "prefix-suffix"
      }
    ]

---

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `blink.enabled` | `true` | Master switch for inline completions |
| `blink.model` | `""` | Active model from `blink.models` |
| `blink.models` | `[]` | Model registry |
| `blink.disabledFiles` | `["*.md", "*.markdown"]` | Files where Blink completions are disabled |

---

## OpenAI-compatible prompt styles

The `openai` backend supports two prompt styles.

### `raw`

This is the default.

Blink renders the FIM prompt locally and sends it as one `prompt` field.

This mode is intended for servers that expect the model's raw FIM-formatted
prompt, for example:

- vLLM
- llama-server
- TGI
- other OpenAI-compatible completion servers

The configured `fim` token determines the FIM template family.

---

### `prefix-suffix`

Blink sends:

    {
      "prompt": "<code before cursor>",
      "suffix": "<code after cursor>"
    }

The remote service is responsible for applying the model-specific FIM template.

This is the mode used for:

    https://api.mistral.ai/v1/fim/completions

When `prefix-suffix` is used, the `fim` configuration value is ignored.

---

## Remote request behavior

`apiBaseUrl` gets `/completions` appended automatically unless the configured URL
already ends in `/completions`.

Both forms therefore work:

    https://host/v1

and:

    https://api.mistral.ai/v1/fim/completions

Remote completion requests use a configurable timeout.

If `requestTimeoutMs` is omitted, the backend default is used.

The OpenAI-compatible backend is deliberately stateless: network and HTTP
failures result in no completion rather than bringing down the extension.

---

## Privacy

### Local models

With a `llamacpp` model, inference runs locally.

Your completion prompt does not need to leave your machine.

Blink does not send telemetry.

### Remote models

When using an OpenAI-compatible backend, Blink sends completion context to the
endpoint you configured.

That context can include:

- code before the cursor
- code after the cursor
- up to four additional eligible open workspace files
- editor/LSP-derived completion context where applicable

The currently active file is not duplicated among the four additional files.

`.env` and `.env.*` files are excluded from additional tab context.

There is no Blink telemetry service sitting between VS Code and your configured
endpoint.

Your API key currently lives in VS Code settings under `blink.models`.

In Restricted Mode the model registry is read from user settings only, so an
untrusted workspace cannot simply replace the configured endpoint.

Moving credentials to VS Code `SecretStorage` remains a useful future
improvement.

---

## Status bar controls

The Blink status item shows the current runtime state.

Depending on configuration and activity this can represent:

- disabled
- setup required
- model/configuration error
- working
- ready

Hovering the item provides more information and actions.

Clicking it opens the model picker.

---

## Toggle completions

Double-press `Escape` in the editor to toggle Blink completions.

A single `Escape` keeps its normal VS Code behavior and only participates in the
double-tap toggle when there is nothing else to dismiss.

Blink also exposes commands through the Command Palette:

    Blink: Enable Inline Completions
    Blink: Disable Inline Completions
    Blink: Toggle Inline Completions
    Blink: Select Model…

---

## Requirements

For local GGUF models:

- RAM requirements are roughly related to model size.
- The smallest recommended quantized model uses well below 1 GB.
- A 7B model requires several GB of RAM.
- A GPU is optional but recommended.

Local models must support FIM.

Blink rejects incompatible GGUF models without appropriate infill tokens.

Base coder models are usually preferable to instruction/chat variants for
inline completion.

Supported target platforms include:

- Windows x64
- Windows arm64
- Linux x64
- Linux arm64
- macOS Intel
- macOS Apple Silicon

---

## Current private development workflow

Blink is currently being iterated on in a personal development fork.

The usual development cycle is deliberately straightforward.

### Development Extension Host

For normal debugging, open the project in VS Code and launch the extension
through the VS Code debugger.

This opens a separate **Extension Development Host** window and is the quickest
way to test extension behavior while developing.

This mode is useful for:

- breakpoints
- debugging activation
- testing completion behavior
- inspecting extension logs
- iterating without reinstalling a VSIX after every source change

---

### Compile locally

Before packaging:

    npm run compile

This performs the TypeScript checks, ESLint checks, and the esbuild build.

---

### Build a VSIX

The development VSIX is currently built directly with `vsce`:

    npx @vscode/vsce package

The generated package can be inspected with:

    ls -lh *.vsix

The extension version is currently:

    0.1.8

so a development package will normally look like:

    blink-for-vscode-0.1.8.vsix

---

### Install the local VSIX

To replace the currently installed copy with the freshly built development
version:

    code --install-extension blink-for-vscode-0.1.8.vsix --force

After installation, reload or restart VS Code.

A useful workflow is therefore:

    npm run compile
    npx @vscode/vsce package
    code --install-extension blink-for-vscode-0.1.8.vsix --force

This allows the packaged extension to be tested separately from the Extension
Development Host.

That distinction is valuable because VS Code's debug extension environment and
a normally installed VSIX do not always behave identically.

---

## Debugging completions

Blink currently contains detailed LLM request logging useful during development.

The logs can show:

- selected context files
- rendered FIM prompt
- prefix/suffix client context
- outgoing HTTP request
- response text
- errors

This has been particularly useful for checking exactly what Codestral receives
and for verifying that:

- `.env` files are excluded
- the active file is not duplicated among context tabs
- four additional tabs are selected
- prefix and suffix reach Mistral correctly

These logs are intended primarily as a development aid and should be treated
carefully because LLM request logging can contain source code.

---

## Packaging

The VSIX build excludes development-only material such as:

    src/
    tests/
    coverage/
    node_modules/
    .git/
    *.ts
    *.map
    *.vsix

along with development configuration and source assets that are not required at
runtime.

This keeps the installed package focused on the built extension and its runtime
assets.

---

## Known limitations

Blink is still under active development.

Current limitations include:

- **Context selection is simple** — the first four eligible open tabs are used
  rather than ranking files by semantic relevance.
- **`.env` protection is specific, not exhaustive** — Blink does not yet perform
  general secret detection on arbitrary source files.
- **CUDA remains a separate download** — Vulkan already accelerates supported
  systems, while CUDA can be installed separately for NVIDIA hardware.
- **No dedicated Ollama backend yet** — use an OpenAI-compatible Ollama endpoint
  where appropriate.
- **Completions only** — Blink is not intended to be a chat assistant.
- **Context and latency tuning are ongoing** — better context ranking, recent
  edits, LSP information, caching, and prompt tuning remain active areas of
  development.
- **Remote API behavior varies by provider** — OpenAI-compatible does not always
  mean identical FIM semantics.

---

## Current development direction

The present private development work is concentrating on making Blink feel less
like a minimal completion demo and more like a dependable everyday coding tool.

Current priorities include:

1. Better completion context without flooding the model with irrelevant files.
2. Safer handling of remote context and credentials.
3. Better Codestral/Mistral behavior.
4. Clear startup and runtime diagnostics.
5. Reliable packaged-VSIX behavior, not just Extension Development Host
   behavior.
6. More useful LSP/editor context.
7. Better caching and latency.
8. Eventually ranking context files by relevance instead of simply using tab
   order.

The goal remains deliberately modest:

> **Fast, useful inline code completion without turning the editor into another
> chat application.**

---

## License

[MIT](LICENSE)