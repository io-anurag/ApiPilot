import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, InferenceRequest, InferenceResponse } from "@apipilot/shared-domain";
import { AIProviderError } from "../../../src/ai/errors";
import { enhanceTestModel } from "../../../src/testDesign/enhanceTestModel";
import { deduplicate } from "../../../src/testDesign/deduplicate";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { buildLargeAiScenarioApiModel } from "../../fixtures/testDesign/aiScenarioDesignerFixtures";

/**
 * Regression checklist of specs/013-ai-enhancement-viability (T071): behaviour earlier features
 * established that this work must not break.
 *
 * - SC-010: no deterministic scenario is lost, altered or reordered by any AI outcome, across success,
 *   partial, refusal, cancellation and failure.
 * - SC-009: identical input yields identical retained scenarios in identical order.
 * - Constitution XX: no specification content, prompt or model response reaches the logs.
 */

const apiModel = buildLargeAiScenarioApiModel(4);
// A baseline from the real generator, which has already been deduplicated. A hand-built baseline
// holding equivalent scenarios would be collapsed by the final merge, which is deduplication working,
// not a lost scenario.
const baseline = generateTestModel(apiModel);

function readiness() {
  return {
    state: "ready" as const,
    acceleratorRequested: false,
    acceleratorActive: false,
    updatedAt: new Date(0).toISOString(),
  };
}

function success(request: InferenceRequest, content: string): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content,
    modelId: "regression-model",
    provider: "mock",
    durationMs: 1,
  };
}

/** One valid candidate per operation present in the request, read from the real serialized prompt. */
function candidatesFor(request: InferenceRequest): string {
  const prompt = JSON.parse(request.input) as { operations: { path: string; method: string }[] };
  const candidates = prompt.operations.map((operation) => ({
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
  }));
  return JSON.stringify({ responseVersion: 5, candidates });
}

function provider(infer: AIProvider["infer"]): AIProvider {
  return { mode: "mock", getReadiness: readiness, getInputBudget: async () => undefined, infer };
}

const working = (): AIProvider =>
  provider(async (request) => success(request, candidatesFor(request)));

afterEach(() => vi.restoreAllMocks());

describe("SC-010: the deterministic baseline survives every outcome path", () => {
  it("rests on the generated baseline being stable under deduplication", () => {
    expect(baseline.scenarios.length).toBeGreaterThan(0);
    expect(deduplicate(baseline.scenarios)).toEqual(baseline.scenarios);
  });

  const paths: [string, () => Promise<Awaited<ReturnType<typeof enhanceTestModel>>>][] = [
    ["success", () => enhanceTestModel(apiModel, baseline, working())],
    [
      "partial (a unit fails)",
      () => {
        let calls = 0;
        return enhanceTestModel(
          apiModel,
          baseline,
          provider(async (request) => {
            calls += 1;
            if (calls === 2) throw new AIProviderError("TIMEOUT", "timed out");
            return success(request, candidatesFor(request));
          }),
        );
      },
    ],
    [
      "refusal (not viable)",
      () => enhanceTestModel(apiModel, baseline, working(), { perRequestBudgetMs: 1 }),
    ],
    [
      "cancellation (the unit in flight is abandoned)",
      () => {
        const controller = new AbortController();
        let calls = 0;
        return enhanceTestModel(
          apiModel,
          baseline,
          provider(async (request) => {
            calls += 1;
            if (calls === 2) controller.abort();
            return success(request, candidatesFor(request));
          }),
          { cancelSignal: controller.signal },
        );
      },
    ],
    [
      "failure (every unit fails)",
      () =>
        enhanceTestModel(
          apiModel,
          baseline,
          provider(async () => {
            throw new AIProviderError("PROVIDER_UNAVAILABLE", "down");
          }),
        ),
    ],
  ];

  it.each(paths)("%s: every deterministic scenario is present, unchanged and in order", async (_name, run) => {
    const result = await run();
    const scenarios = result.enhancedTestModel.scenarios;

    expect(scenarios.slice(0, baseline.scenarios.length)).toEqual(baseline.scenarios);
    expect(scenarios.slice(0, baseline.scenarios.length).map((s) => s.id)).toEqual(
      baseline.scenarios.map((s) => s.id),
    );
    // Whatever the outcome, anything after the baseline is AI-derived, never a replacement.
    expect(
      scenarios.slice(baseline.scenarios.length).every((s) => s.provenance.source === "AI"),
    ).toBe(true);
  });

  it("the paths really differ: success adds scenarios, partial adds fewer, the rest add none", async () => {
    const added = async (run: (typeof paths)[number][1]) =>
      (await run()).enhancedTestModel.scenarios.length - baseline.scenarios.length;
    const [full, partial, refusal, cancelled, failure] = await Promise.all(
      paths.map(([, run]) => added(run)),
    );
    expect(full).toBeGreaterThan(0);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
    expect(cancelled).toBeGreaterThan(0);
    expect(cancelled).toBeLessThan(full);
    expect([refusal, failure]).toEqual([0, 0]);
  });
});

describe("SC-009: identical input yields identical retained scenarios in identical order", () => {
  it("repeats exactly across runs with a fresh provider each time", async () => {
    const first = await enhanceTestModel(apiModel, baseline, working());
    const second = await enhanceTestModel(apiModel, baseline, working());

    expect(second.enhancedTestModel).toEqual(first.enhancedTestModel);
    expect(second.aiCandidates).toEqual(first.aiCandidates);
    expect(second.aiProviderOutcome).toBe(first.aiProviderOutcome);
    expect(second.requestId).toBe(first.requestId);
  });

  it("is unaffected by the order in which the provider happens to answer slowly or quickly", async () => {
    const slowFirst = provider(async (request) => {
      if (request.requestId.endsWith("-batch0")) await new Promise((r) => setTimeout(r, 15));
      return success(request, candidatesFor(request));
    });
    const plain = await enhanceTestModel(apiModel, baseline, working());
    const delayed = await enhanceTestModel(apiModel, baseline, slowFirst);

    expect(delayed.enhancedTestModel.scenarios.map((s) => s.id)).toEqual(
      plain.enhancedTestModel.scenarios.map((s) => s.id),
    );
  });
});

describe("constitution XX: nothing sensitive reaches the logs", () => {
  const SPEC_SENTINEL = "/secret-tenant-path-7f3a";
  const PROMPT_SENTINEL = "SECRET-RATIONALE-9c1d";
  const RESPONSE_SENTINEL = "SECRET-RESPONSE-BODY-4e8b";

  function captureLogs(): string[] {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    return lines;
  }

  const sensitiveModel = {
    ...apiModel,
    operations: apiModel.operations.map((operation, index) => ({
      ...operation,
      path: `${SPEC_SENTINEL}/${index}`,
    })),
  };
  const sensitiveBaseline = generateTestModel(sensitiveModel);

  it("keeps spec content, the prompt and model responses out of the logs on success, malformed output and failure", async () => {
    const logs = captureLogs();
    const leaky = (content: (request: InferenceRequest) => string) =>
      provider(async (request) => success(request, content(request)));

    await enhanceTestModel(
      sensitiveModel,
      sensitiveBaseline,
      leaky((request) =>
        candidatesFor(request).replaceAll("Exercise a malformed email", PROMPT_SENTINEL),
      ),
    );
    await enhanceTestModel(
      sensitiveModel,
      sensitiveBaseline,
      leaky(() => `${RESPONSE_SENTINEL} this is not json`),
    );
    await enhanceTestModel(
      sensitiveModel,
      sensitiveBaseline,
      provider(async () => {
        throw new AIProviderError("PROVIDER_UNAVAILABLE", `${RESPONSE_SENTINEL} detail`);
      }),
    );

    expect(logs.length).toBeGreaterThan(0);
    const everything = logs.join("\n");
    for (const sentinel of [SPEC_SENTINEL, PROMPT_SENTINEL, RESPONSE_SENTINEL]) {
      expect(everything).not.toContain(sentinel);
    }
    // The prompt is the serialized contract; none of its structural keys are logged either.
    expect(everything).not.toContain("allowedTargets");
    expect(everything).not.toContain("existingCoverage");
  });
});
