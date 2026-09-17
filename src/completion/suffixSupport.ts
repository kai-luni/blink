export type SuffixSupport = "accepted" | "ignored" | "unknown";

/**
 * Verdict from the one-time probe pair: the same prompt sent twice, once with a
 * long `suffix` and once without. A provider that templates FIM server-side (or
 * appends the suffix itself) counts the suffix in `usage.prompt_tokens`; one that
 * ignores the field reports the same count in both requests — which is exactly
 * what a silent drop looks like. Pure; the network lives in the client.
 */
export function suffixVerdict(withSuffixTokens?: number, withoutSuffixTokens?: number): SuffixSupport {
  if (typeof withSuffixTokens !== "number" || typeof withoutSuffixTokens !== "number") {
    return "unknown";
  }
  if (withSuffixTokens === withoutSuffixTokens) {
    return "ignored";
  }
  return withSuffixTokens > withoutSuffixTokens ? "accepted" : "unknown";
}
