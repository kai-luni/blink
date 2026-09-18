import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LLM_LOG_PATH = join(homedir(), "blink-llm.log");
let pendingWrite: Promise<void> = Promise.resolve();

/** Same log path and format; serialize writes within this extension host. */
export async function writeLlmLog(
  type: string,
  data: unknown,
  secrets: readonly string[] = [],
): Promise<void> {
  try {
    let serialized = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    serialized ??= "null";
    for (const secret of secrets) {
      if (secret.length > 0) {
        const escaped = JSON.stringify(secret).slice(1, -1);
        serialized = serialized.split(escaped).join("[REDACTED]");
        serialized = serialized.split(secret).join("[REDACTED]");
      }
    }
    const entry = [
      "", "=".repeat(100), `${new Date().toISOString()} ${type}`,
      "=".repeat(100), serialized, "",
    ].join("\n");
    const write = pendingWrite.then(() => appendFile(LLM_LOG_PATH, entry, "utf8"));
    pendingWrite = write.catch(() => {});
    await write;
  } catch {
    // Debug-Logging darf die Completion niemals unterbrechen.
  }
}
