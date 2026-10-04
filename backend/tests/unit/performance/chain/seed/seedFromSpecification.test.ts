import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeChainPlan } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../../../src/openapi/parseYaml";
import { validateSpec } from "../../../../../src/openapi/validateSpec";
import { generatePositiveScenarios } from "../../../../../src/testDesign/generateTestModel";
import { withQuickScenarioIds } from "../../../../../src/performance/quick/quickScenarioIds";
import { contextFromQuickTest } from "../../../../../src/performance/quick/quickTestStore";
import { assembleSeededPlan } from "../../../../../src/performance/chain/seed/assembleSeededPlan";
import { seedFromSpecification } from "../../../../../src/performance/chain/seed/seedFromSpecification";
import { toChainRequest } from "../../../../../src/performance/chain/seed/toChainStep";
import { renderChainScript } from "../../../../../src/performance/k6/renderChainScript";
import { openApiFixtureBuffer } from "../../../../fixtures/performance/specification";

/** AP-037 (specs/037-request-chain-performance tasks T049, T050; FR-020 to FR-023, FR-025, FR-027; research R15). */

const NOW = "2026-10-03T12:00:00.000Z";
const WEAK = readFileSync(path.join(__dirname, "..", "..", "..", "..", "fixtures", "chain", "weak-spec.yaml"));

async function contextOf(buffer: Buffer) {
  const { document, issues } = await validateSpec(parseYaml(buffer.toString("utf-8")));
  const apiModel = buildApiModel(document, issues);
  return contextFromQuickTest({ apiModel, scenarios: withQuickScenarioIds(generatePositiveScenarios(apiModel)) });
}

async function seed(buffer: Buffer, environment: { name: string; valueNames: string[] } | null = null, selectedOperationKeys?: string[]) {
  const context = await contextOf(buffer);
  return assembleSeededPlan({ ...seedFromSpecification({ ...context, selectedOperationKeys }, "spec.yaml", "Seeded", NOW), environment });
}

describe("toChainRequest", () => {
  it("splits the URL's query into rows, keeps headers, and turns a JSON body into raw application/json", () => {
    const converted = toChainRequest(
      { method: "post", url: "{{baseUrl}}/orders?state=open&q={{term}}", headers: [{ key: "Content-Type", value: "application/json" }, { key: "X-Trace", value: "{{trace-id}}" }], body: '{"email":"{{$randomEmail}}"}', bodyKind: "json", auth: { kind: "bearer", token: "{{accessToken}}" } },
      "x_basic",
    );
    expect(converted.request).toEqual({
      method: "POST",
      url: "{{baseUrl}}/orders",
      query: [
        { name: "state", value: "open" },
        { name: "q", value: "{{term}}" },
      ],
      headers: [
        { name: "X-Trace", value: "{{trace_id}}" },
        { name: "Authorization", value: "Bearer {{accessToken}}" },
      ],
      body: { kind: "raw", contentType: "application/json", text: '{"email":"{{$randomEmail}}"}' },
    });
  });

  it("turns API keys into a header or query row, a form body into fields, and basic auth into a header", () => {
    expect(toChainRequest({ method: "GET", url: "{{baseUrl}}/a", headers: [], auth: { kind: "apikey", in: "header", key: "X-Api-Key", value: "{{apiKey}}" } }, "b").request.headers).toEqual([{ name: "X-Api-Key", value: "{{apiKey}}" }]);
    expect(toChainRequest({ method: "GET", url: "{{baseUrl}}/a", headers: [], auth: { kind: "apikey", in: "query", key: "key", value: "{{apiKey}}" } }, "b").request.query).toEqual([{ name: "key", value: "{{apiKey}}" }]);
    const form = toChainRequest({ method: "POST", url: "{{baseUrl}}/token", headers: [], body: "grant_type=client_credentials&client_id={{clientId}}", bodyKind: "form", auth: { kind: "none" } }, "b").request.body;
    expect(form).toEqual({ kind: "form", fields: [{ name: "grant_type", value: "client_credentials" }, { name: "client_id", value: "{{clientId}}" }] });
    const literal = toChainRequest({ method: "GET", url: "{{baseUrl}}/a", headers: [], auth: { kind: "basic", username: "ada", password: "pw" } }, "b");
    expect(literal.request.headers).toEqual([{ name: "Authorization", value: `Basic ${Buffer.from("ada:pw").toString("base64")}` }]);
    const referenced = toChainRequest({ method: "GET", url: "{{baseUrl}}/a", headers: [], auth: { kind: "basic", username: "{{username}}", password: "{{password}}" } }, "Basic Auth_basic");
    expect(referenced).toEqual({ request: expect.objectContaining({ headers: [{ name: "Authorization", value: "Basic {{Basic_Auth_basic}}" }] }), basicValueName: "Basic_Auth_basic" });
  });
});

describe("seedFromSpecification", () => {
  it("seeds credentials before load, then one single-step chain per operation, leaving the login out (quick-performance.yaml)", async () => {
    const { plan } = await seed(openApiFixtureBuffer("quick-performance.yaml"));
    const chains = plan.chains.map((chain) => [chain.name, chain.steps.map((step) => [step.method, step.url, step.runs])]);
    expect(chains[0]).toEqual(["Credentials", [["POST", "{{baseUrl}}/auth/login", "once-before-load"]]]);
    expect(plan.chains[0].steps[0].extractors).toEqual([{ id: "x1", name: "loginAuthToken", source: { kind: "body", path: "accessToken" } }].map((extractor) => ({ ...extractor, name: plan.chains[0].steps[0].extractors[0].name })));
    expect(plan.chains.slice(1).every((chain) => chain.steps.length === 1 && chain.name === `${chain.steps[0].method} ${chain.steps[0].source.kind === "operation" ? chain.steps[0].source.operationKey.slice(chain.steps[0].method.length + 1) : ""}`)).toBe(true);
    expect(plan.chains.some((chain) => chain.name === "POST /auth/login")).toBe(false);
    const create = plan.chains.find((chain) => chain.name === "POST /orders")!.steps[0];
    expect(create.expectedStatuses).toEqual(["201"]);
    expect(create.body.kind === "raw" && create.body.text).toContain("{{$randomEmail}}");
    const token = plan.chains[0].steps[0].extractors[0].name;
    expect(create.headers).toContainEqual({ name: "Authorization", value: `Bearer {{${token}}}` });
    expect(plan.chains.find((chain) => chain.name === "GET /status")!.steps[0].expectedStatuses).toEqual([]);
  });

  it("seeds a Credentials chain only when the token operation is selected", async () => {
    const without = (await seed(openApiFixtureBuffer("quick-performance.yaml"), null, ["POST /orders"])).plan;
    expect(without.chains.map((chain) => chain.name)).toEqual(["POST /orders"]);
    expect(without.chains[0].steps[0].headers.some((header) => header.name === "Authorization")).toBe(true);
    const withLogin = (await seed(openApiFixtureBuffer("quick-performance.yaml"), null, ["POST /auth/login", "POST /orders"])).plan;
    expect(withLogin.chains.map((chain) => chain.name)).toEqual(["Credentials", "POST /orders"]);
    expect(withLogin.chains[0].steps[0].runs).toBe("once-before-load");
  });

  it("seeds no credential step for endpoints that need no token", async () => {
    // The fixture's GET /status inherits the global security; this copy makes it public.
    const marker = "      operationId: getStatus";
    const publicStatus = Buffer.from(openApiFixtureBuffer("quick-performance.yaml").toString("utf-8").replace(marker, `${marker}\n      security: []`));
    const { plan } = await seed(publicStatus, null, ["GET /status"]);
    expect(plan.chains.map((chain) => chain.name)).toEqual(["GET /status"]);
    expect(plan.chains[0].steps[0].headers.some((header) => header.name === "Authorization")).toBe(false);
  });

  it("is deterministic: the same specification seeds the same chains, steps, ids and digests", async () => {
    const first = (await seed(openApiFixtureBuffer("quick-performance.yaml"))).plan;
    const second = (await seed(openApiFixtureBuffer("quick-performance.yaml"))).plan;
    expect(second.chains).toEqual(first.chains);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.seedingReport).toEqual(first.seedingReport);
  });

  it("marks every seeded step unchanged, records its operation, and generates a script once statuses are set", async () => {
    const { plan } = await seed(openApiFixtureBuffer("quick-performance.yaml"));
    const steps = plan.chains.flatMap((chain) => chain.steps);
    expect(steps.every((step) => step.changed === false && step.seedDigest !== null && step.source.kind === "operation")).toBe(true);
    const analysis = analyzeChainPlan(plan, { environmentValueNames: null });
    expect(analysis.blockers.filter((blocker) => blocker.kind !== "missing-expected-status")).toEqual([]);
    const fixed = { ...plan, chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => ({ ...step, expectedStatuses: step.expectedStatuses.length ? step.expectedStatuses : ["200"] })) })) };
    expect(() => renderChainScript(fixed, analyzeChainPlan(fixed, { environmentValueNames: null }))).not.toThrow();
  });

  it("seeds a weak specification as written: placeholders, the documented 200, the documented path, and a recorded password field", async () => {
    const { plan } = await seed(WEAK);
    const create = plan.chains.find((chain) => chain.name === "POST /api/v1/customers")!.steps[0];
    expect(create.expectedStatuses).toEqual(["200"]);
    expect(plan.chains.map((chain) => chain.name)).toContain("PUT /customer/{customerId}");
    const put = plan.chains.find((chain) => chain.name === "PUT /customer/{customerId}")!.steps[0];
    expect(put.url).toBe("{{baseUrl}}/customer/{{customerId}}");
    const user = plan.chains.find((chain) => chain.name === "POST /users")!.steps[0];
    expect(user.source).toMatchObject({ kind: "operation", operationKey: "POST /users", passwordFields: ["password"] });
  });

  it("keeps a password field the specification declares as a secret reference, never as a literal", async () => {
    const { plan } = await seed(WEAK);
    const user = plan.chains.find((chain) => chain.name === "POST /users")!.steps[0];
    expect(user.body.kind === "raw" && JSON.parse(user.body.text).password).toBe("{{password}}");
    expect(plan.secretNames).toContain("password");
  });

  it("drops a literal credential with a report item when no environment is named, and moves it into one when named", () => {
    const step = {
      name: "Create a login",
      request: { method: "POST" as const, url: "{{baseUrl}}/users", query: [], headers: [{ name: "Authorization", value: "Bearer literal-1" }], body: { kind: "raw" as const, contentType: "application/json", text: '{"password":"hunter2"}' } },
      expectedStatuses: ["201"],
      extractors: [],
      runs: "every-iteration" as const,
      source: { kind: "operation" as const, operationKey: "POST /users", label: "POST /users", passwordFields: ["password"] },
    };
    const input = { name: "x", chains: [{ name: "Users", steps: [step] }], secretNames: [], now: NOW, report: { source: { kind: "specification" as const, filename: "a" }, seededAt: NOW, items: [] } };

    const dropped = assembleSeededPlan({ ...input, environment: null });
    expect(dropped.moves).toEqual([]);
    expect(dropped.plan.seedingReport?.items.map((item) => [item.kind, item.stepId])).toEqual([
      ["literal-credential-dropped", "s1"],
      ["literal-credential-dropped", "s1"],
    ]);
    const text = JSON.stringify(dropped.plan);
    expect(text).not.toContain("literal-1");
    expect(text).not.toContain("hunter2");

    const moved = assembleSeededPlan({ ...input, environment: { name: "Local stub", valueNames: [] } });
    expect(moved.moves.map((move) => [move.valueName, move.value])).toEqual([
      ["authorization_s1", "literal-1"],
      ["password_s1", "hunter2"],
    ]);
    expect(moved.plan.seedingReport?.items.every((item) => item.kind === "literal-credential-moved")).toBe(true);
    expect(moved.plan.chains[0].steps[0].changed).toBe(false);
  });
});
