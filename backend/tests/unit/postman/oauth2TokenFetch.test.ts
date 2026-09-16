import { describe, expect, it } from "vitest";
import { planSchemeVariables } from "../../../src/postman/authMapping";
import { buildOAuth2SetupFolders, OAUTH2_SETUP_FOLDER_NAME } from "../../../src/postman/oauth2TokenFetch";
import { itemIdForOAuth2TokenFetch } from "../../../src/postman/identifiers";
import {
  oauth2AbsoluteTokenUrlScheme,
  oauth2ClientCredentialsScheme,
  oauth2NoScopesScheme,
  oauth2ProtectedOperation,
  partnerOauth2ProtectedOperation,
  twoOAuth2Schemes,
} from "../../fixtures/postman/credentialFixtures";

describe("buildOAuth2SetupFolders (specs/024-oauth2-client-credentials-auth)", () => {
  it("returns no folder when no required operation needs a classified oauth2 scheme", () => {
    const plan = planSchemeVariables(oauth2ClientCredentialsScheme);
    expect(buildOAuth2SetupFolders([], oauth2ClientCredentialsScheme, plan)).toEqual([]);
  });

  it("builds one folder with one POST request, basic auth referencing the credential variables, and a form-encoded scope body", () => {
    const plan = planSchemeVariables(oauth2ClientCredentialsScheme);
    const folders = buildOAuth2SetupFolders(
      [oauth2ProtectedOperation],
      oauth2ClientCredentialsScheme,
      plan,
    );

    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe(OAUTH2_SETUP_FOLDER_NAME);
    expect(folders[0].item).toHaveLength(1);

    const item = folders[0].item[0];
    expect(item.id).toBe(itemIdForOAuth2TokenFetch("oauth2Auth"));
    expect(item.provenance).toBeUndefined();
    expect(item.request.method).toBe("POST");
    expect(item.request.url.raw).toBe("{{baseUrl}}/oauth2/token");
    expect(item.request.url.host).toEqual(["{{baseUrl}}"]);
    expect(item.request.url.path).toEqual(["oauth2", "token"]);
    expect(item.request.auth).toEqual({
      type: "basic",
      basic: [
        { key: "username", value: "{{clientId}}", type: "string" },
        { key: "password", value: "{{clientSecret}}", type: "string" },
      ],
    });
    expect(item.request.header).toEqual([
      { key: "Content-Type", value: "application/x-www-form-urlencoded" },
    ]);
    expect(item.request.body).toEqual({
      mode: "raw",
      raw: "grant_type=client_credentials&scope=read+write",
      options: { raw: { language: "text" } },
    });
    expect(item.event).toHaveLength(1);
    expect(item.event?.[0].listen).toBe("test");
    expect(item.event?.[0].script.exec.join("\n")).toContain(
      'pm.environment.set("accessToken", body.access_token)',
    );
  });

  it("omits the scope parameter entirely when the scheme declares no scopes", () => {
    const plan = planSchemeVariables(oauth2NoScopesScheme);
    const folders = buildOAuth2SetupFolders([oauth2ProtectedOperation], oauth2NoScopesScheme, plan);
    expect(folders[0].item[0].request.body).toEqual({
      mode: "raw",
      raw: "grant_type=client_credentials",
      options: { raw: { language: "text" } },
    });
  });

  it("resolves an absolute tokenUrl verbatim, never rewriting it against baseUrl", () => {
    const plan = planSchemeVariables(oauth2AbsoluteTokenUrlScheme);
    const folders = buildOAuth2SetupFolders(
      [oauth2ProtectedOperation],
      oauth2AbsoluteTokenUrlScheme,
      plan,
    );
    const url = folders[0].item[0].request.url;
    expect(url.raw).toBe("https://auth.example.com/oauth2/token");
    expect(url.host).toEqual(["https://auth.example.com/oauth2/token"]);
  });

  it("builds one item per qualifying scheme, sorted by scheme key, in one shared folder", () => {
    const plan = planSchemeVariables(twoOAuth2Schemes);
    const folders = buildOAuth2SetupFolders(
      [oauth2ProtectedOperation, partnerOauth2ProtectedOperation],
      twoOAuth2Schemes,
      plan,
    );
    expect(folders).toHaveLength(1);
    expect(folders[0].item.map((item) => item.id)).toEqual([
      itemIdForOAuth2TokenFetch("oauth2Auth"),
      itemIdForOAuth2TokenFetch("partnerOauth2Auth"),
    ]);
    // "oauth2Auth" sorts before "partnerOauth2Auth" (compareCodeUnits), independent of which
    // operation happened to be listed first in `requiredOperations`.
    const reordered = buildOAuth2SetupFolders(
      [partnerOauth2ProtectedOperation, oauth2ProtectedOperation],
      twoOAuth2Schemes,
      plan,
    );
    expect(reordered[0].item.map((item) => item.id)).toEqual(
      folders[0].item.map((item) => item.id),
    );
  });

  it("omits a scheme with no qualifying required operation while still including another that does qualify", () => {
    const plan = planSchemeVariables(twoOAuth2Schemes);
    const folders = buildOAuth2SetupFolders([oauth2ProtectedOperation], twoOAuth2Schemes, plan);
    expect(folders[0].item).toHaveLength(1);
    expect(folders[0].item[0].id).toBe(itemIdForOAuth2TokenFetch("oauth2Auth"));
  });

  it("does not qualify a scheme required only as a non-primary (second) scheme of a requirement set", () => {
    const plan = planSchemeVariables(oauth2ClientCredentialsScheme);
    const secondaryRequirement = {
      ...oauth2ProtectedOperation,
      security: [{ schemes: [{ name: "someOtherScheme", scopes: [] }, { name: "oauth2Auth", scopes: [] }] }],
    };
    expect(buildOAuth2SetupFolders([secondaryRequirement], oauth2ClientCredentialsScheme, plan)).toEqual([]);
  });

  it("produces byte-identical output across repeated calls with the same input (determinism)", () => {
    const plan = planSchemeVariables(oauth2ClientCredentialsScheme);
    const first = buildOAuth2SetupFolders([oauth2ProtectedOperation], oauth2ClientCredentialsScheme, plan);
    const second = buildOAuth2SetupFolders([oauth2ProtectedOperation], oauth2ClientCredentialsScheme, plan);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
