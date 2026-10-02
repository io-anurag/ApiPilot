import { describe, expect, it } from "vitest";
import { laterStepParameterMatches } from "@apipilot/shared-domain";

/** AP-035 FR-009, research R9 (specs/035-user-defined-journeys tasks T011). */
describe("laterStepParameterMatches", () => {
  it("matches a field whose last name equals a later step's parameter", () => {
    expect(laterStepParameterMatches("id", ["id"])).toBe(true);
    expect(laterStepParameterMatches("data.customer.id", ["id", "customer"])).toBe(true);
    expect(laterStepParameterMatches("items[0]", ["items"])).toBe(true);
  });

  it("does not match on another segment, a prefix or no later parameter", () => {
    expect(laterStepParameterMatches("id.value", ["id"])).toBe(false);
    expect(laterStepParameterMatches("identifier", ["id"])).toBe(false);
    expect(laterStepParameterMatches("id", [])).toBe(false);
  });
});
