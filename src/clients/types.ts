import type { ModelConfig } from "../config/models.js";
import type { SuffixSupport } from "../completion/suffixSupport.js";

/** The untemplated context halves, for clients whose endpoint templates server-side. */
export interface FimParts {
  prefix: string;
  suffix: string;
  /**
   * Open-tab context that precedes the current file, kept apart from `prefix` so a
   * FIM endpoint can place it *outside* its begin/hole/end markers. Measured
   * 2026-09-17: with the context inside the markers DeepSeek-V4.1-Flash kept
   * continuing the context document (`### <file>` sections) instead of filling the
   * hole; outside the markers the inventions dropped (3/3 -> 0/3 in one sample).
   * Absent when no tabs were eligible.
   */
  contextPrefix?: string;
}

/**
 * The cross-backend completion contract the engine depends on. Never throws — a
 * client returns "" on any failure so the editor shows nothing. `parts` carries
 * the raw prefix/suffix alongside the rendered prompt; clients that POST them
 * separately (openai prefix-suffix style) use it, everyone else ignores it.
 */
export interface CompletionClient {
  complete(prompt: string, stop: string[], signal: AbortSignal, parts?: FimParts): Promise<string>;
  /** Optional eager load so the first complete() has no startup lag. Stateless clients omit it. */
  prewarm?(): void;
  getFimPrefix(): Promise<string | null>;
  /**
   * Optional: does the endpoint actually honour the separate `suffix` field?
   * Only prefix-suffix entries answer; everyone else returns "unknown". Called
   * once per config change by the composition root, never on the keystroke path.
   * Must never throw.
   */
  probeSuffixSupport?(): Promise<SuffixSupport>;
  config?: ModelConfig;
}

/**
 * A client the manager owns: configurable per model and disposable. The registry
 * creates these; the manager applies the active model via setConfig.
 */
export interface ManagedClient extends CompletionClient {
  setConfig(model: ModelConfig): void;
  /** Subscribe to model-load failures (status-bar signal). Stateless clients no-op. */
  onLoadError(listener: (message: string) => void): void;
  dispose(): Promise<void>;
}
