import { describe, expect, it } from "vitest";
import { InputLimitExceededError, InvalidHarError } from "../../../../src/apiInput/errors";
import { DEFAULT_INPUT_LIMITS } from "../../../../src/apiInput/limits";
import { validateHar } from "../../../../src/apiInput/har/validateHar";

const limits = DEFAULT_INPUT_LIMITS;
const entry = { request: { method: "GET", url: "https://a.test/x" }, response: { status: 200 } };

describe("validateHar (FR-009, FR-045)", () => {
  it("accepts a capture with entries and reads version, creator and page titles", () => {
    const meta = validateHar(
      {
        log: {
          version: "1.2",
          creator: { name: "WebInspector", version: "537.36" },
          pages: [{ title: "https://shop.test/" }, { title: "not a url" }, { id: "no title" }],
          entries: [entry],
        },
      },
      limits,
    );
    expect(meta.entries).toHaveLength(1);
    expect(meta.harVersion).toBe("1.2");
    expect(meta.creator).toBe("WebInspector 537.36");
    expect(meta.pageTitles).toEqual(["https://shop.test/", "not a url"]);
  });

  it("strips control characters and caps the length of the labels it keeps", () => {
    const meta = validateHar({ log: { version: "1.2\u0000\n", creator: { name: `x${"y".repeat(500)}` }, entries: [entry] } }, limits);
    expect(meta.harVersion).toBe("1.2");
    expect(meta.creator?.length).toBeLessThanOrEqual(80);
  });

  it("rejects a document with no log object", () => {
    expect(() => validateHar({ entries: [entry] }, limits)).toThrow(InvalidHarError);
    expect(() => validateHar({ log: "nope" }, limits)).toThrow(/no 'log' object/);
  });

  it("rejects a log whose entries are missing or not a list", () => {
    expect(() => validateHar({ log: { version: "1.2" } }, limits)).toThrow(/log\.entries/);
    expect(() => validateHar({ log: { entries: {} } }, limits)).toThrow(InvalidHarError);
  });

  it("rejects an empty capture with an actionable message", () => {
    expect(() => validateHar({ log: { entries: [] } }, limits)).toThrow(/no entries/);
  });

  it("refuses more entries than the limit, naming the limit and the remedy", () => {
    const entries = Array.from({ length: 6 }, () => entry);
    try {
      validateHar({ log: { entries } }, { ...limits, harMaxEntries: 5 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InputLimitExceededError);
      expect((error as InputLimitExceededError).limit).toBe("INPUT_HAR_MAX_ENTRIES");
      expect((error as InputLimitExceededError).maximum).toBe(5);
      expect((error as Error).message).toMatch(/narrower session/);
    }
  });

  it("accepts exactly the limit", () => {
    expect(validateHar({ log: { entries: [entry, entry] } }, { ...limits, harMaxEntries: 2 }).entries).toHaveLength(2);
  });
});
