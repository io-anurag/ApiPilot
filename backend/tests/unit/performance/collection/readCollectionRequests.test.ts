import { describe, expect, it } from "vitest";
import { parseStoredCollection } from "../../../../src/externalCollections/uploadedCollectionParsing";
import { readCollectionRequests, type ReadRequest } from "../../../../src/performance/collection/readCollectionRequests";
import { bearerAuth, collectionOf, folderItem, jsonBody, prerequestScript, requestItem, testScript } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 research R3, R4, R11 (tasks T021). */

const NONE = { supportedDynamicVariables: new Set<string>() };

function read(collection: Record<string, unknown>, ids: string[], options = NONE): ReadRequest[] {
  return readCollectionRequests(parseStoredCollection(JSON.stringify(collection)), ids, options);
}

function source(result: ReadRequest) {
  if (result.kind !== "request") throw new Error(`left out: ${JSON.stringify(result.leftOut)}`);
  return result.source;
}

describe("readCollectionRequests", () => {
  it("reads identity, method, URL, enabled headers and path variables, with variables unresolved", () => {
    const collection = collectionOf([
      folderItem("f-outer", "Outer", [
        folderItem("f-inner", "Inner", [
          requestItem("r1", "Get one", {
            method: "get",
            url: {
              raw: "{{baseUrl}}/items/:id?a=1&b={{ b }}",
              host: ["{{baseUrl}}"],
              path: ["items", ":id"],
              query: [
                { key: "a", value: "1" },
                { key: "b", value: "{{ b }}" },
                { key: "c", value: "off", disabled: true },
              ],
              variable: [{ key: "id", value: "{{item_id}}" }],
            },
            header: [
              { key: "X-On", value: "{{ on }}" },
              { key: "X-Off", value: "x", disabled: true },
            ],
          }),
        ]),
      ]),
    ]);
    const request = source(read(collection, ["r1"])[0]);
    expect(request.ref).toEqual({ itemId: "r1", name: "Get one", folderPath: ["Outer", "Inner"] });
    expect(request.folderIds).toEqual(["f-outer", "f-inner"]);
    expect(request.method).toBe("GET");
    expect(request.url).toBe("{{baseUrl}}/items/{{item_id}}?a=1&b={{b}}");
    expect(request.headers).toEqual([{ key: "X-On", value: "{{on}}" }]);
  });

  it("gives a literal host without a scheme Postman's http", () => {
    const request = source(read(collectionOf([requestItem("r1", "Literal", { url: "api.example.com:8443/x" })]), ["r1"])[0]);
    expect(request.url).toBe("http://api.example.com:8443/x");
  });

  it("reads raw bodies as json by language or content type, urlencoded as form pairs, and no body as none", () => {
    const collection = collectionOf([
      requestItem("json-language", "A", { method: "POST", body: jsonBody('{"a":"{{x}}"}') }),
      requestItem("json-header", "B", { method: "POST", header: [{ key: "Content-Type", value: "application/vnd.api+json" }], body: { mode: "raw", raw: "{}" } }),
      requestItem("text", "C", { method: "POST", body: { mode: "raw", raw: "plain {{x}}" } }),
      requestItem("form", "D", { method: "POST", body: { mode: "urlencoded", urlencoded: [{ key: "a", value: "{{x}}" }, { key: "b", value: "2", disabled: true }] } }),
      requestItem("none", "E", { method: "POST", body: { mode: "none" } }),
      requestItem("empty", "F", { method: "POST", body: { mode: "raw", raw: "" } }),
    ]);
    const [jsonLanguage, jsonHeader, text, form, none, empty] = read(collection, ["json-language", "json-header", "text", "form", "none", "empty"]).map(source);
    expect(jsonLanguage.body).toEqual({ kind: "json", text: '{"a":"{{x}}"}', language: "json" });
    expect(jsonHeader.body).toMatchObject({ kind: "json", language: null });
    expect(text.body).toEqual({ kind: "text", text: "plain {{x}}", language: null });
    expect(form.body).toEqual({ kind: "form", pairs: [{ key: "a", value: "{{x}}" }] });
    expect(none.body).toBeNull();
    expect(empty.body).toBeNull();
  });

  it("inherits auth from the request, then the nearest folder, then the collection, with its owner", () => {
    const collection = collectionOf(
      [
        requestItem("own", "Own", { auth: { type: "basic", basic: [{ key: "username", value: "u" }, { key: "password", value: "{{pw}}" }] } }),
        folderItem("f1", "Folder", [requestItem("folder", "From folder")], { auth: { type: "apikey", apikey: [{ key: "key", value: "X-Key" }, { key: "value", value: "{{k}}" }, { key: "in", value: "query" }] } }),
        folderItem("f2", "No auth", [requestItem("noauth", "No auth")], { auth: { type: "noauth" } }),
        requestItem("collection", "From collection"),
      ],
      { auth: bearerAuth("{{access_token}}") },
    );
    const [own, folder, noauth, fromCollection] = read(collection, ["own", "folder", "noauth", "collection"]).map(source);
    expect(own.auth).toEqual({ type: "basic", fields: { username: "u", password: "{{pw}}" }, owner: { kind: "request", itemId: "own" } });
    expect(folder.auth).toEqual({ type: "apikey", fields: { key: "X-Key", value: "{{k}}", in: "query" }, owner: { kind: "folder", folderId: "f1", folderName: "Folder" } });
    expect(noauth.auth).toEqual({ type: "none", fields: {}, owner: { kind: "folder", folderId: "f2", folderName: "No auth" } });
    expect(fromCollection.auth).toEqual({ type: "bearer", fields: { token: "{{access_token}}" }, owner: { kind: "collection" } });
    expect(source(read(collectionOf([requestItem("bare", "Bare")]), ["bare"])[0]).auth).toEqual({ type: "none", fields: {}, owner: null });
  });

  it("keeps scripts in Postman's order: collection, folders outward-in, then the request", () => {
    const collection = collectionOf(
      [folderItem("f1", "Outer", [folderItem("f2", "Inner", [requestItem("r1", "Req", { event: [testScript("// request test"), prerequestScript("// request pre")] })], { event: [testScript("// inner")] })], { event: [testScript("// outer")] })],
      { event: [prerequestScript("// collection pre")] },
    );
    expect(source(read(collection, ["r1"])[0]).scripts.map((script) => [script.event, script.ownerKey, script.text])).toEqual([
      ["prerequest", "collection", "// collection pre"],
      ["test", "folder:f1", "// outer"],
      ["test", "folder:f2", "// inner"],
      ["test", "request:r1", "// request test"],
      ["prerequest", "request:r1", "// request pre"],
    ]);
  });

  it.each([
    ["oauth2", { type: "oauth2", oauth2: [{ key: "accessToken", value: "t" }] }],
    ["digest", { type: "digest", digest: [] }],
    ["hawk", { type: "hawk", hawk: [] }],
    ["awsv4", { type: "awsv4", awsv4: [] }],
    ["ntlm", { type: "ntlm", ntlm: [] }],
    ["akamai", { type: "akamai", akamai: [] }],
    ["edgegrid", { type: "edgegrid", edgegrid: [] }],
    ["jwt", { type: "jwt", jwt: [] }],
  ])("leaves out a request with %s auth, naming the type", (type, auth) => {
    expect(read(collectionOf([requestItem("r1", "Req", { auth })]), ["r1"])[0]).toEqual({
      kind: "left-out",
      leftOut: { itemId: "r1", name: "Req", folderPath: [], method: "GET", path: "/req", reason: "unsupported-auth", detail: type },
    });
  });

  it.each([
    ["formdata", { mode: "formdata", formdata: [{ key: "a", value: "1" }] }],
    ["file", { mode: "file", file: { src: "x.bin" } }],
    ["graphql", { mode: "graphql", graphql: { query: "{ a }" } }],
  ])("leaves out a %s body", (mode, body) => {
    expect(read(collectionOf([requestItem("r1", "Req", { method: "POST", body })]), ["r1"])[0]).toMatchObject({ kind: "left-out", leftOut: { reason: "unsupported-body", detail: mode } });
  });

  it("leaves out a reserved name, and every dynamic variable the plan does not generate, naming it", () => {
    const collection = collectionOf([
      requestItem("reserved", "Reserved", { header: [{ key: "X", value: "{{apipilot_x}}" }] }),
      requestItem("known", "Known", { method: "POST", body: jsonBody('{"e":"{{$randomEmail}}"}') }),
      requestItem("unknown", "Unknown", { url: "{{baseUrl}}/{{$notAVariable}}" }),
    ]);
    expect(read(collection, ["reserved", "known", "unknown"]).map((result) => (result.kind === "left-out" ? [result.leftOut.reason, result.leftOut.detail] : null))).toEqual([
      ["reserved-name", "apipilot_x"],
      ["unsupported-dynamic-variable", "$randomEmail"],
      ["unknown-dynamic-variable", "$notAVariable"],
    ]);
    expect(read(collection, ["known"], { supportedDynamicVariables: new Set(["$randomEmail"]) })[0].kind).toBe("request");
  });
});
