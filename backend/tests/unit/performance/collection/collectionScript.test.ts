import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleCollectionPlan, defaultCollectionChoices, type CollectionPlanChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import { collectionScriptInputs } from "../../../../src/performance/collection/collectionEngine";
import { SUPPORTED_DYNAMIC_VARIABLES } from "../../../../src/performance/collection/dynamicValues";
import { renderScriptFrom } from "../../../../src/performance/k6/renderScript";
import { planSnapshotForRun } from "../../../../src/performance/plan/runSnapshot";
import { checkUserScript } from "../../../../src/performance/userScript/checkUserScript";
import { APIFOUNDRY_REQUEST_IDS, apifoundryCollection } from "../../../fixtures/collections/collectionBuilders";
import { loadScript, type SandboxRequest, type SandboxResponse } from "../../../fixtures/performance/k6Sandbox";

/** AP-036 FR-023, FR-027, FR-028, SC-002, SC-004 (tasks T028). */

const GOLDEN = path.join(__dirname, "..", "..", "..", "fixtures", "performance", "golden");
const SEEDED_LITERAL = "SEEDED-LITERAL-3b9d";
const BASE = "http://127.0.0.1:4600";

/**
 * The fixture's own JSON, whose items all carry ids. `ensureStableIds` would also give each script
 * event a new random id, and so a new collection digest, on every call; an upload does that once.
 */
function source(collection: Record<string, unknown>) {
  return { id: "c-apifoundry", name: "APIFoundry", tier: "local" as const, json: JSON.stringify(collection) };
}

function render(collection: Record<string, unknown>, choices: Partial<CollectionPlanChoices> = {}) {
  const assembly = assembleCollectionPlan(source(collection), { ...defaultCollectionChoices([...APIFOUNDRY_REQUEST_IDS]), ...choices }, { supportedDynamicVariables: SUPPORTED_DYNAMIC_VARIABLES });
  return { assembly, rendered: renderScriptFrom(assembly.plan, collectionScriptInputs(assembly)) };
}

function envFor(valueIndex: Record<string, number>, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).flatMap(([name, value]) => (valueIndex[name] === undefined ? [] : [[`APIPILOT_V_${valueIndex[name]}`, value]])));
}

/** A customers API that issues tokens and ids, and answers 401 without a token or 404 for an unknown id. */
function customers(options: { expiresIn?: number } = {}) {
  let tokens = 0;
  let ids = 0;
  const live = new Set<string>();
  const issued = new Set<string>();
  const respond = (request: SandboxRequest): SandboxResponse => {
    const url = request.url.slice(BASE.length);
    if (url === "/auth/token") {
      tokens += 1;
      issued.add(`tok-${tokens}`);
      return { status: 200, body: { access_token: `tok-${tokens}`, ...(options.expiresIn ? { expires_in: options.expiresIn } : {}) } };
    }
    if (!issued.has((request.headers.Authorization ?? "").replace("Bearer ", ""))) return { status: 401, body: {} };
    if (url === "/api/v1/customers" && request.method === "POST") {
      ids += 1;
      live.add(`c-${ids}`);
      return { status: 201, body: { id: `c-${ids}` } };
    }
    const item = /^\/api\/v1\/customers\/(.+)$/.exec(url);
    if (item) {
      if (!live.has(decodeURIComponent(item[1]))) return { status: 404, body: {} };
      if (request.method === "DELETE") {
        live.delete(decodeURIComponent(item[1]));
        return { status: 204 };
      }
      return { status: 200, body: { id: item[1] } };
    }
    return { status: 200, body: {} };
  };
  return { respond, counts: () => ({ tokens, ids }) };
}

describe("a collection plan's script", () => {
  it("matches the reviewed golden script, byte-identical over ten builds and renders, and passes AP-034's check", () => {
    const first = render(apifoundryCollection({ dynamicBody: false })).rendered;
    for (let index = 0; index < 9; index++) expect(render(apifoundryCollection({ dynamicBody: false })).rendered).toEqual(first);
    expect(first.script).toBe(readFileSync(path.join(GOLDEN, "collection-script.js"), "utf-8"));
    const check = checkUserScript(Buffer.from(first.script));
    expect(check.accepted).toBe(true);
    expect(check.hosts).toEqual([]);
  });

  it("names every request after its step", () => {
    const { assembly, rendered } = render(apifoundryCollection({ dynamicBody: false }));
    const k6 = loadScript(rendered.script, { env: envFor(rendered.valueIndex, { baseUrl: BASE, client_id: "id", client_secret: "secret" }), respond: customers().respond });
    k6.iterate(k6.setup());
    const journeyRequests = k6.requests.filter((request) => request.tags.step !== undefined);
    expect(journeyRequests.map((request) => request.tags.step)).toEqual(assembly.plan.journeys[0].steps.map((step) => step.id));
    expect(k6.requests.filter((request) => request.tags.apipilot_kind === "token-setup")).toHaveLength(1);
  });

  it("writes no literal credential into the script, the template, the plan or the run snapshot", () => {
    const collection = apifoundryCollection({ dynamicBody: false });
    (collection as { auth: unknown }).auth = { type: "bearer", bearer: [{ key: "token", value: SEEDED_LITERAL }] };
    const customersFolder = (collection.item as { id: string; item: { id: string; request: { header: unknown[] } }[] }[]).find((item) => item.id === "folder-customers")!;
    customersFolder.item[0].request.header.push({ key: "X-API-Key", value: SEEDED_LITERAL });
    const { assembly, rendered } = render(collection);
    for (const artifact of [rendered.script, rendered.environmentTemplate, JSON.stringify(assembly.plan), JSON.stringify(planSnapshotForRun(assembly.plan))]) {
      expect(artifact).not.toContain(SEEDED_LITERAL);
    }
    expect(assembly.plan.userSuppliedValues.filter((value) => value.source === "collection-literal").every((value) => value.secret)).toBe(true);
  });

  it("obtains the token once and shares it, and each virtual user uses its own customer id (FR-027, SC-002)", () => {
    const { rendered } = render(apifoundryCollection({ dynamicBody: false }));
    const target = customers();
    const env = envFor(rendered.valueIndex, { baseUrl: BASE, client_id: "id", client_secret: "secret" });
    const first = loadScript(rendered.script, { env, respond: target.respond, vu: 1 });
    const data = first.setup();
    const second = loadScript(rendered.script, { env, respond: target.respond, vu: 2 });
    for (let iteration = 0; iteration < 5; iteration++) {
      first.iterate(data, iteration);
      second.iterate(data, iteration);
    }
    expect(target.counts().tokens).toBe(1);
    for (const k6 of [first, second]) {
      const statuses = k6.checks.filter((check) => check.name === "status");
      expect(statuses.every((check) => check.passed)).toBe(true);
      const creates = k6.requests.filter((request) => request.method === "POST" && request.url.endsWith("/api/v1/customers"));
      expect(creates).toHaveLength(5);
    }
    expect(target.counts().ids).toBe(10);
  });

  it("refreshes the token per virtual user before its stated lifetime ends (FR-028)", () => {
    const { rendered } = render(apifoundryCollection({ dynamicBody: false }));
    const target = customers({ expiresIn: 10 });
    const k6 = loadScript(rendered.script, { env: envFor(rendered.valueIndex, { baseUrl: BASE, client_id: "id", client_secret: "secret" }), respond: target.respond });
    const data = k6.setup();
    k6.iterate(data, 0);
    k6.clock.now += 9_500;
    k6.iterate(data, 1);
    expect(k6.metrics.filter((metric) => metric.name === "apipilot_token_refresh").map((metric) => metric.tags.outcome)).toEqual(["ok"]);
    expect(k6.checks.filter((check) => check.name === "status").every((check) => check.passed)).toBe(true);
    expect(target.counts().tokens).toBe(2);
  });
});
