import { describe, expect, it } from "vitest";
import {
  REDACTED,
  collectRedactedValues,
  redactBody,
  redactFreeText,
  redactHeaders,
  redactUrl,
  scanOutput,
  sensitiveVariableValues,
} from "../../../src/failureAnalysis/redaction";
import { SECRET_VALUES, rawCaptureWithSecrets } from "../../fixtures/failureAnalysis/fixtures";

describe("failure-analysis redaction (FR-011, SC-003)", () => {
  it("redacts credential-carrying header values and any bearer-shaped value", () => {
    const { value, redacted } = redactHeaders([
      { key: "Authorization", value: "Bearer abc.def.ghi" },
      { key: "Cookie", value: "session=s3cr3t" },
      { key: "X-Api-Key", value: "k-123" },
      { key: "X-Custom", value: "Bearer zzz.yyy" },
      { key: "Content-Type", value: "application/json" },
    ]);

    expect(value.map((header) => header.value)).toEqual([
      REDACTED,
      REDACTED,
      REDACTED,
      REDACTED,
      "application/json",
    ]);
    expect(redacted).toEqual(expect.arrayContaining(["abc.def.ghi", "session=s3cr3t", "k-123"]));
  });

  it("redacts sensitive query parameters and user-info passwords while keeping others", () => {
    expect(redactUrl("http://localhost:4010/users?api_key=SECRET1&page=2").value).toBe(
      `http://localhost:4010/users?api_key=${REDACTED}&page=2`,
    );
    const withUser = redactUrl("https://alice:hunter2@example.test/x");
    expect(withUser.value).toBe(`https://alice:${REDACTED}@example.test/x`);
    expect(withUser.redacted).toContain("hunter2");
  });

  it("redacts sensitive JSON fields recursively, including nested objects and arrays", () => {
    const excerpt = redactBody(
      JSON.stringify({ user: "u", password: "SECRET2", nested: [{ token: "SECRET1" }], credentials: { a: "x9y8" } }),
      10_000,
    );

    expect(JSON.parse(excerpt.text)).toEqual({
      user: "u",
      password: REDACTED,
      nested: [{ token: REDACTED }],
      credentials: REDACTED,
    });
    expect(excerpt.redacted).toEqual(expect.arrayContaining(["SECRET2", "SECRET1", "x9y8"]));
  });

  it("redacts bearer tokens and sensitive key=value pairs in non-JSON bodies", () => {
    const excerpt = redactBody("grant=client&client_secret=SECRET1&note=Bearer abc.def.ghi", 10_000);
    expect(excerpt.text).toBe(`grant=client&client_secret=${REDACTED}&note=Bearer ${REDACTED}`);
    expect(redactFreeText('expected "token": "SECRET2" to be absent').value).toBe(
      `expected "token": "${REDACTED}" to be absent`,
    );
  });

  it("stays fast on long adversarial text (linear scan, no catastrophic backtracking)", () => {
    const adversarial = `${"a".repeat(200_000)}token`;
    const started = Date.now();
    redactFreeText(adversarial);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("truncates only after redaction and reports the truncation", () => {
    const body = JSON.stringify({ password: "SECRET2", filler: "x".repeat(2_000) });
    const excerpt = redactBody(body, 600);
    expect(excerpt.text).toHaveLength(600);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.text).not.toContain("SECRET2");
  });

  it("collects every value redaction would replace in a capture", () => {
    expect(collectRedactedValues(rawCaptureWithSecrets())).toEqual(
      expect.arrayContaining([...SECRET_VALUES]),
    );
  });

  it("scans model output for known sensitive values and bearer tokens", () => {
    const scanned = scanOutput("The key SECRET1 was rejected; header was Bearer abc.def.ghi.", ["SECRET1"]);
    expect(scanned).not.toContain("SECRET1");
    expect(scanned).not.toContain("abc.def.ghi");
    expect(scanOutput("status 5", ["5"])).toBe("status 5");
  });

  it("selects only credential-named variable values for scanning", () => {
    expect(sensitiveVariableValues({ baseUrl: "http://x", apiToken: "t0k3n", password: "" })).toEqual(["t0k3n"]);
  });

  it("leaves no secret from the fixture capture in any redacted output", () => {
    const capture = rawCaptureWithSecrets();
    const outputs = [
      redactUrl(capture.requestUrl).value,
      JSON.stringify(redactHeaders(capture.requestHeaders).value),
      redactBody(capture.requestBody ?? "", 600).text,
    ].join("\n");
    for (const secret of SECRET_VALUES) expect(outputs).not.toContain(secret);
  });
});
