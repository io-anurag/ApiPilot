import { describe, expect, it } from "vitest";
import { detectFormat, matchedFamilies } from "../../../src/apiInput/detectFormat";
import {
  AmbiguousInputError,
  InputLimitExceededError,
  InvalidJsonError,
  UnrecognizedInputError,
} from "../../../src/apiInput/errors";
import { DEFAULT_INPUT_LIMITS } from "../../../src/apiInput/limits";

const limits = DEFAULT_INPUT_LIMITS;

describe("detectFormat: YAML and empty content stay on the unchanged pipeline", () => {
  it.each([
    ["an OpenAPI YAML document", "openapi: 3.0.0\ninfo:\n  title: t\n  version: '1'\npaths: {}\n"],
    ["an empty string", ""],
    ["whitespace only", "   \n\t  \n"],
    ["a byte-order mark only", "﻿"],
    ["a YAML document that is not an object", "just a scalar\n"],
  ])("%s is YAML", (_label, text) => {
    expect(detectFormat(text, limits)).toEqual({ kind: "yaml" });
  });

  it("keeps a YAML flow mapping that is not valid JSON on the YAML path", () => {
    expect(detectFormat("{openapi: 3.0.0, info: {title: t, version: '1'}, paths: {}}", limits)).toEqual({ kind: "yaml" });
  });

  it("does not use the file name or extension: a .har-named YAML body is YAML", () => {
    // detectFormat has no file-name parameter at all; the content decides.
    expect(detectFormat("openapi: 3.0.0\npaths: {}\n", limits).kind).toBe("yaml");
  });
});

describe("detectFormat: one discriminating marker per JSON family", () => {
  const detect = (value: unknown) => detectFormat(JSON.stringify(value), limits);

  it("recognizes OpenAPI by `openapi` or `swagger`", () => {
    expect(detect({ openapi: "3.0.3", paths: {} })).toMatchObject({ kind: "json", family: "openapi" });
    expect(detect({ swagger: "2.0", paths: {} })).toMatchObject({ kind: "json", family: "openapi" });
  });

  it("recognizes a HAR by `log` with entries, version, creator or pages", () => {
    expect(detect({ log: { entries: [] } })).toMatchObject({ family: "har" });
    expect(detect({ log: { version: "1.2" } })).toMatchObject({ family: "har" });
    expect(detect({ log: { creator: { name: "x" } } })).toMatchObject({ family: "har" });
    expect(detect({ log: { pages: [] } })).toMatchObject({ family: "har" });
  });

  it("recognizes an ApiPilot definition only by its exact format identifier", () => {
    expect(detect({ format: "apipilot.api-definition", version: 1, operations: [] })).toMatchObject({ family: "api-definition" });
    expect(() => detect({ operations: [{ path: "/x", method: "GET" }] })).toThrow(UnrecognizedInputError);
    expect(() => detect({ format: "apipilot.api-definition-x", operations: [] })).toThrow(UnrecognizedInputError);
  });

  it("recognizes a Postman collection by schema URL or by _postman_id plus item", () => {
    expect(
      detect({ info: { schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [] }),
    ).toMatchObject({ family: "postman-collection" });
    expect(detect({ info: { _postman_id: "abc", name: "n" }, item: [] })).toMatchObject({ family: "postman-collection" });
    expect(() => detect({ info: { _postman_id: "abc" } })).toThrow(UnrecognizedInputError);
  });

  it("refuses a JSON object with no marker, naming the supported formats and not echoing keys", () => {
    try {
      detect({ hello: "world", "secret-looking-key": 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnrecognizedInputError);
      const message = (error as Error).message;
      expect(message).toContain("OpenAPI");
      expect(message).toContain("HAR");
      expect(message).not.toContain("secret-looking-key");
      expect(message).not.toContain("world");
    }
  });

  it("refuses arrays and scalars as unrecognized", () => {
    expect(() => detectFormat("[1,2,3]", limits)).toThrow(UnrecognizedInputError);
    expect(() => detectFormat("[]", limits)).toThrow(UnrecognizedInputError);
  });

  it("refuses a document with markers of two families, naming both, with no precedence", () => {
    const doc = { openapi: "3.0.0", log: { entries: [] } };
    expect(matchedFamilies(doc)).toEqual(["openapi", "har"]);
    try {
      detect(doc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousInputError);
      expect((error as Error).message).toContain("OpenAPI");
      expect((error as Error).message).toContain("HAR capture");
    }
  });
});

describe("detectFormat: invalid and hostile JSON", () => {
  it("reports truncated JSON that is also not YAML as invalid_json with a position and no content", () => {
    const secret = "SEEDED-SECRET-TRUNCATED";
    try {
      detectFormat(`{"log": {"entries": [{"note": "${secret}"`, limits);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidJsonError);
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).toMatch(/line \d+, column \d+|position \d+|not valid JSON/);
    }
  });

  it("refuses JSON nested past the depth limit and names the limit", () => {
    try {
      detectFormat("[".repeat(500) + "]".repeat(500), { ...limits, maxJsonDepth: 128 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InputLimitExceededError);
      expect((error as InputLimitExceededError).limit).toBe("INPUT_MAX_JSON_DEPTH");
      expect((error as InputLimitExceededError).maximum).toBe(128);
    }
  });

  it("strips a byte-order mark before looking at JSON", () => {
    expect(detectFormat(`${String.fromCharCode(0xfeff)}${JSON.stringify({ openapi: "3.0.0" })}`, limits)).toMatchObject({ family: "openapi" });
  });
});
