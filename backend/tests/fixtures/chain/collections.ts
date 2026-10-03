import { bearerAuth, collectionOf, folderItem, jsonBody, prerequestScript, requestItem, testScript } from "../collections/collectionBuilders";

/**
 * AP-037 (specs/037-request-chain-performance tasks T066; US4 independent test): two folders, an
 * extracting test script, a status assertion, a pre-request script and bearer auth set on a folder.
 */
export const TWO_FOLDER_REQUEST_IDS = ["req-token", "req-create", "req-get"] as const;

export function twoFolderCollection(): Record<string, unknown> {
  return collectionOf(
    [
      folderItem("folder-auth", "Auth", [
        requestItem("req-token", "Get token", {
          method: "POST",
          url: "{{baseUrl}}/auth/token",
          body: { mode: "urlencoded", urlencoded: [{ key: "client_id", value: "{{client_id}}" }] },
          event: [testScript('pm.environment.set("token", pm.response.json().access_token);')],
        }),
      ]),
      folderItem(
        "folder-customers",
        "Customers",
        [
          requestItem("req-create", "Create customer", {
            method: "POST",
            url: "{{baseUrl}}/api/v1/customers",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: jsonBody('{"name":"{{$randomFullName}}"}'),
            event: [
              prerequestScript('pm.variables.set("x", 1);'),
              testScript('pm.test("created", function () { pm.response.to.have.status(201); });', 'pm.environment.set("customer_id", pm.response.json().id);', "if (pm.response.code === 201) { postman.setNextRequest(null); }"),
            ],
          }),
          requestItem("req-get", "Get customer", { url: "{{baseUrl}}/api/v1/customers/{{customer_id}}" }),
        ],
        { auth: bearerAuth("{{token}}") },
      ),
    ],
    { name: "Two folders" },
  );
}
