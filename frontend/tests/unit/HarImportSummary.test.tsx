import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ImportAnalysisReport } from "@apipilot/shared-domain";
import { HarImportSummary } from "../../src/components/HarImportSummary";

const report: ImportAnalysisReport = {
  counts: { total: 46, imported: 29, excluded: 12, malformed: 5, operations: 18 },
  harVersion: "1.2",
  creator: "WebInspector 537.36",
  exclusions: [
    {
      reason: "analytics-telemetry",
      count: 2,
      samples: [
        { entryIndex: 0, method: "GET", host: "www.google-analytics.com", path: "/collect" },
        { entryIndex: 9, method: "POST", host: "api.segment.io", path: "/v1/track" },
      ],
    },
    {
      reason: "static-asset",
      count: 5,
      samples: [1, 2, 3, 4, 5].map((n) => ({ entryIndex: n, method: "GET", host: "cdn.shop.test", path: `/a${n}.js` })),
    },
    { reason: "cors-preflight", count: 1, samples: [{ entryIndex: 2, method: "OPTIONS", host: "api.shop.test", path: "/v1/orders" }] },
  ],
  malformedEntries: [
    { entryIndex: 39, reason: "missing-url" },
    { entryIndex: 40, reason: "missing-response-status" },
    { entryIndex: 41, reason: "relative-url" },
  ],
  origins: [
    { origin: "https://api.shop.test", importedEntries: 28, operations: 17 },
    { origin: "https://auth.shop.test", importedEntries: 1, operations: 1 },
  ],
  normalization: { trailingSlashesFolded: 0, duplicateSlashesCollapsed: 0, dotSegmentsRemoved: 0 },
  credentialUrlCount: 2,
  credentialUrlEntries: [{ entryIndex: 4, host: "api.shop.test" }, { entryIndex: 8, host: "api.shop.test" }],
  limitsApplied: [{ limit: "INPUT_MAX_BODY_BYTES", effect: "body skipped and reported", count: 3 }],
};

describe("HarImportSummary (specs/056 FR-042, US3)", () => {
  it("shows the five counts and says they add up", () => {
    render(<HarImportSummary report={report} />);
    const counts = screen.getByTestId("har-import-counts");
    for (const [label, value] of [
      ["Entries in file", "46"],
      ["Imported entries", "29"],
      ["Excluded entries", "12"],
      ["Malformed entries", "5"],
      ["Operations identified", "18"],
    ]) {
      expect(within(counts).getByText(label).closest("div")).toHaveTextContent(value);
    }
    expect(screen.getByTestId("har-import-reconciliation")).toHaveTextContent("29 imported + 12 excluded + 5 malformed = 46 entries");
    expect(screen.getByTestId("har-import-reconciliation")).toHaveTextContent("Captured with WebInspector 537.36");
  });

  it("states that everything shown was observed, not documented", () => {
    render(<HarImportSummary report={report} />);
    expect(screen.getByText(/Everything below was observed in the capture\. It is not a documented contract/)).toBeInTheDocument();
  });

  it("lists exclusions by reason in a semantic table with a rule name, count and examples", () => {
    render(<HarImportSummary report={report} />);
    const table = screen.getByRole("table", { name: "Excluded entries by reason" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Reason", "Entries", "Examples"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Analytics or telemetry request");
    expect(rows[0]).toHaveTextContent("2");
    expect(rows[0]).toHaveTextContent("GET www.google-analytics.com/collect");
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Static asset");
    expect(rows[1]).toHaveTextContent("and 2 more");
    expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("CORS preflight request");
  });

  it("lists malformed entries, numbered from 1, with a reason, inside a disclosure", () => {
    render(<HarImportSummary report={report} />);
    const details = screen.getByTestId("har-import-malformed");
    expect(details.tagName).toBe("DETAILS");
    expect(within(details).getByText("3 malformed entries skipped")).toBeInTheDocument();
    expect(details).toHaveTextContent("Entry 40: no request URL");
    expect(details).toHaveTextContent("Entry 41: no response status");
    expect(details).toHaveTextContent("Entry 42: the URL is relative, so there is no host");
  });

  it("names the origins, the credential URLs without any userinfo, and limits that applied", () => {
    render(<HarImportSummary report={report} />);
    expect(screen.getByTestId("har-import-origins")).toHaveTextContent("https://api.shop.test (17 operations, 28 entries)");
    expect(screen.getByTestId("har-import-origins")).toHaveTextContent("https://auth.shop.test (1 operation, 1 entry)");
    expect(screen.getByTestId("har-import-credential-urls")).toHaveTextContent("2 entries had credentials in the URL (entries 5, 9)");
    expect(screen.getByTestId("har-import-limits")).toHaveTextContent("Limit INPUT_MAX_BODY_BYTES: 3 bodies body skipped and reported.");
  });

  it("omits the sections that have nothing to say", () => {
    render(
      <HarImportSummary
        report={{ ...report, exclusions: [], malformedEntries: [], credentialUrlCount: 0, credentialUrlEntries: [], limitsApplied: [], origins: [] }}
      />,
    );
    expect(screen.queryByTestId("har-import-exclusions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("har-import-malformed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("har-import-credential-urls")).not.toBeInTheDocument();
    expect(screen.queryByTestId("har-import-limits")).not.toBeInTheDocument();
    expect(screen.queryByTestId("har-import-origins")).not.toBeInTheDocument();
    expect(screen.getByTestId("har-import-counts")).toBeInTheDocument();
  });
});
