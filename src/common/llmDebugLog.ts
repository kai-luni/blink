import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LLM_LOG_PATH = join(homedir(), "blink-llm.log");

export async function writeLlmLog(
  type: string,
  data: unknown,
): Promise<void> {
  const serialized =
    typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2);

  const entry = [
    "",
    "=".repeat(100),
    `${new Date().toISOString()} ${type}`,
    "=".repeat(100),
    serialized,
    "",
  ].join("\n");

  try {
    await appendFile(LLM_LOG_PATH, entry, "utf8");
  } catch {
    // Debug-Logging darf die Completion niemals unterbrechen.
  }
}