import { describe, expect, it } from "vitest";
import {
  analyzeChainPlan,
  chainRunOrder,
  namesAvailableAt,
  parseReferences,
  summarizeChainWrites,
  type Chain,
  type ChainPlan,
  type ChainStep,
  type DataSetInfo,
} from "../../src";

/** AP-037 (specs/037-request-chain-performance tasks T009, research R3, R5 to R7). */
function step(overrides: Partial<ChainStep> & Pick<ChainStep, "id">): ChainStep {
  return {
    name: overrides.id,
    method: "GET",
    url: "{{baseUrl}}/health",
    query: [],
    headers: [],
    body: { kind: "none" },
    expectedStatuses: ["200"],
    extractors: [],
    checks: [],
    runs: "every-iteration",
    thinkTimeMs: null,
    source: { kind: "added" },
    seedDigest: null,
    changed: false,
    ...overrides,
  };
}

function extracts(id: string, name: string, path = "id"): ChainStep["extractors"][number] {
  return { id, name, source: { kind: "body", path } };
}

function plan(chains: Chain[], extra: Partial<Pick<ChainPlan, "dataSets" | "secretNames">> = {}): Pick<ChainPlan, "chains" | "dataSets" | "secretNames"> {
  return { chains, dataSets: extra.dataSets ?? [], secretNames: extra.secretNames ?? [] };
}

const NO_ENVIRONMENT = { environmentValueNames: null };

function dataSet(id: string, columns: string[], secret: string[] = []): DataSetInfo {
  return { id, name: id, mode: "row-per-iteration", columns: columns.map((name) => ({ name, secret: secret.includes(name) })), rowCount: 3, sizeBytes: 10, sha256: "0".repeat(64) };
}

describe("parseReferences", () => {
  it("reads names, supported dynamic variables and invalid references", () => {
    expect(parseReferences("{{baseUrl}}/a/{{customer_id}}?x={{$guid}}")).toEqual([
      { kind: "name", name: "baseUrl", raw: "{{baseUrl}}" },
      { kind: "name", name: "customer_id", raw: "{{customer_id}}" },
      { kind: "dynamic", name: "$guid", raw: "{{$guid}}" },
    ]);
    expect(parseReferences("{{$notSupported}} {{a b}} {{}}")).toEqual([
      { kind: "invalid", raw: "{{$notSupported}}" },
      { kind: "invalid", raw: "{{a b}}" },
      { kind: "invalid", raw: "{{}}" },
    ]);
  });

  it("treats a lone {{ or }} as text, and flags text between them that is not a name", () => {
    expect(parseReferences('{"a": "{{"}')).toEqual([]);
    expect(parseReferences('{"b": "}}"}')).toEqual([]);
    expect(parseReferences('{"a": "{{", "b": "}}"}')).toEqual([{ kind: "invalid", raw: '{{", "b": "}}' }]);
  });

  it("accepts every supported dynamic variable", () => {
    const names = ["$guid", "$randomUUID", "$timestamp", "$isoTimestamp", "$randomInt", "$randomFirstName", "$randomLastName", "$randomFullName", "$randomUserName", "$randomEmail", "$randomPhoneNumber", "$randomAlphaNumeric", "$randomBoolean"];
    for (const name of names) expect(parseReferences(`{{${name}}}`)).toEqual([{ kind: "dynamic", name, raw: `{{${name}}}` }]);
  });
});

describe("chainRunOrder", () => {
  it("puts Once before load steps first, in plan order, then one iteration", () => {
    const order = chainRunOrder(
      plan([
        { id: "c1", name: "A", steps: [step({ id: "s1" }), step({ id: "s2", runs: "once-before-load" })] },
        { id: "c2", name: "B", steps: [step({ id: "s3", runs: "once-before-load" }), step({ id: "s4", runs: "once-per-virtual-user" })] },
      ]),
    );
    expect(order.setup.map((entry) => [entry.step.id, entry.position])).toEqual([
      ["s2", 0],
      ["s3", 1],
    ]);
    expect(order.iteration.map((entry) => [entry.step.id, entry.chainId, entry.position])).toEqual([
      ["s1", "c1", 0],
      ["s4", "c2", 1],
    ]);
  });
});

describe("analyzeChainPlan", () => {
  it("blocks a use before extraction within a chain and across chains, and never refuses the order", () => {
    const analysis = analyzeChainPlan(
      plan([
        { id: "c1", name: "A", steps: [step({ id: "s1", url: "{{baseUrl}}/c/{{customer_id}}" }), step({ id: "s2", extractors: [extracts("x1", "customer_id")] })] },
        { id: "c2", name: "B", steps: [step({ id: "s3", url: "{{baseUrl}}/o/{{order_id}}" })] },
        { id: "c3", name: "C", steps: [step({ id: "s4", extractors: [extracts("x2", "order_id")] }), step({ id: "s5", url: "{{baseUrl}}/o/{{order_id}}" })] },
      ]),
      NO_ENVIRONMENT,
    );
    expect(analysis.blockers).toEqual([
      { kind: "use-before-extraction", stepId: "s1", name: "customer_id" },
      { kind: "use-before-extraction", stepId: "s3", name: "order_id" },
    ]);
  });

  it("counts a per-virtual-user extractor only for later positions", () => {
    const analysis = analyzeChainPlan(
      plan([
        {
          id: "c1",
          name: "A",
          steps: [
            step({ id: "s1", url: "{{baseUrl}}/a/{{login}}" }),
            step({ id: "s2", runs: "once-per-virtual-user", extractors: [extracts("x1", "login")] }),
            step({ id: "s3", url: "{{baseUrl}}/b/{{login}}" }),
          ],
        },
      ]),
      NO_ENVIRONMENT,
    );
    expect(analysis.blockers).toEqual([{ kind: "use-before-extraction", stepId: "s1", name: "login" }]);
  });

  it("lets a setup step use environment values, dynamic variables, data set columns and earlier setup extractions only", () => {
    const analysis = analyzeChainPlan(
      plan(
        [
          {
            id: "c1",
            name: "A",
            steps: [
              step({ id: "s1", runs: "once-before-load", method: "POST", url: "{{baseUrl}}/token", body: { kind: "form", fields: [{ name: "user", value: "{{username}}" }, { name: "n", value: "{{$guid}}" }] }, extractors: [extracts("x1", "token", "access_token")] }),
              step({ id: "s2", runs: "once-before-load", headers: [{ name: "Authorization", value: "Bearer {{token}}" }, { name: "X-Client", value: "{{client_id}}" }] }),
              step({ id: "s3", runs: "once-before-load", url: "{{baseUrl}}/c/{{customer_id}}" }),
              step({ id: "s4", runs: "once-before-load", url: "{{baseUrl}}/late/{{late}}" }),
              step({ id: "s5", runs: "once-before-load", extractors: [extracts("x2", "late")] }),
              step({ id: "s6", extractors: [extracts("x3", "customer_id")] }),
            ],
          },
        ],
        { dataSets: [dataSet("d1", ["username"])] },
      ),
      NO_ENVIRONMENT,
    );
    expect(analysis.blockers).toEqual([
      { kind: "setup-uses-iteration-value", stepId: "s3", name: "customer_id" },
      { kind: "use-before-extraction", stepId: "s4", name: "late" },
    ]);
    expect(analysis.dataSetUsage).toEqual([{ dataSetId: "d1", column: "username", stepIds: ["s1"] }]);
  });

  it("blocks hosts from variables, invalid URLs, missing statuses, invalid references and field paths", () => {
    const analysis = analyzeChainPlan(
      plan([
        {
          id: "c1",
          name: "A",
          steps: [
            step({ id: "s1", url: "{{host}}/a" }),
            step({ id: "s2", url: "https://{{tenant}}.example.test/a" }),
            step({ id: "s3", url: "/relative" }),
            step({ id: "s4", url: "{{baseUrl}}/a?x=1" }),
            step({ id: "s5", expectedStatuses: [] }),
            step({ id: "s6", headers: [{ name: "X-Bad", value: "{{a b}}" }] }),
            step({ id: "s7", extractors: [extracts("x1", "id", "items[*].id")] }),
            step({ id: "s8", url: "https://api.example.test:8443/v1" }),
          ],
        },
      ]),
      NO_ENVIRONMENT,
    );
    expect(analysis.blockers.map((blocker) => [blocker.kind, "stepId" in blocker ? blocker.stepId : null])).toEqual([
      ["host-from-variable", "s1"],
      ["host-from-variable", "s2"],
      ["invalid-url", "s3"],
      ["invalid-url", "s4"],
      ["missing-expected-status", "s5"],
      ["invalid-reference", "s6"],
      ["invalid-field-path", "s7"],
    ]);
    expect(analysis.blockers[0]).toEqual({ kind: "host-from-variable", stepId: "s1", name: "host" });
    expect(analysis.blockers[1]).toEqual({ kind: "host-from-variable", stepId: "s2", name: "tenant" });
    expect(analysis.hosts).toEqual(["{{baseUrl}}", "https://api.example.test:8443"]);
  });

  it("lists empty chains as notices and blocks a plan with no iteration step", () => {
    const onlySetup = analyzeChainPlan(plan([{ id: "c1", name: "A", steps: [step({ id: "s1", runs: "once-before-load" })] }, { id: "c2", name: "B", steps: [] }]), NO_ENVIRONMENT);
    expect(onlySetup.notices).toEqual([
      { kind: "empty-chain", chainId: "c1" },
      { kind: "empty-chain", chainId: "c2" },
    ]);
    expect(onlySetup.blockers).toEqual([{ kind: "no-runnable-chain" }]);
  });

  it("lists names extracted twice, columns shadowing environment values and unused data sets", () => {
    const analysis = analyzeChainPlan(
      plan(
        [{ id: "c1", name: "A", steps: [step({ id: "s1", extractors: [extracts("x1", "id")] }), step({ id: "s2", extractors: [extracts("x2", "id")], url: "{{baseUrl}}/{{tenant_id}}" })] }],
        { dataSets: [dataSet("d1", ["tenant_id"]), dataSet("d2", ["unused"])] },
      ),
      { environmentValueNames: ["baseUrl", "tenant_id"] },
    );
    expect(analysis.notices).toEqual([
      { kind: "extracted-more-than-once", name: "id", stepIds: ["s1", "s2"] },
      { kind: "column-shadows-environment", name: "tenant_id", dataSetId: "d1" },
      { kind: "data-set-unused", dataSetId: "d2" },
    ]);
    expect(analysis.extractedNames).toEqual([{ name: "id", stepIds: ["s1", "s2"] }]);
  });

  it("lists required values with their steps, secret flag and whether the environment provides them", () => {
    const steps = [
      step({ id: "s1", method: "POST", url: "{{baseUrl}}/token", body: { kind: "form", fields: [{ name: "client_secret", value: "{{client_secret}}" }] } }),
      step({ id: "s2", headers: [{ name: "X-Tenant", value: "{{tenant}}" }], checks: [{ id: "k1", kind: "field-equals", path: "a", expected: { type: "text", value: "{{expected}}" } }] }),
    ];
    const withEnvironment = analyzeChainPlan(plan([{ id: "c1", name: "A", steps }], { secretNames: ["client_secret"] }), { environmentValueNames: ["baseUrl", "client_secret"] });
    expect(withEnvironment.requiredValues).toEqual([
      { name: "baseUrl", stepIds: ["s1", "s2"], secret: false, provided: true },
      { name: "client_secret", stepIds: ["s1"], secret: true, provided: true },
      { name: "expected", stepIds: ["s2"], secret: false, provided: false },
      { name: "tenant", stepIds: ["s2"], secret: false, provided: false },
    ]);
    const without = analyzeChainPlan(plan([{ id: "c1", name: "A", steps }]), NO_ENVIRONMENT);
    expect(without.requiredValues.every((value) => value.provided === null)).toBe(true);
  });

  // plan.md Performance Goals: under 10 ms for 1,000 steps, measured alone. The suite runs in parallel
  // workers, so the assertion allows headroom; it still fails for anything worse than linear.
  it("analyses 1,000 steps well within an editor keystroke", () => {
    const chains: Chain[] = Array.from({ length: 20 }, (_unused, chainIndex) => ({
      id: `c${chainIndex + 1}`,
      name: `Chain ${chainIndex + 1}`,
      steps: Array.from({ length: 50 }, (_ignored, stepIndex) => {
        const n = chainIndex * 50 + stepIndex;
        return step({
          id: `s${n + 1}`,
          url: `{{baseUrl}}/items/{{id_${n}}}`,
          headers: [{ name: "Authorization", value: "Bearer {{token}}" }],
          extractors: [extracts(`x${n + 1}`, `id_${n + 1}`)],
        });
      }),
    }));
    const subject = plan(chains);
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      analyzeChainPlan(subject, NO_ENVIRONMENT);
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    expect(timings[2]).toBeLessThan(50);
  });
});

describe("namesAvailableAt", () => {
  it("offers setup extractions, then earlier iteration extractions, in run order", () => {
    const subject = plan([
      { id: "c1", name: "A", steps: [step({ id: "s1", extractors: [extracts("x1", "customer_id")] }), step({ id: "s2" })] },
      { id: "c2", name: "B", steps: [step({ id: "s3", runs: "once-before-load", extractors: [extracts("x2", "token")] })] },
    ]);
    expect(namesAvailableAt(subject, "s2")).toEqual(["token", "customer_id"]);
    expect(namesAvailableAt(subject, "s1")).toEqual(["token"]);
    expect(namesAvailableAt(subject, "s3")).toEqual([]);
  });
});

describe("summarizeChainWrites", () => {
  it("counts each write step, by method in the fixed order, in plan order", () => {
    const summary = summarizeChainWrites(
      plan([
        { id: "c1", name: "Lifecycle", steps: [step({ id: "s1", method: "DELETE" }), step({ id: "s2", method: "POST" }), step({ id: "s3" }), step({ id: "s4", method: "POST" })] },
      ]),
    );
    expect(summary.total).toBe(3);
    expect(summary.byMethod).toEqual([
      { method: "POST", count: 2 },
      { method: "DELETE", count: 1 },
    ]);
    expect(summary.operations.map((entry) => [entry.operationKey, entry.effect, entry.steps[0].journeyLabel])).toEqual([
      ["s1", "deletes", "Lifecycle"],
      ["s2", "creates", "Lifecycle"],
      ["s4", "creates", "Lifecycle"],
    ]);
  });
});
