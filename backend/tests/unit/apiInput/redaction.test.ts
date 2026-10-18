import { describe, expect, it } from "vitest";
import {
  CredentialCollector,
  classifyFieldName,
  classifyHeader,
  classifyValue,
  redactHeaderValue,
  redactJsonValue,
  redactNamedValue,
  redactUrl,
} from "../../../src/apiInput/redaction";

const SECRET = "SEEDED-SECRET-VALUE";

describe("redaction: headers", () => {
  it.each([
    ["Authorization", `Bearer ${SECRET}`, "token"],
    ["authorization", `Basic ${Buffer.from("user:pw").toString("base64")}`, "password"],
    ["Proxy-Authorization", SECRET, "token"],
    ["Cookie", `sid=${SECRET}; theme=dark`, "cookie"],
    ["Set-Cookie", `session=${SECRET}; HttpOnly`, "cookie"],
    ["X-API-Key", SECRET, "apiKey"],
    ["api-key", SECRET, "apiKey"],
    ["X-Auth-Token", SECRET, "token"],
    ["X-CSRF-Token", SECRET, "token"],
    ["X-XSRF-Token", SECRET, "token"],
    ["X-Amz-Security-Token", SECRET, "token"],
    ["X-Custom-Secret", SECRET, "token"],
  ])("replaces the value of %s and records only its kind", (name, value, kind) => {
    const collector = new CredentialCollector();
    const kept = redactHeaderValue(name, value, collector);
    expect(kept).toBe(`[redacted:${kind}]`);
    expect(JSON.stringify(collector.list())).not.toContain(SECRET);
    expect(collector.list()).toHaveLength(1);
    expect(collector.list()[0].kind).toBe(kind);
  });

  it("leaves ordinary headers alone and records nothing", () => {
    const collector = new CredentialCollector();
    expect(redactHeaderValue("Content-Type", "application/json", collector)).toBe("application/json");
    expect(redactHeaderValue("X-Request-Id", "abc-123", collector)).toBe("abc-123");
    expect(redactHeaderValue("Authorization", "", collector)).toBe("");
    expect(collector.list()).toEqual([]);
  });

  it("recognizes a credential by value shape under an innocent header name", () => {
    expect(classifyHeader("X-Forwarded-Note", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln")).toBe("token");
    expect(classifyHeader("X-Forwarded-Note", "AKIAABCDEFGHIJKLMNOP")).toBe("apiKey");
  });
});

describe("redaction: fields (query, form, cookie, JSON body)", () => {
  it.each([
    "password", "newPassword", "client_secret", "access_token", "refreshToken", "apiKey", "api_key", "x-api-key",
    "credential", "bearer", "key", "sig", "signature", "sid", "sessionId", "session", "auth", "authorization",
    "jsessionid", "code", "jwt", "KEY", "Signature",
  ])("treats the field name %s as a credential", (name) => {
    expect(classifyFieldName(name)).toBeDefined();
    const collector = new CredentialCollector();
    const kept = redactNamedValue("query", name, SECRET, collector);
    expect(kept).toMatch(/^\[redacted:(token|apiKey|password|session)\]$/);
    expect(JSON.stringify(collector.list())).not.toContain(SECRET);
  });

  it.each(["monkey", "author", "authority", "status", "email", "name", "id", "keyboard", "country", "description"])(
    "does not treat the ordinary field name %s as a credential",
    (name) => {
      expect(classifyFieldName(name)).toBeUndefined();
      expect(redactNamedValue("body", name, "plain value", new CredentialCollector())).toBe("plain value");
    },
  );

  it("maps session-like names to the session kind and key to apiKey", () => {
    expect(classifyFieldName("sid")).toBe("session");
    expect(classifyFieldName("key")).toBe("apiKey");
    expect(classifyFieldName("password")).toBe("password");
  });

  it("recognizes each value shape under an ordinary field name", () => {
    expect(classifyValue("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln")).toBe("token");
    expect(classifyValue("Bearer abc.def")).toBe("token");
    expect(classifyValue("Basic dXNlcjpwdw==")).toBe("password");
    expect(classifyValue("AKIAABCDEFGHIJKLMNOP")).toBe("apiKey");
    expect(classifyValue("AKIAshort")).toBeUndefined();
    expect(classifyValue("just text")).toBeUndefined();
  });

  it("keeps the structure of a JSON body and replaces only the credential values", () => {
    const collector = new CredentialCollector();
    const body = redactJsonValue(
      {
        user: { name: "ada", password: SECRET, profile: { token: SECRET, age: 36 } },
        items: [{ id: 1, note: "ok" }, { id: 2, secret: SECRET }],
        header: `Bearer ${SECRET}`,
        keep: true,
      },
      collector,
    );
    expect(body).toEqual({
      user: { name: "ada", password: "[redacted:password]", profile: { token: "[redacted:token]", age: 36 } },
      items: [{ id: 1, note: "ok" }, { id: 2, secret: "[redacted:token]" }],
      header: "[redacted:token]",
      keep: true,
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(collector.list())).not.toContain(SECRET);
  });

  it("replaces a whole nested object under a credential-named field", () => {
    const collector = new CredentialCollector();
    expect(redactJsonValue({ auth: { user: "u", pass: SECRET } }, collector)).toEqual({ auth: "[redacted:token]" });
  });

  it("leaves empty and null credential fields alone", () => {
    const collector = new CredentialCollector();
    expect(redactJsonValue({ password: "", token: null }, collector)).toEqual({ password: "", token: null });
    expect(collector.list()).toEqual([]);
  });

  it("is safe with a __proto__ key and does not pollute prototypes", () => {
    const body = redactJsonValue(JSON.parse('{"__proto__":{"polluted":"SEEDED-SECRET-VALUE"},"ok":1}'), new CredentialCollector());
    expect(body).toEqual({ ok: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("stops at a depth limit instead of recursing without bound", () => {
    let nested: unknown = SECRET;
    for (let i = 0; i < 200; i += 1) nested = { next: nested };
    expect(JSON.stringify(redactJsonValue(nested, new CredentialCollector()))).not.toContain(SECRET);
  });

  it("counts an entry once however many times it repeats the same credential", () => {
    const collector = new CredentialCollector();
    redactNamedValue("query", "api_key", SECRET, collector);
    redactNamedValue("query", "api_key", SECRET, collector);
    redactNamedValue("body", "api_key", SECRET, collector);
    expect(collector.list()).toEqual([
      { location: "body", name: "api_key", kind: "apiKey" },
      { location: "query", name: "api_key", kind: "apiKey" },
    ]);
  });
});

describe("redaction: URL userinfo", () => {
  it("removes user:password@ and reports that it did", () => {
    expect(redactUrl(`https://admin:${SECRET}@api.example.test:8443/v1/x?y=1`)).toEqual({
      url: "https://api.example.test:8443/v1/x?y=1",
      userinfoRemoved: true,
    });
    expect(redactUrl(`https://${SECRET}@host/path`).url).toBe("https://host/path");
  });

  it("leaves a URL without userinfo untouched, including an @ in the path or query", () => {
    expect(redactUrl("https://api.example.test/users/me@example.test?x=a@b")).toEqual({
      url: "https://api.example.test/users/me@example.test?x=a@b",
      userinfoRemoved: false,
    });
    expect(redactUrl("/relative/path")).toEqual({ url: "/relative/path", userinfoRemoved: false });
  });
});
