import type { DebugCheckOutcome, StepCheck } from "@apipilot/shared-domain";
import { parseCapturePath } from "@apipilot/shared-domain";
import { parseJsonBody, scalarText, walkBody, type ParsedBody } from "./extraction";

/**
 * Check evaluation for a Debug run (specs/039-chain-debug-run research R2). A twin of `passes` in
 * `CHAIN_RUNTIME`: the same inputs give the same pass or fail. `detail` says in words what was
 * compared and never carries a body value, an expected text or a reference, so it needs no masking.
 * A check never decides whether the chain continues, as in the runtime.
 */

export interface CheckResponse {
  durationMs: number;
  bodyText: string;
  parsed: ParsedBody;
}

export function responseForChecks(durationMs: number, bodyText: string): CheckResponse {
  return { durationMs, bodyText, parsed: parseJsonBody(bodyText) };
}

function fieldOf(check: Extract<StepCheck, { path: string }>, response: CheckResponse): { found: true; value: unknown } | { found: false } {
  if (!response.parsed.ok) return { found: false };
  const path = parseCapturePath(check.path);
  return path.ok ? walkBody(response.parsed.value, path.segments) : { found: false };
}

/** `expectedText` is the check's expected text with its references filled; only a text check reads it. */
export function evaluateCheck(check: StepCheck, response: CheckResponse, expectedText: string): DebugCheckOutcome {
  const base = { checkId: check.id, kind: check.kind };
  switch (check.kind) {
    case "time-at-most": {
      const passed = response.durationMs <= check.maxMs;
      return { ...base, passed, detail: `The response took ${Math.round(response.durationMs)} ms; the limit is ${check.maxMs} ms.` };
    }
    case "body-contains": {
      const passed = response.bodyText.indexOf(check.text) >= 0;
      return { ...base, passed, detail: passed ? "The response body contains the text." : "The response body does not contain the text." };
    }
    case "field-exists": {
      const found = fieldOf(check, response);
      return { ...base, passed: found.found, detail: found.found ? `Field ${check.path} is present.` : `Field ${check.path} is not present${response.parsed.ok ? "" : " (the body is not JSON)"}.` };
    }
    case "field-equals": {
      const found = fieldOf(check, response);
      if (!found.found) return { ...base, passed: false, detail: `Field ${check.path} is not present${response.parsed.ok ? "" : " (the body is not JSON)"}.` };
      const expected = check.expected;
      let passed: boolean;
      if (expected.type === "number") passed = typeof found.value === "number" && found.value === expected.value;
      else if (expected.type === "boolean") passed = typeof found.value === "boolean" && found.value === expected.value;
      else {
        const actual = found.value === null ? undefined : scalarText(found.value);
        passed = actual !== undefined && actual === expectedText;
      }
      return { ...base, passed, detail: passed ? `Field ${check.path} equals the expected ${expected.type}.` : `Field ${check.path} does not equal the expected ${expected.type}.` };
    }
  }
}
