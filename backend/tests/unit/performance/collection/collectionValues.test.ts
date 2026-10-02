import { describe, expect, it } from "vitest";
import { ensureStableIds } from "../../../../src/externalCollections/itemIdentity";
import { parseUploadedCollection } from "../../../../src/externalCollections/uploadedCollectionParsing";
import { assembleCollectionPlan, defaultCollectionChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import {
  baseUrlVariableOf,
  credentialHeaderRule,
  literalAuthName,
  literalHeaderName,
  literalHost,
  renderFormBody,
  urlPathReferences,
  withBaseUrl,
} from "../../../../src/performance/collection/collectionValues";
import { sha256Hex } from "../../../../src/performance/plan/identifiers";
import { collectionOf, folderItem, requestItem } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 research R11, R12, FR-014 to FR-016 (tasks T026). */

const SEEDED_LITERAL = "SEEDED-LITERAL-7c1e";

function assemble(collection: Record<string, unknown>, ids: string[]) {
  const json = ensureStableIds(parseUploadedCollection(JSON.stringify(collection)));
  return assembleCollectionPlan({ id: "c", name: "C", tier: "local", json }, defaultCollectionChoices(ids), { supportedDynamicVariables: new Set() });
}

describe("the base URL and hosts", () => {
  it("takes the leading variable most URLs start with, ties going to the first in code-unit order", () => {
    expect(baseUrlVariableOf(["{{host}}/a", "{{base}}/b", "{{host}}/c", "https://x"])).toBe("host");
    expect(baseUrlVariableOf(["{{b}}/a", "{{a}}/b"])).toBe("a");
    expect(baseUrlVariableOf(["https://x/a"])).toBeNull();
    expect(withBaseUrl("{{host}}/a/{{host}}", "host")).toBe("{{baseUrl}}/a/{{host}}");
    expect(withBaseUrl("{{other}}/a", "host")).toBe("{{other}}/a");
    expect(literalHost("https://api.example.com:8443/a?b")).toBe("api.example.com:8443");
    expect(literalHost("{{baseUrl}}/a")).toBeNull();
  });

  it("leaves out a request starting with another variable, lists literal hosts sorted, and reserves baseUrl when the base has another name", () => {
    const { plan } = assemble(
      collectionOf([
        requestItem("one", "One", { url: "{{host}}/one" }),
        requestItem("two", "Two", { url: "{{host}}/two/{{baseUrl}}" }),
        requestItem("three", "Three", { url: "{{auth_host}}/token" }),
        requestItem("four", "Four", { url: "https://z.example.com/x" }),
        requestItem("five", "Five", { url: "http://a.example.com:8080/x" }),
        requestItem("six", "Six", { url: "{{host}}/six" }),
      ]),
      ["one", "two", "three", "four", "five", "six"],
    );
    expect(plan.collection!.baseUrlVariable).toBe("host");
    expect(plan.collection!.leftOut.map((request) => [request.itemId, request.reason, request.detail])).toEqual([
      ["two", "reserved-name", "baseUrl"],
      ["three", "other-host-variable", "auth_host"],
    ]);
    expect(plan.collection!.hosts).toEqual(["a.example.com:8080", "z.example.com"]);
    expect(plan.journeys[0].steps.map((step) => step.operationKey)).toEqual(["GET /one", "GET /x", "GET /x", "GET /six"]);
  });
});

describe("credential headers, secrets and literals", () => {
  it.each([
    ["Authorization", "Authorization"],
    ["proxy-authorization", "Proxy-Authorization"],
    ["Cookie", "Cookie"],
    ["X-API-Key", 'contains "key"'],
    ["X-Auth-Token", 'contains "token"'],
    ["X-Client-Secret", 'contains "secret"'],
    ["X-Password", 'contains "password"'],
    ["X-AUTH", 'contains "auth"'],
    ["X-Session-Id", 'contains "session"'],
  ])("treats %s as a credential header (%s)", (header, rule) => {
    expect(credentialHeaderRule(header)).toBe(rule);
  });

  it("does not treat an ordinary header as a credential header", () => {
    expect(credentialHeaderRule("Accept")).toBeNull();
    expect(credentialHeaderRule("X-Request-Id")).toBeNull();
  });

  it("names literals by owner and field, never by value", () => {
    expect(literalAuthName({ kind: "request", itemId: "r1" }, "token")).toBe(`apipilot_literal_request_${sha256Hex("r1").slice(0, 8)}_token`);
    expect(literalAuthName({ kind: "folder", folderId: "f1", folderName: "F" }, "password")).toBe(`apipilot_literal_folder_${sha256Hex("f1").slice(0, 8)}_password`);
    expect(literalAuthName({ kind: "collection" }, "value")).toBe("apipilot_literal_collection_value");
    expect(literalHeaderName("r1", "X-API-Key")).toBe(`apipilot_literal_request_${sha256Hex("r1").slice(0, 8)}_header_x_api_key`);
  });

  it("replaces literal auth fields and credential-header literals by secret environment values, marks credential references secret, and lists each header", () => {
    const { plan, requests, literals } = assemble(
      collectionOf(
        [
          folderItem("f1", "Folder", [
            requestItem("r1", "One", {
              header: [
                { key: "X-API-Key", value: SEEDED_LITERAL },
                { key: "X-Session", value: "{{session}}" },
                { key: "Accept", value: "application/json" },
              ],
            }),
          ], { auth: { type: "basic", basic: [{ key: "username", value: "{{user}}" }, { key: "password", value: SEEDED_LITERAL }] } }),
          requestItem("r2", "Two", { url: "{{baseUrl}}/two?q={{user}}" }),
        ],
        { auth: { type: "bearer", bearer: [{ key: "token", value: SEEDED_LITERAL }] } },
      ),
      ["r1", "r2"],
    );
    const password = `apipilot_literal_folder_${sha256Hex("f1").slice(0, 8)}_password`;
    const header = literalHeaderName("r1", "X-API-Key");
    const token = "apipilot_literal_collection_token";
    expect(plan.userSuppliedValues.map((value) => [value.name, value.source, value.secret])).toEqual(
      [
        [password, "collection-literal", true],
        [header, "collection-literal", true],
        [token, "collection-literal", true],
        ["baseUrl", "base-url", false],
        ["session", "collection-variable", true],
        ["user", "collection-variable", true],
      ].sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)),
    );
    expect([...literals.keys()].sort()).toEqual([header, password, token].sort());
    expect(JSON.stringify([...requests.values()].map((request) => request.template))).not.toContain(SEEDED_LITERAL);
    expect(JSON.stringify(plan)).not.toContain(SEEDED_LITERAL);
    expect(plan.collection!.findings.filter((finding) => finding.kind === "credential-header").map((finding) => finding.detail)).toEqual(['X-API-Key (contains "key")', 'X-Session (contains "session")']);
  });
});

describe("form bodies and URL encoding", () => {
  it("encodes a form body's literal text now and its references at run time, and adds the form content type", () => {
    expect(renderFormBody([{ key: "a b", value: "x&y={{v}}!" }, { key: "c", value: "{{w}}" }])).toBe("a%20b=x%26y%3D{{v}}!&c={{w}}");
    const { plan, requests } = assemble(collectionOf([requestItem("r1", "Form", { method: "POST", body: { mode: "urlencoded", urlencoded: [{ key: "grant", value: "x y" }] } })]), ["r1"]);
    const template = requests.get(plan.journeys[0].steps[0].id)!.template;
    expect(template.body).toBe("grant=x%20y");
    expect(template.bodyKind).toBe("form");
    expect(template.headers).toEqual([{ key: "Content-Type", value: "application/x-www-form-urlencoded" }]);
  });

  it("lists every name referenced in a URL after its host once, in one url-encoding note", () => {
    expect(urlPathReferences("{{baseUrl}}/a/{{id}}?q={{q}}")).toEqual(["id", "q"]);
    expect(urlPathReferences("https://{{tenant}}.example.com/a/{{id}}")).toEqual(["id"]);
    const { plan } = assemble(collectionOf([requestItem("r1", "One", { url: "{{baseUrl}}/a/{{path}}" }), requestItem("r2", "Two", { url: "{{baseUrl}}/b" })]), ["r1", "r2"]);
    expect(plan.collection!.findings.filter((finding) => finding.kind === "url-encoding").map((finding) => [finding.detail, finding.stepIds.length])).toEqual([["path", 1]]);
  });
});
