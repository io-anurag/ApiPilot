import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import { CollectionRunSetupCard } from "../../src/components/CollectionRunSetupCard";
import { summarizeCollectionRun } from "../../src/utils/collectionRunSetup";
import type { UploadedCollectionSummary } from "../../src/services/externalCollectionsClient";

/** The Run step's details: the variables the selected requests use, linked to where their values are set. */

const request: CollectionRequestView = {
  id: "a",
  name: "Get",
  wasEdited: false,
  raw: { method: "GET", url: "{{baseUrl}}/x", headers: [] },
  resolved: { method: "GET", url: "{{baseUrl}}/x", headers: [] },
  unresolvedVariables: ["token"],
  variableReferences: [
    { name: "baseUrl", usedIn: ["url"], resolved: true, source: "environment" },
    { name: "token", usedIn: ["headers"], resolved: false },
  ],
  copiedScriptFolderIds: [],
};

function renderDetails(onOpenVariables?: () => void, requestDelayMs = 0) {
  const setup = summarizeCollectionRun({ orderedRequests: [request, { ...request, id: "b" }], selectedIds: new Set(["a", "b"]), placements: new Map([["a", { folderPath: ["Auth"] }], ["b", { folderPath: [] }]]), requestDelayMs });
  render(
    <CollectionRunSetupCard
      part="details"
      collection={{ name: "C", tier: "local", requestDelayMs } as UploadedCollectionSummary}
      setup={setup}
      totalRequests={2}
      customOrder={false}
      inProgress={false}
      starting={false}
      startDisabled={false}
      onStart={() => undefined}
      lastRunText={null}
      gates={null}
      onOpenVariables={onOpenVariables}
    />,
  );
}

describe("CollectionRunSetupCard variables", () => {
  it("shows each variable with where it is used and whether it has a value, never the value", () => {
    renderDetails();
    const table = screen.getByTestId("run-variables");
    expect(within(table).getByText("{{token}}")).toBeInTheDocument();
    expect(within(table).getByText("No value")).toBeInTheDocument();
    expect(within(table).getByText("From environment")).toBeInTheDocument();
    expect(within(table).getByText("headers")).toBeInTheDocument();
    // The one without a value comes first.
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["{{token}}", "{{baseUrl}}"]);
  });

  it("links each variable, and the hint, to Review requests when that is available", () => {
    const onOpenVariables = vi.fn();
    renderDetails(onOpenVariables);
    fireEvent.click(screen.getByRole("button", { name: "Set token in Review requests" }));
    fireEvent.click(screen.getByRole("button", { name: "Review requests" }));
    expect(onOpenVariables).toHaveBeenCalledTimes(2);
  });

  it("shows plain names, not links, when there is nowhere to go", () => {
    renderDetails();
    expect(screen.queryByRole("button", { name: /Review requests/ })).not.toBeInTheDocument();
  });
});

describe("CollectionRunSetupCard at a glance", () => {
  it("shows the authentication, test scripts, edits, least time and the requests per folder", () => {
    renderDetails(undefined, 500);
    const glance = within(screen.getByTestId("run-glance"));
    expect(glance.getByText("No auth × 2")).toBeInTheDocument();
    // Test scripts and edits are both none in this fixture.
    expect(glance.getAllByText("0 of 2 requests")).toHaveLength(2);
    expect(screen.getByTestId("run-least-time")).toHaveTextContent("0.5 s of delay");
    const folders = within(screen.getByTestId("run-folders"));
    expect(folders.getByText("Auth")).toBeInTheDocument();
    expect(folders.getByText("Collection root")).toBeInTheDocument();
  });

  it("says the time depends on the responses when there is no delay", () => {
    renderDetails();
    expect(screen.queryByTestId("run-least-time")).not.toBeInTheDocument();
    expect(screen.getByText("Depends on the responses")).toBeInTheDocument();
  });
});
