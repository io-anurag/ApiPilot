import type { DebugRunResult, DebugSentStep, MaskedText } from "@apipilot/shared-domain";

/** AP-039 (specs/039-chain-debug-run): Debug run results shaped like the backend's, already masked. */

export const text = (value: string): MaskedText => [{ kind: "text", text: value }];
export const masked = (valueId: string, label: string, revealable = true): MaskedText[number] => ({ kind: "masked", valueId, revealable, label });

export function sentStep(overrides: Partial<DebugSentStep> & Pick<DebugSentStep, "stepId" | "stepName">): DebugSentStep {
  return {
    status: "sent",
    request: { method: "GET", url: text("http://127.0.0.1:4600/health"), headers: [], body: { kind: "none" } },
    response: { status: 200, statusText: "OK", headers: [{ name: "content-type", value: text("application/json") }], body: { kind: "text", contentType: "application/json", text: text('{"ok":true}'), sizeBytes: 11, truncated: false }, redirects: [] },
    durationMs: 12,
    statusOutcome: { expected: ["200"], received: 200, ok: true },
    extractors: [],
    checks: [],
    ...overrides,
  };
}

/** A token step whose extractor path does not match the response, and a step that therefore was not sent. */
export function failedExtractionResult(overrides: Partial<DebugRunResult> = {}): DebugRunResult {
  return {
    debugRunId: "22222222-2222-4222-8222-222222222222",
    planId: "11111111-1111-4111-8111-111111111111",
    environment: { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    startedAt: "2026-10-04T10:00:00.000Z",
    durationMs: 48,
    outcome: "stopped-early",
    setup: [],
    chains: [
      {
        chainId: "c1",
        chainName: "Customer lifecycle",
        stoppedAt: { stepId: "s1", cause: "extractor-failed" },
        steps: [
          sentStep({
            stepId: "s1",
            stepName: "issueToken",
            request: {
              method: "POST",
              url: text("http://127.0.0.1:4600/auth/token"),
              headers: [{ name: "Authorization", value: [masked("v1", "Authorization header")] }],
              body: { kind: "text", contentType: "application/x-www-form-urlencoded", text: [{ kind: "text", text: "client_secret=" }, masked("v2", "secret value client_secret", false)], sizeBytes: 40, truncated: false },
            },
            response: {
              status: 200,
              statusText: "OK",
              headers: [{ name: "content-type", value: text("application/json") }],
              body: { kind: "text", contentType: "application/json", text: [{ kind: "text", text: '{"token":"' }, masked("v3", "field token"), { kind: "text", text: '"}' }], sizeBytes: 60, truncated: false },
              redirects: [],
            },
            extractors: [{ extractorId: "x1", name: "token", source: { kind: "body", path: "access_token" }, outcome: { kind: "failed", reason: { code: "path-not-found", path: "access_token" } } }],
          }),
          { status: "not-sent", stepId: "s2", stepName: "listCustomers", cause: { kind: "stopped-by", stepId: "s1", stepName: "issueToken", reason: "extractor-failed" } },
        ],
      },
    ],
    dataRows: [],
    notes: ["Think time and request pauses were not waited out."],
    ...overrides,
  };
}
