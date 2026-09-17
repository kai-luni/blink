import { CompletionRequest } from "./completionEngine";

// export interface FimInput {
//   prefix: string;
//   suffix: string;
//   path?: string;
//   repoName?: string;
//   files?: { path: string; content: string }[];
// }

export interface FimTemplate {
  render(input: CompletionRequest): string;
  stop: string[];
}


/**
 * Qwen2.5-Coder: file-level FIM, plus the trained repo-level format
 * (`<|repo_name|>` / `<|file_sep|>`) when a path is present. The repo branch
 * requires a path, so unsaved buffers always render file-level.
 */
const qwen: FimTemplate = {
  stop: [
    "<|endoftext|>",
    "<|fim_prefix|>",
    "<|fim_suffix|>",
    "<|fim_middle|>",
    "<|fim_pad|>",
    "<|repo_name|>",
    "<|file_sep|>",
  ],
  render: ({ prefix, suffix, filePath, repoName, files }: CompletionRequest) => {
    const parts = [`<|repo_name|>${repoName}`];
    for (const f of files ?? []) {
      parts.push(`<|file_sep|>${f.path}`, f.content);
    }
    parts.push(
      `<|file_sep|>${filePath}`,
      `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
    );
    return parts.join("\n");
  },
};

/**
 * DeepSeek native FIM (`<｜fim▁begin｜>…<｜fim▁hole｜>…<｜fim▁end｜>`).
 *
 * The markers are real tokens of DeepSeek-V4.x (ids 128801 / 128800 / 128802, checked
 * in the HF tokenizer of DeepSeek-V4.1-Flash), so this belongs next to the Qwen tokens
 * instead of being hardcoded in the client. The model never *emits* the end marker —
 * it stops on EOS — so the stop entry is insurance against the marker leaking into the
 * ghost text, not a brake: measured output length is bounded by max_tokens.
 */
const deepseek: FimTemplate = {
  stop: ["<｜fim▁end｜>"],
  render: ({ prefix, suffix }: CompletionRequest) =>
    `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`,
};

const def: FimTemplate = {
  stop: [],
  render: ({ prefix, suffix, filePath, repoName, files }: CompletionRequest) => {
    return `${prefix}<|cursor|>${suffix}`;
  },
};

export class FimTemplates {
  get(prefix: string) {
    if (prefix === "<|fim_prefix|>") {
      return qwen;
    }

    if (prefix === "<｜fim▁begin｜>") {
      return deepseek;
    }

    return def;
  }
}