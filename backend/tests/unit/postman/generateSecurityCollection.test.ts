import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel, ExportResult } from "@apipilot/shared-domain";
import { generateSecurityCollection, type ApprovedSecurityVersion } from "../../../src/postman/generateSecurityCollection";
import { validateCollection } from "../../../src/postman/validateCollection";
import { contentHashOf } from "../../../src/securityLab/scenarios/scenarioIdentity";
import {
  ALICE_EXPIRED_TOKEN,
  ALICE_KEY,
  ALICE_TOKEN,
  BOB_KEY,
  BOB_TOKEN,
} from "../../fixtures/securityLab/fixtureCredentials";
import { fullProfile, generatedScenarios, pick, sampleModel, type GeneratedFixture } from "../../fixtures/securityLab/runFixtures";
import { ALL_SECRETS, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

let model: ApiModel;
let scenarios: GeneratedFixture[];

beforeEach(async () => {
  model = await sampleModel();
  scenarios = generatedScenarios(model, fullProfile());
});

const approve = (scenario: GeneratedFixture, version = 1): ApprovedSecurityVersion => {
  const contentHash = contentHashOf(scenario.content);
  return { scenarioId: scenario.id, version, contentHash, approvedContentHash: contentHash, content: scenario.content };
};

function exported(approved: ApprovedSecurityVersion[], options: Parameters<typeof generateSecurityCollection>[2] = { specificationRevision: "rev-abc" }): ExportResult {
  const outcome = generateSecurityCollection(model, approved, options);
  if (!outcome.ok) throw new Error(`Export refused: ${outcome.failure.code}: ${outcome.failure.message} ${(outcome.failure.problems ?? []).join("; ")}`);
  return outcome.result;
}

const requests = (result: ExportResult) => result.collection.item.flatMap((folder) => folder.item);

describe("which versions are exported", () => {
  it("refuses an empty approved set", () => {
    const outcome = generateSecurityCollection(model, [], {});
    expect(outcome).toMatchObject({ ok: false, failure: { code: "empty_approved_set" } });
  });

  it("refuses a version whose approval no longer matches its content, naming it", () => {
    const scenario = pick(scenarios, "GET /orders", "auth.omit");
    const stale = { ...approve(scenario), approvedContentHash: "f".repeat(64) };
    const outcome = generateSecurityCollection(model, [stale], {});
    expect(outcome).toMatchObject({ ok: false, failure: { code: "unapproved_version" } });
    expect((outcome as { failure: { message: string } }).failure.message).toContain(scenario.id);
  });

  it("refuses content that no longer matches its stored hash, as an edit that kept an old approval would", () => {
    const scenario = pick(scenarios, "GET /orders", "auth.omit");
    const edited = { ...approve(scenario), content: { ...scenario.content, mutations: [{ kind: "auth.malformed" as const }] } };
    expect(generateSecurityCollection(model, [edited], {})).toMatchObject({ ok: false, failure: { code: "unapproved_version" } });
  });

  it("refuses an operation the specification no longer has", () => {
    const scenario = pick(scenarios, "GET /orders", "auth.omit");
    const gone = approve({ ...scenario, content: { ...scenario.content, operationKey: "GET /gone", operationPath: "/gone" } });
    expect(generateSecurityCollection(model, [gone], {})).toMatchObject({ ok: false, failure: { code: "unknown_operation" } });
  });

  it("refuses the whole export if any one version is not approved, rather than leaving it out quietly", () => {
    const good = approve(pick(scenarios, "GET /orders", "auth.omit"));
    const bad = { ...approve(pick(scenarios, "GET /orders", "auth.malformed")), approvedContentHash: "0".repeat(64) };
    expect(generateSecurityCollection(model, [good, bad], {}).ok).toBe(false);
  });
});

describe("the collection", () => {
  const set = () => [
    approve(pick(scenarios, "GET /orders", "auth.omit")),
    approve(pick(scenarios, "GET /orders", "auth.invalid-token")),
    approve(pick(scenarios, "GET /orders", "auth.malformed")),
    approve(pick(scenarios, "GET /orders", "auth.expired")),
    approve(pick(scenarios, "GET /orders/{orderId}", "path-id.substitute")),
  ];

  it("passes the existing validator, in the existing result shape", () => {
    const result = exported(set());
    expect(result.validation.valid).toBe(true);
    expect(validateCollection(result.collection, result.environment.values.map((value) => ({ name: value.key, purpose: "", secret: value.type === "secret", value: value.value }))).valid).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["collection", "credentialProducers", "environment", "limitations", "readme", "summary", "validation"]);
    expect(result.summary).toMatchObject({ requestCount: 5, standaloneRequestCount: 5, workflowCount: 0 });
  });

  it("has a folder per category, and a request per exported scenario named by category and title", () => {
    const result = exported(set());
    expect(result.collection.item.map((folder) => folder.name)).toEqual(["Authentication", "Broken object level authorization"]);
    const names = requests(result).map((request) => request.name);
    expect(names.every((name) => /^\[(Authentication|Broken object level authorization)\] /.test(name))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("describes each request with its scenario id, version, taxonomy, expected behavior and the specification revision", () => {
    const scenario = pick(scenarios, "GET /orders", "auth.omit");
    const description = requests(exported([approve(scenario, 3)]))[0].request.description as string;
    expect(description).toContain(`Security Lab scenario ${scenario.id}, version 3.`);
    expect(description).toContain("owasp-api-top10-2023");
    expect(description).toContain("API2 (primary)");
    expect(description).toContain(`Expected: ${scenario.content.expected.statement}`);
    expect(description).toContain("specification revision rev-abc");
  });

  it("traces each item to its scenario, with a deterministic id that also carries the version", () => {
    const scenario = pick(scenarios, "GET /orders", "auth.omit");
    const [v1] = requests(exported([approve(scenario, 1)]));
    const [v2] = requests(exported([approve(scenario, 2)]));
    expect(v1.provenance).toEqual({ scenarioId: scenario.id });
    expect(v1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(v1.id).not.toBe(v2.id);
    expect(requests(exported([approve(scenario, 1)]))[0].id).toBe(v1.id);
  });

  it("carries the scenario's assertions and no others", () => {
    const [omit] = requests(exported([approve(pick(scenarios, "GET /orders", "auth.omit"))]));
    expect(omit.event).toHaveLength(1);
    expect(omit.event?.[0].script.exec.join("\n")).toMatch(/Status code is one of 401|not a success/);
  });
});

describe("what each mutation does to the item", () => {
  const item = (operationKey: string, kind: string) => requests(exported([approve(pick(scenarios, operationKey, kind))]))[0];

  it("sends no credential for auth.omit", () => {
    const request = item("GET /orders", "auth.omit").request;
    expect(request.auth).toBeUndefined();
    expect(JSON.stringify(request)).not.toMatch(/\{\{(token|apiKey)\}\}/);
  });

  it("points at the fixed non-secret examples for an invalid or a malformed token", () => {
    expect(JSON.stringify(item("GET /orders", "auth.invalid-token").request.auth)).toContain("{{invalid_credential}}");
    expect(JSON.stringify(item("GET /orders", "auth.malformed").request.auth)).toContain("{{malformed_credential}}");
  });

  it("points at the expired-credential variable for auth.expired", () => {
    expect(JSON.stringify(item("GET /orders", "auth.expired").request.auth)).toContain("{{any_token_expired}}");
  });

  it("uses the owner's resource variable and the other identity's credential variable for a cross-identity request", () => {
    const request = item("GET /orders/{orderId}", "path-id.substitute").request;
    expect(request.url.variable).toEqual([{ key: "orderId", value: "{{owner_orderId}}" }]);
    expect(JSON.stringify(request.auth)).toContain("{{other_user_token}}");
  });

  it("adds the protected property to the example body", () => {
    const scenario = scenarios.find((entry) => entry.content.operationKey === "POST /orders" && entry.content.mutations.some((m) => m.kind === "body.add-property")) as GeneratedFixture;
    // Its own condition is a persisted-state check, which an export cannot express, so give it one that it can.
    const expressible = { ...scenario, content: { ...scenario.content, conditions: [{ kind: "status.not-success" as const }] } };
    const request = requests(exported([approve(expressible)]))[0].request;
    expect(request.body?.mode === "raw" && JSON.parse(request.body.raw)).toMatchObject({ id: "sl-protected-example" });
  });

  it("violates the constraint with the same value a run sends", () => {
    const scenario = scenarios.find((entry) => entry.content.operationKey === "POST /orders" && entry.content.mutations.some((m) => m.kind === "field.violate-constraint" && m.constraint === "minimum")) as GeneratedFixture;
    const request = requests(exported([approve(scenario)]))[0].request;
    expect(Number(request.body?.mode === "raw" && JSON.parse(request.body.raw).total)).toBeLessThan(0);
  });

  it("exports a method probe with that method and no body", () => {
    const probe = scenarios.find((entry) => entry.content.mutations.some((m) => m.kind === "method.probe"));
    if (!probe) return expect.fail("The sample specification generated no method probe");
    const request = requests(exported([approve(probe)]))[0].request;
    expect(["HEAD", "OPTIONS", "TRACE"]).toContain(request.method);
    expect(request.body).toBeUndefined();
  });
});

describe("what cannot be expressed is listed, never dropped silently or approximated", () => {
  it("lists a repeat scenario as security-repeat-not-expressible, with its id, and leaves it out of the collection", () => {
    const limited = structuredClone(model);
    const orders = limited.operations.find((operation) => operation.method.toUpperCase() === "GET" && operation.path === "/orders");
    orders?.responses.push({ ...orders.responses[0], statusCode: "429" });
    const repeat = generatedScenarios(limited, fullProfile({ testData: [{ ownerIdentity: "alice", parameter: "rate-limit-threshold", value: "30" }] })).find((entry) => entry.content.mutations.some((m) => m.kind === "request.repeat")) as GeneratedFixture;
    model = limited;
    const keep = approve(pick(scenarios, "GET /orders", "auth.omit"));
    const result = exported([keep, approve(repeat)]);
    expect(requests(result)).toHaveLength(1);
    expect(result.limitations).toEqual([expect.objectContaining({ kind: "security-repeat-not-expressible", scenarioId: repeat.id, location: "GET /orders" })]);
    expect(result.readme).toContain(repeat.id);
    expect(result.readme).toContain("Security scenarios that repeat a request");
  });

  it("lists a persisted-state scenario as security-persisted-state-not-expressible", () => {
    const persisted = scenarios.find((entry) => entry.content.conditions.some((c) => c.kind === "persisted.field-unchanged")) as GeneratedFixture;
    const result = exported([approve(pick(scenarios, "GET /orders", "auth.omit")), approve(persisted)]);
    expect(result.limitations.map((entry) => [entry.kind, entry.scenarioId])).toEqual([["security-persisted-state-not-expressible", persisted.id]]);
    expect(requests(result).map((request) => request.provenance?.scenarioId)).not.toContain(persisted.id);
  });

  it("lists a scenario whose only conditions have no template, and leaves it out because a request with no assertion proves nothing", () => {
    const leak = scenarios.find((entry) => entry.content.conditions.length > 0 && entry.content.conditions.every((c) => c.kind === "body.not-match-leak-pattern")) as GeneratedFixture | undefined;
    if (!leak) return expect.fail("No scenario with only leak-pattern conditions was generated");
    const result = exported([approve(pick(scenarios, "GET /orders", "auth.omit")), approve(leak)]);
    const entry = result.limitations.find((limitation) => limitation.scenarioId === leak.id);
    expect(entry).toMatchObject({ kind: "security-condition-not-expressible" });
    expect(entry?.message).toMatch(/not exported/);
    expect(requests(result).map((request) => request.provenance?.scenarioId)).not.toContain(leak.id);
  });

  it("exports a scenario that has some expressible conditions, and says which kind was not expressed", () => {
    const base = pick(scenarios, "GET /orders", "auth.omit");
    const mixed = { ...base, content: { ...base.content, conditions: [{ kind: "status.not-success" as const }, { kind: "body.not-match-leak-pattern" as const, patternId: "stack-trace" as const }] } };
    const result = exported([approve(mixed)]);
    expect(requests(result)).toHaveLength(1);
    expect(result.limitations[0]).toMatchObject({ kind: "security-condition-not-expressible", scenarioId: mixed.id });
    expect(result.limitations[0].message).toContain("body.not-match-leak-pattern");
    expect(result.limitations[0].message).toMatch(/other assertions only/);
  });
});

describe("determinism (SC-004)", () => {
  const all = () => [
    approve(pick(scenarios, "GET /orders", "auth.omit")),
    approve(pick(scenarios, "GET /orders", "auth.expired")),
    approve(pick(scenarios, "GET /orders/{orderId}", "path-id.substitute")),
    approve(pick(scenarios, "DELETE /orders/{orderId}", "path-id.substitute")),
  ];

  it("gives an equivalent collection, environment and README for the same set, whatever order it arrives in", () => {
    const first = exported(all());
    const second = exported([...all()].reverse());
    expect(JSON.stringify(second.collection)).toBe(JSON.stringify(first.collection));
    expect(JSON.stringify(second.environment)).toBe(JSON.stringify(first.environment));
    expect(second.readme).toBe(first.readme);
    expect(second.limitations).toEqual(first.limitations);
  });

  it("does not modify the approved versions it is given", () => {
    const versions = all();
    const before = JSON.stringify(versions);
    exported(versions);
    expect(JSON.stringify(versions)).toBe(before);
  });
});

describe("secrets (SC-009)", () => {
  const set = () => [
    approve(pick(scenarios, "GET /orders", "auth.omit")),
    approve(pick(scenarios, "GET /orders", "auth.expired")),
    approve(pick(scenarios, "GET /orders/{orderId}", "path-id.substitute")),
    approve(pick(scenarios, "GET /admin/reports", "auth.omit")),
  ];

  it("declares every credential as a secret variable with no value, and lists them in the README for the person to supply", () => {
    const result = exported(set());
    const secrets = result.environment.values.filter((value) => value.type === "secret");
    expect(secrets.length).toBeGreaterThan(3);
    for (const secret of secrets) expect(secret.value).toBe("");
    expect(result.environment.values.find((value) => value.key === "baseUrl")?.value).toBe("");
    const names = secrets.map((secret) => secret.key);
    expect(names).toEqual(expect.arrayContaining(["other_user_token", "any_token_expired", "token"]));
    for (const name of names) expect(result.readme).toContain(name);
  });

  it("holds only the two fixed example values as non-secret credential-like values", () => {
    const result = exported([approve(pick(scenarios, "GET /orders", "auth.invalid-token")), approve(pick(scenarios, "GET /orders", "auth.malformed"))]);
    const filled = result.environment.values.filter((value) => value.value !== "").map((value) => [value.key, value.value]);
    expect(filled).toEqual([["invalid_credential", "sl-invalid-credential"], ["malformed_credential", "%%malformed%%"]]);
  });

  it("contains no credential anywhere in the collection, the environment or the README", () => {
    const text = JSON.stringify(exported(set()));
    assertNoSecrets("security export", text, [...ALL_SECRETS, ALICE_TOKEN, BOB_TOKEN, ALICE_KEY, BOB_KEY, ALICE_EXPIRED_TOKEN]);
  });

  it("puts the base URL in the environment only when one is supplied", () => {
    const withUrl = exported([approve(pick(scenarios, "GET /orders", "auth.omit"))], { baseUrl: "https://staging.example.test" });
    expect(withUrl.environment.values.find((value) => value.key === "baseUrl")?.value).toBe("https://staging.example.test");
    expect(JSON.stringify(withUrl.collection)).not.toContain("staging.example.test");
  });
});

describe("naming", () => {
  it("is named after the specification, or a default, or the caller's choice", () => {
    const one = [approve(pick(scenarios, "GET /orders", "auth.omit"))];
    expect(exported(one).collection.info.name).toBe("Sample Orders API security tests");
    expect(exported(one, { collectionName: "Mine" }).collection.info.name).toBe("Mine");
    expect(exported(one).environment.name).toBe("Sample Orders API security tests environment");
  });
});
