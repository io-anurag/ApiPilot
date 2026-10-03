import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeChainPlan, type ChainPlan } from "@apipilot/shared-domain";
import { planFingerprint } from "../../../../src/performance/chain/savePlan";
import { CHAIN_RUNTIME, renderChainScript } from "../../../../src/performance/k6/renderChainScript";
import { checkUserScript } from "../../../../src/performance/userScript/checkUserScript";
import { chain, customerLifecyclePlan, dataSetPlan, step } from "../../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T024; FR-030, FR-047, SC-004; contracts/chain-script.md). */

const GOLDEN = path.join(__dirname, "..", "..", "..", "fixtures", "performance", "golden");

function withFingerprint(plan: ChainPlan): ChainPlan {
  return { ...plan, fingerprint: planFingerprint(plan) };
}

function render(plan: ChainPlan) {
  const fingerprinted = withFingerprint(plan);
  return renderChainScript(fingerprinted, analyzeChainPlan(fingerprinted, { environmentValueNames: null }));
}

function importsOf(script: string): string[] {
  return [...script.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
}

describe("renderChainScript", () => {
  it("renders the US1 chain byte-identically ten times, equal to the reviewed golden files", () => {
    const first = render(customerLifecyclePlan());
    for (let run = 0; run < 9; run += 1) expect(render(customerLifecyclePlan())).toEqual(first);
    expect(first.script).toBe(readFileSync(path.join(GOLDEN, "chain-script.js"), "utf-8"));
    expect(first.environmentTemplate).toBe(readFileSync(path.join(GOLDEN, "chain-environment-template.json"), "utf-8"));
  });

  it("is accepted by AP-034's script check when the plan has no data sets (AP-029 FR-022a)", () => {
    const result = checkUserScript(Buffer.from(render(customerLifecyclePlan()).script, "utf-8"));
    expect(result.accepted).toBe(true);
    expect(result.accepted && result.envNames.map((entry) => entry.name)).toEqual(["APIPILOT_RUN_TAG", "APIPILOT_V_0", "APIPILOT_V_1", "APIPILOT_V_2"]);
  });

  it("imports only k6's built-ins, and k6/data only with data sets", () => {
    expect(importsOf(render(customerLifecyclePlan()).script)).toEqual(["k6/http", "k6", "k6/metrics", "k6/execution"]);
  });

  it("writes the same fixed runtime for every plan", () => {
    const small = render(customerLifecyclePlan()).script;
    const other = render(customerLifecyclePlan({ chains: [chain("c1", "A", [step({ id: "s1" })])], thinkTimeMs: 0 })).script;
    expect(small.endsWith(`${CHAIN_RUNTIME}\n`)).toBe(true);
    expect(other.endsWith(`${CHAIN_RUNTIME}\n`)).toBe(true);
  });

  it("lists value names sorted, maps each to its variable, and marks secrets in the template", () => {
    const rendered = render(customerLifecyclePlan());
    expect(rendered.valueIndex).toEqual({ baseUrl: 0, client_id: 1, client_secret: 2 });
    expect(JSON.parse(rendered.environmentTemplate)).toEqual({
      baseUrl: { env: "APIPILOT_V_0", secret: false, value: "" },
      client_id: { env: "APIPILOT_V_1", secret: false, value: "" },
      client_secret: { env: "APIPILOT_V_2", secret: true, value: "" },
    });
  });

  it("rewrites each dynamic variable occurrence to its own token, in plan order", () => {
    const plan = customerLifecyclePlan({
      chains: [chain("c1", "A", [step({ id: "s1", url: "{{baseUrl}}/a/{{$guid}}", query: [{ name: "x", value: "{{$guid}}" }], headers: [{ name: "X-Id", value: "{{$randomUUID}}" }] })])],
    });
    const script = render(plan).script;
    expect(script).toContain('"url": "{{baseUrl}}/a/{{apipilot_dyn_0}}"');
    expect(script).toContain('"value": "{{apipilot_dyn_1}}"');
    expect(script).toContain('"value": "{{apipilot_dyn_2}}"');
    expect(script).toContain('"apipilot_dyn_2": {\n    "kind": "$randomUUID"');
  });

  it("writes setup steps apart, pre-parses field paths, lower-cases header extractors and marks what a step needs", () => {
    const plan = customerLifecyclePlan();
    plan.chains[0].steps[2] = { ...plan.chains[0].steps[2], extractors: [{ id: "x9", name: "location", source: { kind: "header", name: "Location" } }] };
    plan.chains[0].steps[4] = { ...plan.chains[0].steps[4], checks: [{ id: "k3", kind: "field-equals", path: "items[0].id", expected: { type: "text", value: "{{customer_id}}" } }] };
    const script = render(plan).script;
    const tables = new Function(`${script.slice(script.indexOf("const SETUP_STEPS"), script.indexOf("const DATA ="))} return { SETUP_STEPS, CHAINS };`)() as {
      SETUP_STEPS: { id: string; needs: string[]; readsBody: boolean }[];
      CHAINS: { steps: { id: string; uses: string[]; refreshFrom: string[]; needs: string[]; extractors: unknown[]; checks: { path: unknown[] }[] }[] }[];
    };
    expect(tables.SETUP_STEPS.map((s) => [s.id, s.needs])).toEqual([["s1", ["baseUrl", "client_id", "client_secret"]]]);
    const steps = tables.CHAINS[0].steps;
    expect(steps.map((s) => s.id)).toEqual(["s2", "s3", "s4", "s5", "s6", "s7"]);
    expect(steps[0]).toMatchObject({ uses: ["token"], refreshFrom: ["s1"], needs: ["baseUrl"] });
    expect(steps[2]).toMatchObject({ uses: ["customer_id", "token"] });
    expect(steps[1].extractors).toEqual([{ name: "location", header: "location" }]);
    expect(steps[3].checks[0].path).toEqual(["items", 0, "id"]);
  });

  it("does not depend on data set content: the same structure renders the same bytes", () => {
    const dataSet = { id: "d1", name: "customers", mode: "row-per-iteration" as const, columns: [{ name: "first_name", secret: false }], rowCount: 50, sizeBytes: 100, sha256: "a".repeat(64) };
    const plan = customerLifecyclePlan();
    plan.chains[0].steps[1] = { ...plan.chains[0].steps[1], body: { kind: "raw", contentType: "application/json", text: '{"name":"{{first_name}}"}' } };
    const first = render({ ...plan, dataSets: [dataSet] });
    const second = render({ ...plan, dataSets: [{ ...dataSet, id: "d9", name: "other", rowCount: 3, sizeBytes: 7, sha256: "b".repeat(64) }] });
    expect(second.script).toBe(first.script);
    expect(importsOf(first.script)).toContain("k6/data");
    expect(first.script).toContain('open("./apipilot-data-0.json")');
    expect(first.valueIndex).not.toHaveProperty("first_name");
  });

  it("is refused by AP-034's check when the plan reads a data set, as clarified (FR-047)", () => {
    const plan = customerLifecyclePlan({ dataSets: [{ id: "d1", name: "c", mode: "row-per-iteration", columns: [{ name: "first_name", secret: false }], rowCount: 1, sizeBytes: 1, sha256: "a" }] });
    const result = checkUserScript(Buffer.from(render(plan).script, "utf-8"));
    expect(result.accepted).toBe(false);
  });

  it("never writes an environment value, a plan name or seeding report text", () => {
    const plan = customerLifecyclePlan({ name: "PLAN-NAME-MARKER", seedingReport: { source: { kind: "specification", filename: "REPORT-MARKER.yaml" }, seededAt: "t", items: [] } });
    const rendered = render(plan);
    expect(rendered.script).not.toContain("PLAN-NAME-MARKER");
    expect(rendered.script).not.toContain("REPORT-MARKER");
    expect(rendered.script).not.toContain("Customer lifecycle");
  });

  it("renders a data-set plan equal to its reviewed golden, the same for any file content (FR-047)", () => {
    const rendered = render(dataSetPlan());
    expect(rendered.script).toBe(readFileSync(path.join(GOLDEN, "chain-script-data.js"), "utf-8"));
    const other = render(dataSetPlan({ dataSets: [{ ...dataSetPlan().dataSets[0], rowCount: 7, sizeBytes: 9, sha256: "f".repeat(64) }] }));
    expect(other.script).toBe(rendered.script);
    expect(rendered.valueIndex).not.toHaveProperty("email");
  });
});
