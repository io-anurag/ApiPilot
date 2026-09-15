import { describe, expect, it } from "vitest";
import {
  percentEncode,
  resolveParameterStyle,
  serializeQueryParameter,
  serializeSimpleValue,
} from "../../../src/postman/parameterSerialization";
import {
  coordsMatrixPathParam,
  coordsLabelPathParam,
  filterDeepObjectParam,
  filterFormExplodeFalseParam,
  filterFormExplodeTrueParam,
  idSimplePathParam,
  metadataContentEncodedParam,
  sortDefaultParam,
  sortFormExplodeFalseParam,
  sortFormExplodeTrueParam,
  sortPipeDelimitedParam,
  sortSpaceDelimitedParam,
  tagsSimpleHeaderParam,
} from "../../fixtures/postman/parameterFixtures";

describe("resolveParameterStyle", () => {
  it("resolves the query default (form, explode: true) when style/explode are omitted", () => {
    expect(resolveParameterStyle(sortDefaultParam)).toEqual({
      style: "form",
      explode: true,
      implemented: true,
    });
  });

  it("resolves the path default (simple, explode: false) when style/explode are omitted", () => {
    expect(resolveParameterStyle(idSimplePathParam)).toEqual({
      style: "simple",
      explode: false,
      implemented: true,
    });
  });

  it("resolves the header default (simple, explode: false) when style/explode are omitted", () => {
    expect(resolveParameterStyle(tagsSimpleHeaderParam)).toEqual({
      style: "simple",
      explode: false,
      implemented: true,
    });
  });

  it("preserves an explicitly declared style/explode instead of the default", () => {
    expect(resolveParameterStyle(sortSpaceDelimitedParam)).toEqual({
      style: "spaceDelimited",
      explode: false,
      implemented: true,
    });
  });

  it("marks a matrix-style parameter as not implemented", () => {
    expect(resolveParameterStyle(coordsMatrixPathParam).implemented).toBe(false);
  });

  it("marks a label-style parameter as not implemented", () => {
    expect(resolveParameterStyle(coordsLabelPathParam).implemented).toBe(false);
  });

  it("marks a content-encoded parameter as not implemented regardless of any style value", () => {
    expect(resolveParameterStyle(metadataContentEncodedParam).implemented).toBe(false);
  });
});

describe("percentEncode", () => {
  it("encodes &, =, #, ?, and space", () => {
    expect(percentEncode("a&b=c#d?e f")).toBe("a%26b%3Dc%23d%3Fe%20f");
  });

  it("leaves ordinary alphanumeric text unchanged", () => {
    expect(percentEncode("name123")).toBe("name123");
  });
});

describe("serializeQueryParameter", () => {
  it("form/explode:true (default) renders one repeated-key entry per array element, in order", () => {
    const entries = serializeQueryParameter("sort", ["name", "-price"], resolveParameterStyle(sortFormExplodeTrueParam));
    expect(entries).toEqual([
      { key: "sort", value: "name" },
      { key: "sort", value: "-price" },
    ]);
  });

  it("form/explode:false comma-joins array elements into one entry", () => {
    const entries = serializeQueryParameter("sort", ["name", "-price"], resolveParameterStyle(sortFormExplodeFalseParam));
    expect(entries).toEqual([{ key: "sort", value: "name,-price" }]);
  });

  it("spaceDelimited joins array elements with an encoded space", () => {
    const entries = serializeQueryParameter("sort", ["name", "-price"], resolveParameterStyle(sortSpaceDelimitedParam));
    expect(entries).toEqual([{ key: "sort", value: "name%20-price" }]);
  });

  it("pipeDelimited joins array elements with a literal pipe", () => {
    const entries = serializeQueryParameter("sort", ["name", "-price"], resolveParameterStyle(sortPipeDelimitedParam));
    expect(entries).toEqual([{ key: "sort", value: "name|-price" }]);
  });

  it("deepObject renders one key[property]=value entry per property, in the object's own key order", () => {
    const entries = serializeQueryParameter(
      "filter",
      { status: "active", owner: "alice" },
      resolveParameterStyle(filterDeepObjectParam),
    );
    expect(entries).toEqual([
      { key: "filter[status]", value: "active" },
      { key: "filter[owner]", value: "alice" },
    ]);
  });

  it("form/explode:true (default) renders one property=value entry per property for an object value", () => {
    const entries = serializeQueryParameter(
      "filter",
      { status: "active", owner: "alice" },
      resolveParameterStyle(filterFormExplodeTrueParam),
    );
    expect(entries).toEqual([
      { key: "status", value: "active" },
      { key: "owner", value: "alice" },
    ]);
  });

  it("form/explode:false renders one flat comma-joined entry for an object value", () => {
    const entries = serializeQueryParameter(
      "filter",
      { status: "active", owner: "alice" },
      resolveParameterStyle(filterFormExplodeFalseParam),
    );
    expect(entries).toEqual([{ key: "filter", value: "status,active,owner,alice" }]);
  });

  it("percent-encodes each array element individually while keeping the comma separator literal", () => {
    const entries = serializeQueryParameter("sort", ["a&b", "c"], resolveParameterStyle(sortFormExplodeFalseParam));
    expect(entries).toEqual([{ key: "sort", value: "a%26b,c" }]);
  });

  it("renders a scalar value substituted for a declared array (negative scenario) as one entry, following the runtime shape", () => {
    const entries = serializeQueryParameter("sort", "not-an-array", resolveParameterStyle(sortFormExplodeTrueParam));
    expect(entries).toEqual([{ key: "sort", value: "not-an-array" }]);
  });

  it("percent-encodes a scalar value", () => {
    const entries = serializeQueryParameter("q", "a&b", resolveParameterStyle(sortFormExplodeTrueParam));
    expect(entries).toEqual([{ key: "q", value: "a%26b" }]);
  });
});

describe("serializeSimpleValue", () => {
  it("comma-joins an array value with explode: false", () => {
    expect(serializeSimpleValue(["a", "b", "c"], false)).toBe("a,b,c");
  });

  it("comma-joins an array value with explode: true too (no repeated-segment form for path/header)", () => {
    expect(serializeSimpleValue(["a", "b", "c"], true)).toBe("a,b,c");
  });

  it("renders a flat comma-joined property/value list for an object with explode: false", () => {
    expect(serializeSimpleValue({ status: "active", owner: "alice" }, false)).toBe("status,active,owner,alice");
  });

  it("renders property=value pairs, comma-joined, for an object with explode: true", () => {
    expect(serializeSimpleValue({ status: "active", owner: "alice" }, true)).toBe("status=active,owner=alice");
  });

  it("percent-encodes a scalar value", () => {
    expect(serializeSimpleValue("a&b", false)).toBe("a%26b");
  });

  it("percent-encodes each array element individually while the comma separator stays literal", () => {
    expect(serializeSimpleValue(["a&b", "c"], false)).toBe("a%26b,c");
  });
});
