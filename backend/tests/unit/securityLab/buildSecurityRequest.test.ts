import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel, SecurityProfile, SecurityScenarioContent } from "@apipilot/shared-domain";
import { buildSecurityRequest, type BuildInput, type BuildResult } from "../../../src/securityLab/execution/buildSecurityRequest";
import { INJECTION_PROBES, INVALID_CREDENTIAL_VALUE, MALFORMED_CREDENTIAL_VALUE } from "../../../src/securityLab/execution/probes";
import { CREDENTIAL_PLACEHOLDER, PLACEHOLDER_DUMMY_VALUE } from "../../../src/securityLab/scenarios/credentialPlaceholders";
import { makeContent } from "../../fixtures/securityLab/builders";
import {
  ALICE_KEY,
  ALICE_TOKEN,
  BOB_TOKEN,
  fixtureCredential,
  fullProfile,
  generatedScenarios,
  pick,
  sampleModel,
  type GeneratedFixture,
} from "../../fixtures/securityLab/runFixtures";

const BASE = "http://127.0.0.1:4700";

let model: ApiModel;
let scenarios: GeneratedFixture[];

beforeEach(async () => {
  model = await sampleModel();
  scenarios = generatedScenarios(model, fullProfile());
});

function build(content: SecurityScenarioContent, overrides: Partial<BuildInput> = {}): BuildResult {
  return buildSecurityRequest({ content, apiModel: model, profile: fullProfile(), baseUrl: BASE, credential: fixtureCredential, ...overrides });
}

function built(content: SecurityScenarioContent, overrides: Partial<BuildInput> = {}) {
  const result = build(content, overrides);
  if (!result.ok) throw new Error(`Expected a request, got ${result.code}: ${result.message}`);
  return result;
}

function failure(content: SecurityScenarioContent, overrides: Partial<BuildInput> = {}) {
  const result = build(content, overrides);
  if (result.ok) throw new Error("Expected the build to fail");
  return result;
}

describe("where the request goes", () => {
  it("is the profile's base URL plus the operation's path, and nothing from the scenario", () => {
    const { request } = built(pick(scenarios, "GET /orders", "auth.omit").content);
    expect(request.method).toBe("GET");
    expect(request.url).toBe(`${BASE}/orders`);
    expect(request.headers["user-agent"]).toBe("ApiPilot-SecurityLab");
    expect(request.headers["accept-encoding"]).toBe("identity");
  });

  it("keeps a path prefix on the base URL and drops a trailing slash", () => {
    expect(built(pick(scenarios, "GET /orders", "auth.omit").content, { baseUrl: `${BASE}/api/v2/` }).request.url).toBe(`${BASE}/api/v2/orders`);
  });

  it("drops headers that could change the destination or the framing, and keeps ordinary ones", () => {
    const content = makeContent({
      ...pick(scenarios, "GET /orders", "auth.omit").content,
      baseRequest: { pathParameters: {}, queryParameters: {}, headers: { Host: "evil.test", "Content-Length": "5", "Transfer-Encoding": "chunked", Connection: "upgrade", "Proxy-Authorization": "x", "X-Trace": "t1", "bad name": "x" } },
    });
    const { headers } = built(content).request;
    for (const name of ["host", "content-length", "transfer-encoding", "connection", "proxy-authorization", "bad name"]) expect(headers).not.toHaveProperty(name);
    expect(headers["x-trace"]).toBe("t1");
  });

  it("cannot be steered to another host by a path parameter value", () => {
    const content = makeContent({
      ...pick(scenarios, "GET /orders/{orderId}", "path-id.substitute").content,
      mutations: [],
      baseRequest: { pathParameters: { orderId: "https://evil.test/x?y=1#z" }, queryParameters: {}, headers: {} },
      requiredIdentities: [{ role: "any", label: "any" }],
    });
    const { url } = built(content).request;
    expect(url.startsWith(`${BASE}/orders/`)).toBe(true);
    expect(new URL(url).host).toBe("127.0.0.1:4700");
    expect(url).toContain(encodeURIComponent("https://evil.test/x?y=1#z"));
  });

  it("fails with a named code when the operation is no longer in the specification", () => {
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, operationKey: "GET /gone", operationPath: "/gone" });
    expect(failure(content)).toMatchObject({ code: "operation_missing" });
  });

  it("fails when a path parameter has no value", () => {
    const content = makeContent({ ...pick(scenarios, "GET /orders/{orderId}", "path-id.substitute").content, mutations: [], baseRequest: { pathParameters: {}, queryParameters: {}, headers: {} } });
    expect(failure(content)).toMatchObject({ code: "url_not_buildable" });
  });
});

describe("credentials: the scheme and the identity", () => {
  it("sends a valid credential of an identity that holds one, as a bearer token, for a scenario with no credential mutation", () => {
    const scenario = scenarios.find((entry) => entry.content.operationKey === "GET /orders" && entry.content.categoryId === "security-misconfiguration" && !entry.content.mutations.some((m) => m.kind.startsWith("auth.")));
    const content = scenario?.content ?? makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [], requiredIdentities: [{ role: "any", label: "any" }] });
    const result = built(content);
    expect(result.request.headers.authorization).toBe(`Bearer ${ALICE_TOKEN}`);
    expect(result.identity).toBe("alice");
    expect(result.scheme).toBe("bearerAuth");
    expect(result.secrets).toContain(ALICE_TOKEN);
  });

  it("omits the credential for auth.omit, and puts no credential value on the request or in secrets", () => {
    const result = built(pick(scenarios, "GET /orders", "auth.omit").content);
    expect(result.request.headers).not.toHaveProperty("authorization");
    expect(result.secrets).toEqual([]);
    expect(result.identity).toBeUndefined();
    expect(JSON.stringify(result.request)).not.toContain(ALICE_TOKEN);
  });

  it("sends a fixed invalid credential for auth.invalid-token, never an identity's", () => {
    const result = built(pick(scenarios, "GET /orders", "auth.invalid-token").content);
    expect(result.request.headers.authorization).toBe(`Bearer ${INVALID_CREDENTIAL_VALUE}`);
    expect(result.secrets).toEqual([]);
  });

  it("sends a malformed credential for auth.malformed", () => {
    expect(built(pick(scenarios, "GET /orders", "auth.malformed").content).request.headers.authorization).toBe(`Bearer ${MALFORMED_CREDENTIAL_VALUE}`);
  });

  it("sends the known-expired credential of the identity that holds one for auth.expired", () => {
    const result = built(pick(scenarios, "GET /orders", "auth.expired").content);
    expect(result.request.headers.authorization).toBe("Bearer sl-fixture-alice-expired-token");
    expect(result.identity).toBe("alice");
    expect(result.secrets).toEqual(["sl-fixture-alice-expired-token"]);
  });

  it("uses the operation's own scheme where it overrides the root one: an API key in a header", () => {
    const scenario = scenarios.find((entry) => entry.content.operationKey === "GET /admin/reports" && entry.content.mutations.some((m) => m.kind === "auth.expired" || m.kind === "auth.omit"));
    const content = makeContent({ ...(scenario as GeneratedFixture).content, mutations: [], requiredIdentities: [{ role: "any", label: "any" }] });
    const result = built(content);
    expect(result.request.headers["x-api-key"]).toBe(ALICE_KEY);
    expect(result.request.headers).not.toHaveProperty("authorization");
    expect(result.scheme).toBe("apiKeyAuth");
  });

  it.each([
    ["an API key in a query parameter", { type: "apiKey", in: "query", name: "api_key" }, (url: string) => expect(url).toBe(`${BASE}/orders?api_key=${ALICE_TOKEN}`)],
    ["an API key in a cookie", { type: "apiKey", in: "cookie", name: "sid" }, (_url: string, headers: Record<string, string>) => expect(headers.cookie).toBe(`sid=${ALICE_TOKEN}`)],
    ["HTTP basic, encoded", { type: "http", scheme: "basic" }, (_url: string, headers: Record<string, string>) => expect(headers.authorization).toBe(`Basic ${Buffer.from(ALICE_TOKEN).toString("base64")}`)],
    ["OAuth 2 as a bearer token", { type: "oauth2" }, (_url: string, headers: Record<string, string>) => expect(headers.authorization).toBe(`Bearer ${ALICE_TOKEN}`)],
  ] as const)("expresses the root scheme as %s", (_name, definition, check) => {
    const changed: ApiModel = { ...model, securitySchemes: { ...model.securitySchemes, bearerAuth: definition } };
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [], requiredIdentities: [{ role: "any", label: "any" }] });
    const result = built(content, { apiModel: changed });
    check(result.request.url, result.request.headers as Record<string, string>);
    expect(result.secrets).toContain(ALICE_TOKEN);
  });

  it("encodes both the user and the password of a basic credential as secrets, so each form can be masked", () => {
    const changed: ApiModel = { ...model, securitySchemes: { ...model.securitySchemes, bearerAuth: { type: "http", scheme: "basic" } } };
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [], requiredIdentities: [{ role: "any", label: "any" }] });
    const result = built(content, { apiModel: changed });
    expect(result.secrets).toEqual([ALICE_TOKEN, Buffer.from(ALICE_TOKEN).toString("base64")]);
  });

  it("sends nothing when the operation needs no credentials, even if an identity could supply one", () => {
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, operationKey: "GET /public/status", operationPath: "/public/status", operationMethod: "GET", mutations: [], baseRequest: { pathParameters: {}, queryParameters: {}, headers: {} } });
    const result = built(content);
    expect(result.request.headers).not.toHaveProperty("authorization");
    expect(result.scheme).toBeUndefined();
    expect(result.secrets).toEqual([]);
  });

  it("fails with identity_unavailable, naming the role and scheme, when no identity holds the credential", () => {
    const content = pick(scenarios, "GET /orders", "auth.expired").content;
    const profile = fullProfile({ identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] }] });
    const result = failure(content, { profile });
    expect(result).toMatchObject({ code: "identity_unavailable" });
    expect(result.message).toMatch(/known-expired.*"bearerAuth"/);
    expect(failure(content, { credential: () => undefined })).toMatchObject({ code: "identity_unavailable" });
  });

  it("skips an identity whose credential is declared but not set, and uses the next that has one", () => {
    const profile = fullProfile({
      identities: [
        { name: "carol", role: "owner", credentialSchemes: ["bearerAuth"] },
        { name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] },
      ],
    });
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [], requiredIdentities: [{ role: "owner", label: "owner" }] });
    expect(built(content, { profile }).identity).toBe("alice");
  });
});

describe("object-level and function-level scenarios", () => {
  it("substitutes the owner's resource id and sends as the other identity (BOLA)", () => {
    const scenario = pick(scenarios, "GET /orders/{orderId}", "path-id.substitute");
    const result = built(scenario.content);
    expect(result.request.url).toBe(`${BASE}/orders/ord-1001`);
    expect(result.request.headers.authorization).toBe(`Bearer ${BOB_TOKEN}`);
    expect(result.identity).toBe("bob");
    expect(result.secrets).toEqual([BOB_TOKEN]);
  });

  it("fails with test_data_missing when no test data gives the owner's resource", () => {
    const scenario = pick(scenarios, "GET /orders/{orderId}", "path-id.substitute");
    expect(failure(scenario.content, { profile: fullProfile({ testData: [] }) })).toMatchObject({ code: "test_data_missing" });
    expect(failure(scenario.content, { profile: fullProfile({ testData: [{ ownerIdentity: "bob", parameter: "orderId", value: "x" }] }) })).toMatchObject({ code: "test_data_missing" });
  });

  it("honours test data scoped to one operation and ignores data scoped to another", () => {
    const scenario = pick(scenarios, "GET /orders/{orderId}", "path-id.substitute");
    const scoped = (operationKey: string) => fullProfile({ testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "ord-9", operationKey }] });
    expect(built(scenario.content, { profile: scoped("GET /orders/{orderId}") }).request.url).toBe(`${BASE}/orders/ord-9`);
    expect(failure(scenario.content, { profile: scoped("DELETE /orders/{orderId}") })).toMatchObject({ code: "test_data_missing" });
  });

  it("sends as the swapped-to identity for a role swap, never the privileged one", () => {
    const content = makeContent({
      ...pick(scenarios, "GET /orders", "auth.omit").content,
      mutations: [{ kind: "identity.swap", from: "owner", to: "other-user" }],
      requiredIdentities: [{ role: "owner", label: "owner" }, { role: "other-user", label: "other" }],
    });
    const result = built(content);
    expect(result.identity).toBe("bob");
    expect(result.request.headers.authorization).toBe(`Bearer ${BOB_TOKEN}`);
    expect(result.secrets).not.toContain(ALICE_TOKEN);
  });
});

describe("input mutations", () => {
  const parse = (body: string | undefined) => JSON.parse(body as string) as Record<string, unknown>;

  it("adds a read-only property to the body with a fixed value for its kind", () => {
    const scenario = scenarios.find((entry) => entry.content.operationKey === "POST /orders" && entry.content.mutations.some((m) => m.kind === "body.add-property"));
    const body = parse(built((scenario as GeneratedFixture).content).request.body);
    expect(body.id).toBe("sl-protected-example");
  });

  it("violates a numeric minimum with a value below it, and omits a required field", () => {
    const below = scenarios.find((entry) => entry.content.operationKey === "POST /orders" && entry.content.mutations.some((m) => m.kind === "field.violate-constraint" && m.constraint === "minimum"));
    expect(Number(parse(built((below as GeneratedFixture).content).request.body).total)).toBeLessThan(0);
    const omitted = scenarios.find((entry) => entry.content.operationKey === "POST /orders" && entry.content.mutations.some((m) => m.kind === "field.violate-constraint" && m.constraint === "required"));
    expect(parse(built((omitted as GeneratedFixture).content).request.body)).not.toHaveProperty("status");
  });

  it("violates an enum with a value outside it", () => {
    const scenario = scenarios.find((entry) => entry.content.operationKey === "POST /orders" && entry.content.mutations.some((m) => m.kind === "field.violate-constraint" && m.constraint === "enum"));
    expect(["open", "shipped", "cancelled"]).not.toContain(parse(built((scenario as GeneratedFixture).content).request.body).status);
  });

  it("fails with target_not_found when the specification declares no such constraint or input", () => {
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [{ kind: "field.violate-constraint", path: "query:nothing", constraint: "minimum" }] });
    expect(failure(content)).toMatchObject({ code: "target_not_found" });
    const probe = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [{ kind: "input.injection-probe", path: "query:nothing", probeId: "sql-quote" }] });
    expect(failure(probe)).toMatchObject({ code: "target_not_found" });
  });

  it("sends a fixed injection probe from the closed set into a declared input", () => {
    const withQuery: ApiModel = structuredClone(model);
    const orders = withQuery.operations.find((operation) => operation.method.toUpperCase() === "GET" && operation.path === "/orders");
    orders?.parameters.push({ name: "q", location: "query", required: false, schema: { type: "string", properties: {}, required: [] } });
    const content = makeContent({
      ...pick(scenarios, "GET /orders", "auth.omit").content,
      mutations: [{ kind: "input.injection-probe", path: "query:q", probeId: "sql-quote" }],
      baseRequest: { pathParameters: {}, queryParameters: { q: "x" }, headers: {} },
    });
    expect(built(content, { apiModel: withQuery }).request.url).toBe(`${BASE}/orders?${new URLSearchParams({ q: INJECTION_PROBES["sql-quote"] }).toString()}`);
  });

  it("changes the method for a probe and sends no body with it", () => {
    const content = makeContent({
      ...pick(scenarios, "POST /orders", "field.violate-constraint").content,
      mutations: [{ kind: "method.probe", method: "TRACE" }],
    });
    const { request } = built(content);
    expect(request.method).toBe("TRACE");
    expect(request.body).toBeUndefined();
  });

  it("asks for the mutation's repeat count and no more", () => {
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [{ kind: "request.repeat", count: 7 }] });
    expect(built(content).repeat).toBe(7);
    expect(built(pick(scenarios, "GET /orders", "auth.omit").content).repeat).toBe(1);
  });

  it("refuses a mutation kind it has no builder for, instead of sending a half-built request", () => {
    const content = makeContent({ ...pick(scenarios, "GET /orders", "auth.omit").content, mutations: [{ kind: "teleport" } as never] });
    expect(failure(content)).toMatchObject({ code: "mutation_unsupported" });
  });
});

describe("credential placeholders in retained content", () => {
  it("never reach the wire: a header or query placeholder is dropped and a body placeholder becomes a plain stand-in", () => {
    const content = makeContent({
      ...pick(scenarios, "POST /orders", "field.violate-constraint").content,
      mutations: [],
      baseRequest: {
        pathParameters: {},
        queryParameters: { token: CREDENTIAL_PLACEHOLDER, limit: 5 },
        headers: { "x-session": CREDENTIAL_PLACEHOLDER, "x-ok": "1" },
        body: { status: "open", password: CREDENTIAL_PLACEHOLDER },
      },
      requiredIdentities: [{ role: "any", label: "any" }],
    });
    const { request } = built(content);
    expect(request.url).toBe(`${BASE}/orders?limit=5`);
    expect(request.headers).not.toHaveProperty("x-session");
    expect(request.headers["x-ok"]).toBe("1");
    expect(JSON.parse(request.body as string)).toEqual({ status: "open", password: PLACEHOLDER_DUMMY_VALUE });
    expect(JSON.stringify(request)).not.toContain("[redacted");
  });
});

describe("body encoding", () => {
  it("sends JSON with its content type, and nothing for a request with no body", () => {
    const withBody = built(pick(scenarios, "POST /orders", "field.violate-constraint").content).request;
    expect(withBody.headers["content-type"]).toBe("application/json");
    expect(withBody.body).toBeDefined();
    expect(built(pick(scenarios, "GET /orders", "auth.omit").content).request.body).toBeUndefined();
  });

  it("does not modify the scenario it was given", () => {
    const content = pick(scenarios, "POST /orders", "field.violate-constraint").content;
    const before = JSON.stringify(content);
    built(content);
    expect(JSON.stringify(content)).toBe(before);
  });

  it("is deterministic: the same input gives the same request", () => {
    const content = pick(scenarios, "GET /orders/{orderId}", "path-id.substitute").content;
    expect(build(content)).toEqual(build(content));
  });
});

describe("fixtures", () => {
  it("give each identity its own credentials, so a swap is observable", () => {
    const profile: SecurityProfile = fullProfile();
    expect(profile.identities.map((identity) => identity.name)).toEqual(["alice", "bob"]);
    expect(fixtureCredential("alice", "bearerAuth", "active")).not.toBe(fixtureCredential("bob", "bearerAuth", "active"));
  });
});
