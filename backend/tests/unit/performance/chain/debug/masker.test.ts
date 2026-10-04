import { describe, expect, it } from "vitest";
import type { MaskedText } from "@apipilot/shared-domain";
import { DISPLAY_LIMIT_CHARS, Masker } from "../../../../../src/performance/chain/debug/masker";

/** AP-039 (specs/039-chain-debug-run tasks T012; FR-013 to FR-016, SC-003). */

const SECRET = "s3cr3t-value-123";

function plain(text: MaskedText): string {
  return text.map((segment) => (segment.kind === "text" ? segment.text : "[M]")).join("");
}

/** The text with each masked segment replaced by its real value, as the reveal calls would return it. */
function restored(text: MaskedText, masker: Masker, secrets: Record<string, string> = {}): string {
  const held = masker.revealableValues();
  return text.map((segment) => (segment.kind === "text" ? segment.text : (held.get(segment.valueId) ?? secrets[segment.valueId] ?? "?"))).join("");
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("masker: headers", () => {
  it.each(["Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie", "X-Api-Key", "api-key"])("masks the whole value of %s, revealably", (name) => {
    const masker = new Masker([]);
    const header = masker.maskHeader(name, "abc.def.ghi");
    expect(header.name).toBe(name);
    expect(header.value).toHaveLength(1);
    expect(header.value[0]).toMatchObject({ kind: "masked", revealable: true });
    expect([...masker.revealableValues().values()]).toContain("abc.def.ghi");
  });

  it("keeps an ordinary header readable", () => {
    const masker = new Masker([]);
    expect(plain(masker.maskHeader("Content-Type", "application/json").value)).toBe("application/json");
  });

  it("masks a bearer token that sits in an ordinary header, and the token on its own elsewhere", () => {
    const masker = new Masker([]);
    masker.maskHeader("X-Forwarded", "Bearer tok-777");
    expect(plain(masker.maskText("echo tok-777 echo"))).toBe("echo [M] echo");
  });
});

describe("masker: secrets the engineer supplied", () => {
  it("masks a secret environment value in a URL, a header and a body, and never makes it revealable", () => {
    const masker = new Masker([{ name: "client_secret", value: SECRET, kind: "environment" }]);
    const url = masker.maskUrl(`http://h/x?code=${SECRET}`);
    const header = masker.maskHeader("X-Trace", `v=${SECRET}`);
    const body = masker.maskBody(bytes(`{"a":"${SECRET}"}`), "application/json", false);
    expect(plain(url)).not.toContain(SECRET);
    expect(plain(header.value)).not.toContain(SECRET);
    expect(body.kind === "text" && plain(body.text)).toBe('{"a":"[M]"}');
    for (const text of [url, header.value, body.kind === "text" ? body.text : []]) {
      for (const segment of text) if (segment.kind === "masked") expect(segment.revealable).toBe(false);
    }
    expect([...masker.revealableValues().values()]).not.toContain(SECRET);
    expect(JSON.stringify([url, header, body])).not.toContain(SECRET);
  });

  it("masks a secret data set column value", () => {
    const masker = new Masker([{ name: "password", value: "hunter2-pass", kind: "data-column" }]);
    expect(plain(masker.maskText("user=ada&password=hunter2-pass"))).toBe("user=ada&password=[M]");
    expect(masker.maskText("hunter2-pass")[0]).toMatchObject({ label: "secret data column password", revealable: false });
  });

  it("keeps a value that is secret anywhere unrevealable, even when the target also sent it", () => {
    const masker = new Masker([{ name: "client_secret", value: SECRET, kind: "environment" }]);
    masker.maskHeader("Authorization", SECRET);
    expect(masker.maskText(SECRET)[0]).toMatchObject({ kind: "masked", revealable: false });
  });

  it("masks a secret shorter than 3 characters where it stands alone, not inside free text", () => {
    const masker = new Masker([{ name: "pin", value: "42", kind: "environment" }]);
    expect(plain(masker.maskHeader("X-Pin", "42").value)).toBe("[M]");
    expect(plain(masker.maskUrl("http://h/x?pin=42&n=1"))).toBe("http://h/x?pin=[M]&n=1");
    expect(plain(masker.maskText("order 42 items"))).toBe("order 42 items");
  });

  it("masks a user-info password in a URL", () => {
    const masker = new Masker([]);
    expect(plain(masker.maskUrl("http://ada:p4ss-word@h/x"))).toBe("http://ada:[M]@h/x");
  });
});

describe("masker: values from the target", () => {
  it("masks values at credential-named JSON fields, keeps names and shape, and reproduces the original text", () => {
    const masker = new Masker([]);
    const original = '{ "access_token" : "abc-123-xyz",\n  "nested": { "refreshToken": "r-999", "n": 5 },\n  "user": "ada" }';
    const body = masker.maskBody(bytes(original), "application/json", false);
    if (body.kind !== "text") throw new Error("expected text");
    expect(plain(body.text)).toBe('{ "access_token" : "[M]",\n  "nested": { "refreshToken": "[M]", "n": 5 },\n  "user": "ada" }');
    expect(restored(body.text, masker)).toBe(original);
    expect(body.text.filter((segment) => segment.kind === "masked").every((segment) => segment.kind === "masked" && segment.revealable)).toBe(true);
  });

  it("masks credential-named query parameters and form fields", () => {
    const masker = new Masker([]);
    expect(plain(masker.maskUrl("http://h/x?api_key=k-1234&page=2"))).toBe("http://h/x?api_key=[M]&page=2");
    const form = masker.maskBody(bytes("client_secret=zzz-777&name=ada"), "application/x-www-form-urlencoded", false);
    expect(form.kind === "text" && plain(form.text)).toBe("client_secret=[M]&name=ada");
  });

  it("masks an extracted value whose name or shape says credential, and not an ordinary one", () => {
    const masker = new Masker([]);
    expect(masker.addExtracted("token", "abc-777")).toBe(true);
    expect(masker.addExtracted("customer_id", "c-1234")).toBe(false);
    expect(masker.addExtracted("thing", "Bearer qqq-555")).toBe(true);
    expect(plain(masker.maskText("abc-777 c-1234 qqq-555"))).toBe("[M] c-1234 [M]");
  });

  it("gives one value one id wherever it appears, longest value first", () => {
    const masker = new Masker([]);
    masker.addExtracted("token", "abc-777");
    masker.addExtracted("token2", "abc-777-extra");
    const text = masker.maskText("a abc-777-extra b abc-777 c abc-777");
    const ids = text.filter((segment) => segment.kind === "masked").map((segment) => (segment.kind === "masked" ? segment.valueId : ""));
    expect(plain(text)).toBe("a [M] b [M] c [M]");
    expect(ids[1]).toBe(ids[2]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("masks a value found in a later body in an earlier body too, when observed first", () => {
    const masker = new Masker([]);
    masker.observeBody(bytes('{"access_token":"late-token-1"}'), "application/json");
    expect(plain(masker.maskText("an earlier body mentioned late-token-1"))).toBe("an earlier body mentioned [M]");
  });
});

describe("masker: bodies", () => {
  it("shows no body, a binary description, or text", () => {
    const masker = new Masker([]);
    expect(masker.maskBody(null, null, false)).toEqual({ kind: "none" });
    expect(masker.maskBody(new Uint8Array(0), "text/plain", false)).toEqual({ kind: "none" });
    expect(masker.maskBody(bytes("abc"), "image/png", false)).toEqual({ kind: "binary", contentType: "image/png", sizeBytes: 3 });
    expect(masker.maskBody(new Uint8Array([1, 2, 0, 4]), null, false)).toMatchObject({ kind: "binary", sizeBytes: 4 });
    expect(masker.maskBody(bytes("plain"), "text/plain", false)).toMatchObject({ kind: "text", truncated: false, sizeBytes: 5 });
  });

  it("truncates after masking, never cuts a masked value in half, and states the full size", () => {
    const masker = new Masker([{ name: "k", value: SECRET, kind: "environment" }]);
    const text = `${SECRET}${"x".repeat(DISPLAY_LIMIT_CHARS + 10)}`;
    const body = masker.maskBody(bytes(text), "text/plain", false);
    if (body.kind !== "text") throw new Error("expected text");
    expect(body.truncated).toBe(true);
    expect(body.sizeBytes).toBe(text.length);
    expect(body.text[0]).toMatchObject({ kind: "masked" });
    expect(plain(body.text)).toHaveLength(3 + DISPLAY_LIMIT_CHARS);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("marks a body longer than the read cap as truncated", () => {
    const body = new Masker([]).maskBody(bytes("abc"), "text/plain", true);
    expect(body).toMatchObject({ kind: "text", truncated: true });
  });
});
