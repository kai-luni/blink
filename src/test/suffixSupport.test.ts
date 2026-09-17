import * as assert from "assert";
import { suffixVerdict } from "../completion/suffixSupport.js";

suite("suffixVerdict", () => {
  test("an unchanged prompt_tokens count means the endpoint dropped the suffix", () => {
    assert.strictEqual(suffixVerdict(12, 12), "ignored");
  });

  test("a larger count with the suffix means the endpoint used it", () => {
    assert.strictEqual(suffixVerdict(49, 12), "accepted");
  });

  test("a missing usage block stays unknown (request shape untouched)", () => {
    assert.strictEqual(suffixVerdict(undefined, 12), "unknown");
    assert.strictEqual(suffixVerdict(12, undefined), "unknown");
  });

  test("a smaller count with the suffix is not read as acceptance", () => {
    assert.strictEqual(suffixVerdict(5, 12), "unknown");
  });
});
