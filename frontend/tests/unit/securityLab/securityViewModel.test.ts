import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATUSES,
  FINDING_STATUSES,
  OBSERVATION_CLASSES,
  SCENARIO_OUTCOME_KINDS,
  SECURITY_REVIEW_STATES,
  SEVERITIES,
  SUPPORT_LEVELS,
} from "@apipilot/shared-domain";
import {
  ALL_VARIANT_SETS,
  SEVERITY_ORDER,
  classificationVariant,
  executionStatusVariant,
  findingStatusVariant,
  outcomeVariant,
  reviewStateVariant,
  severityVariant,
  supportLevelVariant,
} from "../../../src/components/securityLab/securityViewModel";

describe("Security Lab view model (FR-066)", () => {
  it("covers every value of every closed set, so no state renders without a label", () => {
    for (const value of SEVERITIES) expect(severityVariant(value).label).not.toBe("");
    for (const value of SECURITY_REVIEW_STATES) expect(reviewStateVariant(value).label).not.toBe("");
    for (const value of EXECUTION_STATUSES) expect(executionStatusVariant(value).label).not.toBe("");
    for (const value of SCENARIO_OUTCOME_KINDS) expect(outcomeVariant(value).label).not.toBe("");
    for (const value of OBSERVATION_CLASSES) expect(classificationVariant(value).label).not.toBe("");
    for (const value of SUPPORT_LEVELS) expect(supportLevelVariant(value).label).not.toBe("");
    for (const value of FINDING_STATUSES) expect(findingStatusVariant(value).label).not.toBe("");
  });

  it("gives every value in a set its own text label, so meaning is never colour alone", () => {
    for (const [name, set] of Object.entries(ALL_VARIANT_SETS)) {
      const labels = Object.values(set).map((variant) => variant.label);
      expect(new Set(labels).size, name).toBe(labels.length);
    }
  });

  it("names the four observation classes exactly as the specification does", () => {
    expect(OBSERVATION_CLASSES.map((c) => classificationVariant(c).label)).toEqual([
      "Informational observation",
      "Potential risk",
      "Requires additional context",
      "Not measurable",
    ]);
  });

  it("treats a failed or errored outcome as danger and never marks a blocked or not-run one as success", () => {
    expect(outcomeVariant("failed").tone).toBe("danger");
    expect(outcomeVariant("errored").tone).toBe("danger");
    expect(outcomeVariant("passed").tone).toBe("success");
    for (const kind of ["blocked", "not_run", "inconclusive"] as const) expect(outcomeVariant(kind).tone).not.toBe("success");
  });

  it("orders severities most severe first and covers them all", () => {
    expect(SEVERITY_ORDER).toEqual(["critical", "high", "medium", "low", "info"]);
    expect([...SEVERITY_ORDER].sort()).toEqual([...SEVERITIES].sort());
  });
});
