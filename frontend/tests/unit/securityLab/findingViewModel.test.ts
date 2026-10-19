import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_ERROR_LABEL,
  activeFindingFilterCount,
  checkFindingChange,
  evidenceRecordText,
  findingTitle,
  occurrenceText,
  resolvedAssertionText,
  statusTargets,
  withFindingFilter,
} from "../../../src/components/securityLab/findingViewModel";
import { FINDING_STATUSES } from "@apipilot/shared-domain";
import { evidenceRecord, finding } from "./securityFixtures";

const SERVICE = readFileSync(join(__dirname, "../../../../backend/src/securityLab/findings/findingService.ts"), "utf8");

describe("status changes mirror the backend rule", () => {
  it("is pinned to updateFinding in the backend source", () => {
    expect(SERVICE).toMatch(/if \(existing\.status !== "open" && patch\.status !== "open"\)/);
    expect(SERVICE).toMatch(/A status change needs a note/);
    expect(SERVICE).toMatch(/A severity change needs a note/);
  });

  it("offers every decision from open, and only open from any other status", () => {
    expect(statusTargets("open")).toEqual(["accepted-risk", "false-positive", "resolved"]);
    for (const status of FINDING_STATUSES.filter((entry) => entry !== "open")) expect(statusTargets(status)).toEqual(["open"]);
  });
});

describe("checkFindingChange", () => {
  const f = finding();
  it("needs something to change", () => {
    expect(checkFindingChange({ finding: f, status: "", severity: "", note: "why" }).reasons).toEqual(["Choose a new status or a new severity."]);
    expect(checkFindingChange({ finding: f, status: "open", severity: "high", note: "why" }).body).toBeUndefined();
  });

  it("needs a note for a status or a severity change", () => {
    const result = checkFindingChange({ finding: f, status: "resolved", severity: "", note: "  " });
    expect(result.body).toBeUndefined();
    expect(result.reasons[0]).toMatch(/needs one, and it is kept in the history/);
  });

  it("sends only what changed, with the trimmed note", () => {
    expect(checkFindingChange({ finding: f, status: "accepted-risk", severity: "high", note: " Known, tracked in JIRA " }).body).toEqual({ status: "accepted-risk", note: "Known, tracked in JIRA" });
    expect(checkFindingChange({ finding: f, status: "", severity: "low", note: "Internal only" }).body).toEqual({ severity: "low", note: "Internal only" });
    expect(checkFindingChange({ finding: f, status: "false-positive", severity: "info", note: "n" }).body).toEqual({ status: "false-positive", severity: "info", note: "n" });
  });
});

describe("wording", () => {
  it("names a finding by its operation and category, and counts occurrences beside it", () => {
    expect(findingTitle(finding(), "Authentication")).toBe("GET /orders: Authentication");
    expect(findingTitle(finding())).toBe("GET /orders: authentication");
    expect(occurrenceText(1)).toBe("1 occurrence");
    expect(occurrenceText(4)).toBe("4 occurrences");
  });

  it("says whether a resolved finding is verified", () => {
    expect(resolvedAssertionText(finding())).toBeUndefined();
    expect(resolvedAssertionText(finding({ status: "resolved" }))).toMatch(/has not been verified/);
    expect(resolvedAssertionText(finding({ status: "resolved", resolvedAssertion: "verified-by-rerun" }))).toMatch(/Verified: a later run/);
  });

  it("counts and edits filters, never sending an unset one", () => {
    expect(activeFindingFilterCount({})).toBe(0);
    expect(activeFindingFilterCount({ severity: "high", unreviewed: true })).toBe(2);
    expect(withFindingFilter({ severity: "high", unreviewed: true }, "unreviewed", "")).toEqual({ severity: "high" });
    expect(withFindingFilter({}, "status", "open")).toEqual({ status: "open" });
  });

  it("covers every evidence error category", () => {
    expect(Object.keys(EVIDENCE_ERROR_LABEL).sort()).toEqual(["aborted", "blocked", "connect", "read-limit", "timeout", "tls"]);
  });
});

describe("evidenceRecordText", () => {
  it("lays out the redacted request and response as text", () => {
    const text = evidenceRecordText(evidenceRecord());
    expect(text).toContain("GET https://api.example.test/orders");
    expect(text).toContain("Authorization: [redacted]");
    expect(text).toContain("Destination: api.example.test:443 (public, allowed)");
    expect(text).toContain("Response 200 after 12 ms");
    expect(text).toContain('{"orders":[]}');
    expect(text).not.toContain("truncated");
  });

  it("says when a response was truncated, a request failed or a redirect was blocked", () => {
    const text = evidenceRecordText(
      evidenceRecord({
        truncated: true,
        responseStatus: undefined,
        responseBodyExcerpt: undefined,
        error: { category: "timeout" },
        redirects: [{ toRedacted: "https://elsewhere.example/", verdict: "blocked", reason: "different_origin" }],
        requestBodyExcerpt: '{"a":1}',
      }),
    );
    expect(text).toContain("(The response was truncated.)");
    expect(text).toContain("Error: The request timed out.");
    expect(text).toContain("Redirect blocked: https://elsewhere.example/ (different_origin)");
    expect(text).toContain('{"a":1}');
  });
});
