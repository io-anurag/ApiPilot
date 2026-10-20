import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, InferenceRequest, InferenceResponse } from "@apipilot/shared-domain";
import { enhanceTestModel } from "../../../src/testDesign/enhanceTestModel";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { buildLargeAiScenarioApiModel } from "../../fixtures/testDesign/aiScenarioDesignerFixtures";

/**
 * Per-unit diagnostics: after a run, the log must say why a unit kept nothing, in counts and
 * finding codes only (constitution XX).
 */

const apiModel = buildLargeAiScenarioApiModel(3);
const baseline = generateTestModel(apiModel);

function respond(request: InferenceRequest, content: string): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content,
    modelId: "diagnostics-model",
    provider: "mock",
    durationMs: 1,
  };
}

function validCandidates(request: InferenceRequest): string {
  const prompt = JSON.parse(request.input) as { operations: { path: string; method: string }[] };
  return JSON.stringify({
    responseVersion: 5,
    candidates: prompt.operations.map((operation) => ({
      candidateId: `c-${operation.method}-${operation.path}`,
      operationPath: operation.path,
      operationMethod: operation.method,
      category: "invalid-format",
      targetLocation: "body",
      targetField: "email",
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { email: "bad" } },
      assertions: [{ type: "status-code", expectedStatusCode: "409" }],
      rationale: `Exercise a malformed email on ${operation.path}.`,
      confidence: 0.8,
      assumptions: [],
    })),
  });
}

function provider(content: (request: InferenceRequest) => string): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    infer: async (request) => respond(request, content(request)),
  };
}

async function unitRecords(
  content: (request: InferenceRequest) => string,
): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  await enhanceTestModel(apiModel, baseline, provider(content));
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.event === "unit_candidates");
}

afterEach(() => vi.restoreAllMocks());

/** The same reply, with every candidate carrying the ID the prompt's worked example shows. */
function withSharedCandidateId(request: InferenceRequest): string {
  const reply = JSON.parse(validCandidates(request)) as {
    candidates: { candidateId: string }[];
  };
  for (const candidate of reply.candidates) candidate.candidateId = "c1";
  return JSON.stringify(reply);
}

describe("candidate IDs are unique within a response, not across the run", () => {
  it("does not reject a unit's candidate because an earlier unit used the same ID", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await enhanceTestModel(
      apiModel,
      baseline,
      provider(withSharedCandidateId),
    );

    // Before the fix every unit after the first came back as `duplicate` and its inference was lost.
    expect(result.aiCandidates.rejected).toEqual([]);
    expect(
      result.aiCandidates.added.length + result.aiCandidates.deduplicated.length,
    ).toBe(apiModel.operations.length);
  });

  it("still rejects a repeated ID inside one response", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const twice = (request: InferenceRequest): string => {
      const reply = JSON.parse(withSharedCandidateId(request)) as { candidates: unknown[] };
      return JSON.stringify({ ...reply, candidates: [...reply.candidates, ...reply.candidates] });
    };

    const result = await enhanceTestModel(apiModel, baseline, provider(twice));

    expect(result.aiCandidates.rejected).toHaveLength(apiModel.operations.length);
    for (const item of result.aiCandidates.rejected) {
      expect(item.findings.map((finding) => finding.code)).toEqual(["duplicate"]);
    }
  });
});

describe("unit_candidates diagnostics", () => {
  it("logs one record per unit and shows a retained candidate", async () => {
    const records = await unitRecords(validCandidates);

    expect(records).toHaveLength(apiModel.operations.length);
    for (const record of records) {
      expect(record).toMatchObject({
        candidatesReturned: 1,
        retainedCount: 1,
        rejectedShape: 0,
        nonExecutable: 0,
        findingCodes: "",
      });
      expect(record.baselineScenarioCount).toBeGreaterThan(0);
      expect(record.requestId).toEqual(expect.stringContaining("-batch"));
    }
  });

  it("tells an empty reply from the model apart from refused candidates", async () => {
    const empty = await unitRecords(() => JSON.stringify({ responseVersion: 5, candidates: [] }));

    expect(empty).toHaveLength(apiModel.operations.length);
    for (const record of empty) {
      expect(record).toMatchObject({ candidatesReturned: 0, retainedCount: 0, findingCodes: "" });
    }
  });

  it("names why a candidate was refused, by finding code", async () => {
    const refused = await unitRecords((request) =>
      validCandidates(request).replaceAll("invalid-format", "made-up-category"),
    );

    for (const record of refused) {
      expect(record).toMatchObject({
        candidatesReturned: 1,
        retainedCount: 0,
        rejectedShape: 1,
        findingCodes: "unsupported-category:1",
      });
    }
  });

  it("counts an operation the model invented as non-executable, with its code", async () => {
    const invented = await unitRecords((request) =>
      validCandidates(request).replaceAll('"operationPath":"', '"operationPath":"/not-in-the-spec'),
    );

    for (const record of invented) {
      expect(record).toMatchObject({ candidatesReturned: 1, retainedCount: 0, nonExecutable: 1 });
      expect(String(record.findingCodes)).toMatch(/operation-not-found:\d+/);
    }
  });
});
