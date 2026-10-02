import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleCollectionPlan, defaultCollectionChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import { collectionScriptInputs } from "../../../../src/performance/collection/collectionEngine";
import { rewriteDynamicValues, SUPPORTED_DYNAMIC_VARIABLES, type DynamicCounter } from "../../../../src/performance/collection/dynamicValues";
import { renderScriptFrom } from "../../../../src/performance/k6/renderScript";
import { checkUserScript } from "../../../../src/performance/userScript/checkUserScript";
import { APIFOUNDRY_REQUEST_IDS, apifoundryCollection, bearerAuth, collectionOf, jsonBody, requestItem, testScript } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 research R4, R9, FR-013 (tasks T050). */

const GOLDEN = path.join(__dirname, "..", "..", "..", "fixtures", "performance", "golden");
const SUPPORTED = { supportedDynamicVariables: SUPPORTED_DYNAMIC_VARIABLES };

function assemble(collection: Record<string, unknown>, ids: readonly string[]) {
  return assembleCollectionPlan({ id: "c-apifoundry", name: "APIFoundry", tier: "local", json: JSON.stringify(collection) }, defaultCollectionChoices([...ids]), SUPPORTED);
}

describe("dynamic variables", () => {
  it("supports exactly FR-013's thirteen variables", () => {
    expect([...SUPPORTED_DYNAMIC_VARIABLES].sort()).toEqual(
      ["$guid", "$randomUUID", "$timestamp", "$isoTimestamp", "$randomInt", "$randomFirstName", "$randomLastName", "$randomFullName", "$randomUserName", "$randomEmail", "$randomPhoneNumber", "$randomAlphaNumeric", "$randomBoolean"].sort(),
    );
  });

  it("gives each occurrence its own token, in the order URL, headers, body, auth", () => {
    const counter: DynamicCounter = { tokens: [] };
    const rewritten = rewriteDynamicValues(
      {
        method: "POST",
        url: "{{baseUrl}}/x/{{$guid}}",
        headers: [{ key: "X-Id", value: "{{$randomUUID}}" }],
        body: '{"a":"{{$randomEmail}}","b":"{{$randomEmail}}"}',
        bodyKind: "json",
        auth: { kind: "bearer", token: "{{$randomAlphaNumeric}}" },
      },
      counter,
    );
    expect(counter.tokens).toEqual([
      { token: "apipilot_dyn_0", kind: "$guid" },
      { token: "apipilot_dyn_1", kind: "$randomUUID" },
      { token: "apipilot_dyn_2", kind: "$randomEmail" },
      { token: "apipilot_dyn_3", kind: "$randomEmail" },
      { token: "apipilot_dyn_4", kind: "$randomAlphaNumeric" },
    ]);
    expect(rewritten.url).toBe("{{baseUrl}}/x/{{apipilot_dyn_0}}");
    expect(rewritten.body).toBe('{"a":"{{apipilot_dyn_2}}","b":"{{apipilot_dyn_3}}"}');
    expect(rewritten.auth).toEqual({ kind: "bearer", token: "{{apipilot_dyn_4}}" });
  });

  it("numbers occurrences plan-wide, credential requests first, and never lists them as environment values", () => {
    const collection = collectionOf(
      [
        requestItem("create", "Create", { method: "POST", body: jsonBody('{"e":"{{$randomEmail}}","g":"{{$guid}}"}') }),
        requestItem("login", "Login", { method: "POST", auth: { type: "noauth" }, body: jsonBody('{"nonce":"{{$timestamp}}"}'), event: [testScript('pm.environment.set("token", pm.response.json().token);')] }),
        requestItem("me", "Me"),
      ],
      { auth: bearerAuth("{{token}}") },
    );
    const { plan, dynamic, requests } = assemble(collection, ["login", "create", "me"]);
    const [token] = plan.collection!.credentialRequests;
    expect(dynamic).toEqual([
      { token: "apipilot_dyn_0", kind: "$timestamp" },
      { token: "apipilot_dyn_1", kind: "$randomEmail" },
      { token: "apipilot_dyn_2", kind: "$guid" },
    ]);
    expect(requests.get(token.stepId)!.template.body).toBe('{"nonce":"{{apipilot_dyn_0}}"}');
    expect(plan.collection!.generatedValueCount).toBe(3);
    expect(plan.userSuppliedValues.map((value) => value.name)).toEqual(["baseUrl"]);
    expect(requests.get(plan.journeys[0].steps[0].id)!.references.get("apipilot_dyn_1")).toEqual({ kind: "generated-value", name: "apipilot_dyn_1", variable: "$randomEmail" });
  });

  it("leaves out a request using a known but unsupported variable, or an unknown one, naming it", () => {
    const { plan } = assemble(
      collectionOf([requestItem("color", "Color", { url: "{{baseUrl}}/c/{{$randomColor}}" }), requestItem("other", "Other", { url: "{{baseUrl}}/c/{{$notReal}}" }), requestItem("ok", "Ok")]),
      ["color", "other", "ok"],
    );
    expect(plan.collection!.leftOut.map((request) => [request.itemId, request.reason, request.detail])).toEqual([
      ["color", "unsupported-dynamic-variable", "$randomColor"],
      ["other", "unknown-dynamic-variable", "$notReal"],
    ]);
  });

  it("renders the full APIFoundry fixture to its reviewed golden, byte-identical across builds, accepted by AP-034's check", () => {
    const render = () => {
      const assembly = assemble(apifoundryCollection({ dynamicBody: true }), APIFOUNDRY_REQUEST_IDS);
      return renderScriptFrom(assembly.plan, collectionScriptInputs(assembly));
    };
    const first = render();
    expect(render()).toEqual(first);
    expect(first.script).toBe(readFileSync(path.join(GOLDEN, "collection-dynamic-script.js"), "utf-8"));
    expect(first.script).toContain('"apipilot_dyn_0": {\n    "kind": "$randomFullName"\n  }');
    expect(checkUserScript(Buffer.from(first.script)).accepted).toBe(true);
  });
});
