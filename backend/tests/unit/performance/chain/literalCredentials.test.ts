import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainStep } from "@apipilot/shared-domain";
import { CredentialMixedLiteralError, CredentialNeedsEnvironmentError } from "../../../../src/performance/errors";
import { moveLiteralCredentials } from "../../../../src/performance/chain/literalCredentials";
import { chain, chainPlan, step } from "../../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T016; FR-027, research R8, Clarification 2026-10-03). */

const ENVIRONMENT = { name: "Local stub", valueNames: ["baseUrl", "client_id"] };

function planWith(...steps: ChainStep[]): ChainPlan {
  return chainPlan({ chains: [chain("c1", "A", steps)] });
}

function seededStep(overrides: Partial<ChainStep> & Pick<ChainStep, "id">): ChainStep {
  return step({ source: { kind: "operation", operationKey: "POST /users", label: "POST /users", passwordFields: ["password", "account.secret"] }, ...overrides });
}

describe("moveLiteralCredentials: headers", () => {
  it.each([
    ["Authorization", "Bearer abc123", "Bearer {{authorization_s2}}", "abc123"],
    ["Authorization", "abc123", "{{authorization_s2}}", "abc123"],
    ["Proxy-Authorization", "Basic dXNlcjpwYXNz", "Basic {{proxy_authorization_s2}}", "dXNlcjpwYXNz"],
    ["Cookie", "session=xyz; theme=dark", "{{cookie_s2}}", "session=xyz; theme=dark"],
  ])("moves a literal %s value out of the plan", (header, value, kept, moved) => {
    const result = moveLiteralCredentials(planWith(step({ id: "s2", headers: [{ name: header, value }] })), ENVIRONMENT);
    expect(result.plan.chains[0].steps[0].headers).toEqual([{ name: header, value: kept }]);
    expect(result.moves).toEqual([{ stepId: "s2", location: { kind: "header", name: header }, valueName: kept.replace(/^.*\{\{|\}\}$/g, ""), value: moved }]);
    expect(result.plan.secretNames).toContain(result.moves[0].valueName);
    expect(JSON.stringify(result.plan)).not.toContain(moved);
  });

  it("leaves references, other headers and steps without credentials alone", () => {
    const plan = planWith(step({ id: "s1", headers: [{ name: "Authorization", value: "Bearer {{token}}" }, { name: "X-Api-Key", value: "literal-key" }, { name: "Cookie", value: "{{session}}" }] }));
    const result = moveLiteralCredentials(plan, ENVIRONMENT);
    expect(result.moves).toEqual([]);
    expect(result.plan).toBe(plan);
  });

  it("refuses a value that mixes a literal with a reference", () => {
    expect(() => moveLiteralCredentials(planWith(step({ id: "s1", headers: [{ name: "Authorization", value: "Bearer abc{{x}}" }] })), ENVIRONMENT)).toThrow(CredentialMixedLiteralError);
  });

  it("refuses a literal when the plan has no target environment, and moves nothing", () => {
    try {
      moveLiteralCredentials(planWith(step({ id: "s3", headers: [{ name: "Authorization", value: "Bearer abc" }] })), null);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialNeedsEnvironmentError);
      expect((error as CredentialNeedsEnvironmentError).stepId).toBe("s3");
      expect((error as CredentialNeedsEnvironmentError).location).toEqual({ kind: "header", name: "Authorization" });
    }
    expect(moveLiteralCredentials(planWith(step({ id: "s3", headers: [{ name: "Authorization", value: "Bearer {{t}}" }] })), null).moves).toEqual([]);
  });

  it("names values deterministically and never reuses a name the environment or plan already has", () => {
    const plan = planWith(
      step({ id: "s2", headers: [{ name: "Authorization", value: "Bearer a" }] }),
      step({ id: "s3", url: "{{baseUrl}}/{{authorization_s3}}", headers: [{ name: "Authorization", value: "Bearer b" }] }),
    );
    const result = moveLiteralCredentials(plan, { name: "Env", valueNames: ["authorization_s2"] });
    expect(result.moves.map((move) => move.valueName)).toEqual(["authorization_s2_2", "authorization_s3_2"]);
  });
});

describe("moveLiteralCredentials: password fields of a seeded step", () => {
  it("moves a literal at a declared password path, keeping references elsewhere", () => {
    const body = '{\n  "username": "{{username}}",\n  "password": "hunter2",\n  "account": { "secret": "s3cr3t", "id": {{account_id}} }\n}';
    const result = moveLiteralCredentials(planWith(seededStep({ id: "s4", method: "POST", body: { kind: "raw", contentType: "application/json", text: body } })), ENVIRONMENT);
    expect(result.moves.map((move) => [move.location, move.valueName, move.value])).toEqual([
      [{ kind: "body-field", path: "password" }, "password_s4", "hunter2"],
      [{ kind: "body-field", path: "account.secret" }, "account_secret_s4", "s3cr3t"],
    ]);
    const text = (result.plan.chains[0].steps[0].body as { text: string }).text;
    expect(JSON.parse(text.replace("{{account_id}}", "1"))).toEqual({ username: "{{username}}", password: "{{password_s4}}", account: { secret: "{{account_secret_s4}}", id: 1 } });
    expect(text).not.toContain("hunter2");
  });

  it("leaves a password field that is exactly one reference, a non-JSON body, and an added step alone", () => {
    const reference = seededStep({ id: "s4", body: { kind: "raw", contentType: "application/json", text: '{"password":"{{pw}}"}' } });
    const notJson = seededStep({ id: "s5", body: { kind: "raw", contentType: "text/plain", text: "password=hunter2" } });
    const added = step({ id: "s6", body: { kind: "raw", contentType: "application/json", text: '{"password":"hunter2"}' } });
    expect(moveLiteralCredentials(planWith(reference, notJson, added), ENVIRONMENT).moves).toEqual([]);
  });

  it("refuses a password field that mixes a literal and a reference, and a literal without an environment", () => {
    const mixed = seededStep({ id: "s4", body: { kind: "raw", contentType: "application/json", text: '{"password":"pre{{pw}}"}' } });
    expect(() => moveLiteralCredentials(planWith(mixed), ENVIRONMENT)).toThrow(CredentialMixedLiteralError);
    const literal = seededStep({ id: "s4", body: { kind: "raw", contentType: "application/json", text: '{"password":"hunter2"}' } });
    expect(() => moveLiteralCredentials(planWith(literal), null)).toThrow(CredentialNeedsEnvironmentError);
  });
});
