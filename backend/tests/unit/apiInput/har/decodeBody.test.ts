import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeBody, mediaType, type RawBody } from "../../../../src/apiInput/har/decodeBody";
import { DEFAULT_INPUT_LIMITS } from "../../../../src/apiInput/limits";

const limits = DEFAULT_INPUT_LIMITS;
const json = (text: string, extra: Partial<RawBody> = {}): RawBody => ({ text, mimeType: "application/json; charset=utf-8", ...extra });
const reason = (outcome: ReturnType<typeof decodeBody>) => (outcome.kind === "unavailable" ? outcome.reason : outcome.kind);

describe("decodeBody: JSON", () => {
  it("parses a declared JSON body, including +json media types", () => {
    expect(decodeBody(json('{"a":1}'), "response", limits)).toEqual({ kind: "available", format: "json", value: { a: 1 } });
    expect(decodeBody({ text: "[1]", mimeType: "application/problem+json" }, "response", limits)).toMatchObject({ kind: "available", value: [1] });
  });

  it("reports declared JSON that does not parse, and a truncated one when the declared size is larger", () => {
    expect(reason(decodeBody(json("not json", { declaredSize: 8 }), "response", limits))).toBe("invalid-json");
    expect(reason(decodeBody(json('{"a":', { declaredSize: 500 }), "response", limits))).toBe("truncated");
  });

  it("refuses JSON nested past the embedded depth limit", () => {
    const deep = `${"[".repeat(40)}1${"]".repeat(40)}`;
    expect(reason(decodeBody(json(deep), "response", limits))).toBe("too-deep");
    expect(decodeBody(json(`${"[".repeat(32)}1${"]".repeat(32)}`), "response", limits).kind).toBe("available");
  });

  it("treats a body of an undeclared or other media type as not JSON, never guessing", () => {
    expect(reason(decodeBody({ text: '{"a":1}', mimeType: "text/plain" }, "response", limits))).toBe("not-json");
    expect(reason(decodeBody({ text: '{"a":1}' }, "response", limits))).toBe("not-json");
    expect(reason(decodeBody({ text: "<a/>", mimeType: "application/xml" }, "response", limits))).toBe("not-json");
  });
});

describe("decodeBody: size, encoding and compression", () => {
  it("skips a body larger than the limit without parsing it", () => {
    const big = JSON.stringify({ blob: "x".repeat(2000) });
    expect(reason(decodeBody(json(big), "response", { ...limits, maxBodyBytes: 1000 }))).toBe("oversized");
  });

  it("checks the size of a base64 body before decoding it", () => {
    const text = Buffer.from("x".repeat(3000)).toString("base64");
    expect(reason(decodeBody(json(text, { encoding: "base64" }), "response", { ...limits, maxBodyBytes: 1000 }))).toBe("oversized");
  });

  it("decodes a base64 body that holds JSON", () => {
    const text = Buffer.from('{"a":1}').toString("base64");
    expect(decodeBody(json(text, { encoding: "base64" }), "response", limits)).toMatchObject({ kind: "available", value: { a: 1 } });
  });

  it("reports compression and never decompresses", () => {
    const gz = gzipSync(Buffer.from('{"a":1}')).toString("base64");
    expect(reason(decodeBody(json(gz, { encoding: "base64" }), "response", limits))).toBe("compressed");
    const plainButHeader = Buffer.from('{"a":1}').toString("base64");
    expect(reason(decodeBody(json(plainButHeader, { encoding: "base64", contentEncodingHeader: "br" }), "response", limits))).toBe("compressed");
  });

  it("treats readable text with a Content-Encoding header as already decoded by the capturing tool", () => {
    expect(decodeBody(json('{"a":1}', { contentEncodingHeader: "gzip" }), "response", limits).kind).toBe("available");
  });

  it("reports an encoding other than base64 as undecodable", () => {
    expect(reason(decodeBody(json("abc", { encoding: "rot13" }), "response", limits))).toBe("undecodable-encoding");
  });

  it("reports binary media types and base64 bodies holding NUL bytes as binary", () => {
    for (const mime of ["image/png", "audio/mpeg", "video/mp4", "application/pdf", "application/zip", "application/octet-stream"]) {
      expect(reason(decodeBody({ text: "x", mimeType: mime }, "response", limits)), mime).toBe("binary");
    }
    const nul = Buffer.from([0x41, 0x00, 0x42]).toString("base64");
    expect(reason(decodeBody({ text: nul, mimeType: "text/plain", encoding: "base64" }, "response", limits))).toBe("binary");
  });
});

describe("decodeBody: absent, missing and empty bodies", () => {
  it("treats no body as normal when nothing says one existed", () => {
    expect(decodeBody({ mimeType: "application/json" }, "response", limits)).toEqual({ kind: "absent" });
    expect(decodeBody({ text: "", mimeType: "application/json", declaredSize: 0 }, "response", limits)).toEqual({ kind: "absent" });
    expect(decodeBody({}, "request", limits)).toEqual({ kind: "absent" });
  });

  it("reports a response body that was declared but not captured as missing", () => {
    expect(reason(decodeBody({ mimeType: "application/json", declaredSize: 120 }, "response", limits))).toBe("missing");
  });

  it("reports a request that declared a body length but has none as missing, and an empty postData as empty", () => {
    expect(reason(decodeBody({ declaredSize: 20 }, "request", limits))).toBe("missing");
    expect(reason(decodeBody({ postDataPresent: true, mimeType: "application/json", text: "" }, "request", limits))).toBe("empty");
  });
});

describe("decodeBody: form-style bodies (FR-056)", () => {
  it("reads urlencoded fields from params", () => {
    const outcome = decodeBody(
      { mimeType: "application/x-www-form-urlencoded", params: [{ name: "a", value: "1" }, { name: "b", value: "two words" }] },
      "request",
      limits,
    );
    expect(outcome).toEqual({ kind: "available", format: "form", value: { a: "1", b: "two words" } });
  });

  it("parses urlencoded text when params are absent, decoding and keeping the first duplicate", () => {
    const outcome = decodeBody({ mimeType: "application/x-www-form-urlencoded", text: "a=1&b=x%20y+z&a=2&flag" }, "request", limits);
    expect(outcome).toEqual({ kind: "available", format: "form", value: { a: "1", b: "x y z", flag: "" }, duplicateFieldName: true });
  });

  it("keeps a __proto__ field name as ordinary data, not a prototype", () => {
    const outcome = decodeBody({ mimeType: "application/x-www-form-urlencoded", text: "__proto__=x&a=1" }, "request", limits);
    expect(outcome.kind).toBe("available");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("reads multipart text fields as a form", () => {
    const outcome = decodeBody(
      { mimeType: "multipart/form-data; boundary=x", params: [{ name: "title", value: "hello" }, { name: "n", value: "1" }] },
      "request",
      limits,
    );
    expect(outcome).toEqual({ kind: "available", format: "form", value: { title: "hello", n: "1" } });
  });

  it("marks a multipart request with a file part as unavailable and keeps its text fields as evidence", () => {
    const outcome = decodeBody(
      {
        mimeType: "multipart/form-data; boundary=x",
        params: [{ name: "caption", value: "pic" }, { name: "file", fileName: "a.png", contentType: "image/png" }],
      },
      "request",
      limits,
    );
    expect(outcome).toEqual({ kind: "unavailable", reason: "multipart-file", formFields: { caption: "pic" } });
  });

  it("cannot read a multipart body that has no params", () => {
    expect(reason(decodeBody({ mimeType: "multipart/form-data", text: "--x\r\n..." }, "request", limits))).toBe("not-json");
  });
});

describe("mediaType", () => {
  it("lower-cases and drops parameters", () => {
    expect(mediaType("Application/JSON; charset=UTF-8")).toBe("application/json");
    expect(mediaType("")).toBeUndefined();
    expect(mediaType(undefined)).toBeUndefined();
  });
});
