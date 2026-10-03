import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainPlanInput, ChainStep } from "@apipilot/shared-domain";
import {
  HeaderNotSettableError,
  InvalidChainError,
  InvalidChainPlanError,
  InvalidStepError,
  PlanLimitExceededError,
} from "../../../../src/performance/errors";
import { normalizePlanInput, planFingerprint, stepContentDigest } from "../../../../src/performance/chain/savePlan";
import { chain, chainPlan, customerLifecyclePlan, step } from "../../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T014; research R2, R9, R22, R26). */

const NOW = "2026-10-03T12:00:00.000Z";

function inputOf(plan: ChainPlan): ChainPlanInput {
  return {
    name: plan.name,
    chains: plan.chains.map((entry) => ({ id: entry.id, name: entry.name, steps: entry.steps.map(({ source: _s, seedDigest: _d, changed: _c, ...rest }) => rest) })),
    loadProfile: plan.loadProfile,
    thinkTimeMs: plan.thinkTimeMs,
    thresholds: plan.thresholds,
    targetEnvironmentId: plan.targetEnvironmentId,
    secretNames: plan.secretNames,
    seedingReport: plan.seedingReport,
    nextChainNumber: plan.nextChainNumber,
    nextStepNumber: plan.nextStepNumber,
    nextItemNumber: plan.nextItemNumber,
  };
}

function withStep(plan: ChainPlan, patch: Record<string, unknown>, stepIndex = 0): ChainPlanInput {
  const input = inputOf(plan);
  const steps = input.chains[0].steps as unknown as Record<string, unknown>[];
  steps[stepIndex] = { ...steps[stepIndex], ...patch };
  return input;
}

function seeded(): ChainPlan {
  const base = customerLifecyclePlan();
  const chains = base.chains.map((entry) => ({
    ...entry,
    steps: entry.steps.map((s): ChainStep => ({ ...s, source: { kind: "operation", operationKey: `op-${s.id}`, label: `op ${s.id}`, passwordFields: [] }, seedDigest: stepContentDigest(s) })),
  }));
  return { ...base, chains };
}

describe("normalizePlanInput: validation", () => {
  const stored = customerLifecyclePlan();

  it.each([
    [{ method: "TRACE" }, "method"],
    [{ url: "{{baseUrl}}/a?x=1" }, "url"],
    [{ url: "{{baseUrl}}/a#top" }, "url"],
    [{ url: "" }, "url"],
    [{ headers: [{ name: "Bad Header", value: "x" }] }, "headers"],
    [{ query: [{ name: "", value: "x" }] }, "query"],
    [{ body: { kind: "raw", contentType: "", text: "{}" } }, "body"],
    [{ body: { kind: "multipart" } }, "body"],
    [{ expectedStatuses: ["20"] }, "expectedStatuses"],
    [{ extractors: [{ id: "x9", name: "bad name", source: { kind: "body", path: "id" } }] }, "extractors"],
    [{ checks: [{ id: "k9", kind: "time-at-most", maxMs: 0 }] }, "checks"],
    [{ checks: [{ id: "k9", kind: "regex", pattern: ".*" }] }, "checks"],
    [{ runs: "sometimes" }, "runs"],
    [{ thinkTimeMs: -1 }, "thinkTimeMs"],
  ])("refuses %j as invalid_step on %s", (patch, field) => {
    expect(() => normalizePlanInput(withStep(stored, patch, 1), stored, NOW)).toThrow(InvalidStepError);
    try {
      normalizePlanInput(withStep(stored, patch, 1), stored, NOW);
    } catch (error) {
      expect((error as InvalidStepError).field).toBe(field);
      expect((error as InvalidStepError).stepId).toBe("s2");
    }
  });

  it("refuses Host and Content-Length with their own error", () => {
    expect(() => normalizePlanInput(withStep(stored, { headers: [{ name: "Host", value: "x" }] }, 1), stored, NOW)).toThrow(HeaderNotSettableError);
    expect(() => normalizePlanInput(withStep(stored, { headers: [{ name: "content-length", value: "1" }] }, 1), stored, NOW)).toThrow(HeaderNotSettableError);
  });

  it("enforces every plan limit by name", () => {
    const tooManyChains = inputOf(stored);
    tooManyChains.chains = Array.from({ length: 21 }, (_unused, index) => ({ id: `c${index + 2}`, name: `C${index}`, steps: [] }));
    const limitOf = (input: unknown) => {
      try {
        normalizePlanInput(input, stored, NOW);
      } catch (error) {
        return error instanceof PlanLimitExceededError ? error.limit : `unexpected ${(error as Error).name}`;
      }
      return "none";
    };
    expect(limitOf(tooManyChains)).toBe("chains");
    expect(limitOf(withStep(stored, { headers: Array.from({ length: 101 }, () => ({ name: "X-A", value: "1" })) }))).toBe("rowsPerList");
    expect(limitOf(withStep(stored, { extractors: Array.from({ length: 11 }, (_u, i) => ({ id: `x${10 + i}`, name: `n${i}`, source: { kind: "body", path: "id" } })) }))).toBe("extractorsPerStep");
    expect(limitOf(withStep(stored, { checks: Array.from({ length: 11 }, (_u, i) => ({ id: `k${10 + i}`, kind: "time-at-most", maxMs: 5 })) }))).toBe("checksPerStep");
    const manySteps = inputOf(stored);
    manySteps.chains[0].steps = Array.from({ length: 51 }, (_u, i) => ({ ...manySteps.chains[0].steps[1], id: `s${10 + i}`, extractors: [], checks: [] }));
    expect(limitOf(manySteps)).toBe("stepsPerChain");
    expect(() => normalizePlanInput(withStep(stored, { body: { kind: "raw", contentType: "text/plain", text: "a".repeat(256 * 1024 + 1) } }), stored, NOW)).toThrow(InvalidStepError);
  });

  it("refuses a plan without chains, a bad name and an empty chain name", () => {
    expect(() => normalizePlanInput({ ...inputOf(stored), chains: [] }, stored, NOW)).toThrow(InvalidChainPlanError);
    expect(() => normalizePlanInput({ ...inputOf(stored), name: "  " }, stored, NOW)).toThrow(InvalidChainPlanError);
    const input = inputOf(stored);
    input.chains[0].name = "";
    expect(() => normalizePlanInput(input, stored, NOW)).toThrow(InvalidChainError);
  });

  it("accepts a plan with blockers: they are listed by the analysis, never refused on save", () => {
    const input = withStep(stored, { url: "{{baseUrl}}/c/{{not_yet}}", expectedStatuses: [] }, 1);
    expect(() => normalizePlanInput(input, stored, NOW)).not.toThrow();
  });
});

describe("normalizePlanInput: what the server keeps", () => {
  it("bumps the revision, keeps data sets and the seeding report, and normalises statuses", () => {
    const stored = customerLifecyclePlan({ revision: 4, seedingReport: { source: { kind: "specification", filename: "a.yaml" }, seededAt: NOW, items: [] } });
    const input = withStep(stored, { expectedStatuses: ["2xx", "201", "201"] }, 1);
    input.seedingReport = null;
    const saved = normalizePlanInput(input, stored, NOW);
    expect(saved.revision).toBe(5);
    expect(saved.updatedAt).toBe(NOW);
    expect(saved.seedingReport).toEqual(stored.seedingReport);
    expect(saved.chains[0].steps[1].expectedStatuses).toEqual(["2XX", "201"]);
  });

  it("keeps a stored step's source whatever the client sends, and makes a new step 'Added by you'", () => {
    const stored = seeded();
    const input = inputOf(stored) as unknown as { chains: { steps: Record<string, unknown>[] }[] };
    input.chains[0].steps[0].source = { kind: "added" };
    input.chains[0].steps.push({ ...input.chains[0].steps[2], id: "s8", extractors: [], checks: [] });
    const saved = normalizePlanInput(input, stored, NOW);
    expect(saved.chains[0].steps[0].source.kind).toBe("operation");
    expect(saved.chains[0].steps[7].source).toEqual({ kind: "added" });
    expect(saved.chains[0].steps[7].seedDigest).toBeNull();
    expect(saved.nextStepNumber).toBe(9);
  });

  it("marks a seeded step changed when its content differs, and clears it when edited back", () => {
    const stored = seeded();
    const edited = normalizePlanInput(withStep(stored, { body: { kind: "raw", contentType: "application/json", text: '{"name":"Real"}' } }, 1), stored, NOW);
    expect(edited.chains[0].steps.map((s) => s.changed)).toEqual([false, true, false, false, false, false, false]);
    const renamed = normalizePlanInput(withStep(stored, { name: "Another name" }, 1), stored, NOW);
    expect(renamed.chains[0].steps[1].changed).toBe(false);
    const reverted = normalizePlanInput(inputOf(stored), edited, NOW);
    expect(reverted.chains[0].steps[1].changed).toBe(false);
  });

  it("never reuses an id after a delete", () => {
    const stored = customerLifecyclePlan();
    const input = inputOf(stored);
    input.chains[0].steps.push({ ...input.chains[0].steps[2], id: "s3" });
    expect(() => normalizePlanInput(input, stored, NOW)).toThrow(/same id/);
    const afterDelete = normalizePlanInput({ ...inputOf(stored), chains: [{ ...inputOf(stored).chains[0], steps: inputOf(stored).chains[0].steps.slice(0, 6) }] }, stored, NOW);
    const reuse = inputOf(afterDelete);
    reuse.chains[0].steps.push({ ...reuse.chains[0].steps[2], id: "s7", extractors: [], checks: [] });
    expect(() => normalizePlanInput(reuse, afterDelete, NOW)).toThrow(/reuse the id/);
    const reuseItem = withStep(afterDelete, { checks: [{ id: "k1", kind: "time-at-most", maxMs: 5 }] }, 2);
    expect(() => normalizePlanInput(reuseItem, afterDelete, NOW)).toThrow(/reuse the id/);
  });
});

describe("planFingerprint", () => {
  const base = customerLifecyclePlan();
  const fingerprint = planFingerprint(base);

  it("changes with step content, the load profile, thresholds, secret names and data set structure", () => {
    const step2 = { ...base.chains[0].steps[1], url: "{{baseUrl}}/other" };
    expect(planFingerprint({ ...base, chains: [chain("c1", "Customer lifecycle", [base.chains[0].steps[0], step2, ...base.chains[0].steps.slice(2)])] })).not.toBe(fingerprint);
    expect(planFingerprint({ ...base, thinkTimeMs: 2000 })).not.toBe(fingerprint);
    expect(planFingerprint({ ...base, secretNames: ["client_secret", "token"] })).not.toBe(fingerprint);
    expect(planFingerprint({ ...base, thresholds: [{ id: "t", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 500 }] })).not.toBe(fingerprint);
    const dataSet = { id: "d1", name: "a", mode: "row-per-iteration" as const, columns: [{ name: "a", secret: false }], rowCount: 1, sizeBytes: 1, sha256: "1" };
    const withData = planFingerprint({ ...base, dataSets: [dataSet] });
    expect(withData).not.toBe(fingerprint);
    expect(planFingerprint({ ...base, dataSets: [{ ...dataSet, id: "d2", name: "renamed", rowCount: 9, sha256: "2", sizeBytes: 9 }] })).toBe(withData);
  });

  it("does not change with names, the seeding report, the target environment, sources or Changed marks", () => {
    const renamed = { ...base, name: "Other", targetEnvironmentId: "env", seedingReport: { source: { kind: "specification" as const, filename: "x" }, seededAt: NOW, items: [] } };
    expect(planFingerprint(renamed)).toBe(fingerprint);
    const steps = base.chains[0].steps.map((s) => ({ ...s, name: "renamed", changed: true, source: { kind: "operation" as const, operationKey: "a", label: "a", passwordFields: [] } }));
    expect(planFingerprint({ ...base, chains: [chain("c1", "Renamed chain", steps)] })).toBe(fingerprint);
  });

  it("is stable for an empty plan", () => {
    expect(planFingerprint(chainPlan())).toBe(planFingerprint(chainPlan({ name: "x" })));
    expect(planFingerprint(chainPlan({ chains: [chain("c1", "A", [step({ id: "s1" })])] }))).not.toBe(planFingerprint(chainPlan()));
  });
});
