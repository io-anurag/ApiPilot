import { describe, expect, it } from "vitest";
import { missingVariableValues } from "../../../src/execution/variableCompleteness";

const declared = [
  { key: "baseUrl", value: "" },
  { key: "apiKey", value: "" },
  { key: "tenantId", value: "" },
];

describe("missingVariableValues", () => {
  it("never counts baseUrl as missing, since it is always separately supplied", () => {
    expect(missingVariableValues([{ key: "baseUrl", value: "" }], {})).toEqual([]);
  });

  it("names every declared variable with no supplied value", () => {
    expect(missingVariableValues(declared, {})).toEqual(["apiKey", "tenantId"]);
  });

  it("names only the ones still missing when some are supplied", () => {
    expect(missingVariableValues(declared, { apiKey: "secret" })).toEqual(["tenantId"]);
  });

  it("treats an empty-string value as missing", () => {
    expect(missingVariableValues(declared, { apiKey: "", tenantId: "t1" })).toEqual(["apiKey"]);
  });

  it("returns an empty list once every declared variable has a value", () => {
    expect(missingVariableValues(declared, { apiKey: "secret", tenantId: "t1" })).toEqual([]);
  });
});
