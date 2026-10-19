import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrerequisitePanel } from "../../../src/components/securityLab/PrerequisitePanel";
import { ScenarioDetail } from "../../../src/components/securityLab/ScenarioDetail";
import { NO_FLAGS, scenarioDetail, versionSummary } from "./securityFixtures";

function renderDetail(detail = scenarioDetail()) {
  render(<ScenarioDetail detail={detail} headingId="h" categoryName="Authentication" actions={<button type="button">An action</button>} />);
}

describe("ScenarioDetail (T076, FR-024 to FR-033)", () => {
  it("names the scenario in a heading and states its operation, category, version, origin and states as text", () => {
    renderDetail(scenarioDetail({ scenario: { reviewState: "in_review", severity: "critical", currentVersion: 3, origin: "user" } }));
    expect(screen.getByRole("heading", { level: 3, name: "Reject a request with no credentials" })).toBeInTheDocument();
    const article = screen.getByTestId("scenario-detail");
    for (const text of ["/orders", "Authentication", "Version 3", "Written by you", "Critical", "In review", "Not run"]) {
      expect(within(article).getByText(text)).toBeInTheDocument();
    }
    expect(within(article).getByLabelText("HTTP method GET")).toBeInTheDocument();
    expect(within(article).getByRole("button", { name: "An action" })).toBeInTheDocument();
  });

  it("previews the request and the expected behavior in code blocks", () => {
    renderDetail();
    const blocks = screen.getAllByTestId("code-block").map((block) => block.textContent ?? "");
    expect(blocks[0]).toContain('"operation": "GET /orders"');
    expect(blocks[0]).toContain('"kind": "auth.omit"');
    expect(blocks[0]).toContain('"Accept": "application/json"');
    expect(blocks[1]).toContain('"basis": "documented"');
    expect(screen.getByText("Base request and controlled mutations")).toBeInTheDocument();
    expect(screen.getByText("Planned requests: 1.", { exact: false })).toBeInTheDocument();
  });

  it("shows a documented basis with its documented status codes and source", () => {
    renderDetail();
    const basis = screen.getByTestId("expected-basis");
    expect(basis).toHaveTextContent("Documented in the specification");
    expect(basis).toHaveTextContent("Documented status codes: 401");
    expect(basis).toHaveTextContent("#/paths/~1orders/get/responses/401");
  });

  it("shows a named product rule, and says the specification does not document it", () => {
    renderDetail(
      scenarioDetail({ content: { expected: { kind: "rejected", statement: "The request is rejected.", basis: "product-rule", ruleId: "authentication.omit-credentials" } } }),
    );
    const basis = screen.getByTestId("expected-basis");
    expect(basis).toHaveTextContent("Product rule");
    expect(basis).toHaveTextContent("authentication.omit-credentials");
    expect(basis).toHaveTextContent("does not document");
    expect(basis).not.toHaveTextContent("Documented in the specification");
  });

  it("lists the evaluation conditions in words, and says so when there are none", () => {
    renderDetail(scenarioDetail({ content: { conditions: [{ kind: "status.in-set", codes: [401, 403] }, { kind: "header.absent", name: "Server" }] } }));
    const items = within(screen.getByTestId("condition-list")).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["The response status is one of 401, 403.", 'The response does not have the "Server" header.']);
  });

  it("says a scenario with no conditions cannot be given a pass or fail", () => {
    renderDetail(scenarioDetail({ content: { conditions: [] } }));
    expect(screen.getByText(/no evaluation conditions, so a run cannot give it a pass or fail/)).toBeInTheDocument();
  });

  it("shows a destructive scenario with a visible badge and the reasons, and says so when it is not destructive", () => {
    renderDetail(scenarioDetail({ scenario: { destructive: true }, content: { destructive: { flag: true, reasons: ["The method DELETE removes the order."] } } }));
    expect(screen.getAllByText("Destructive").length).toBeGreaterThan(0);
    expect(screen.getByTestId("detail-destructive")).toHaveTextContent("may change or delete data on the target");
    expect(screen.getByTestId("detail-destructive")).toHaveTextContent("The method DELETE removes the order.");
  });

  it("says plainly that a scenario is not destructive", () => {
    renderDetail();
    expect(screen.getByTestId("detail-not-destructive")).toHaveTextContent("Not marked destructive.");
  });

  it("explains each flag in words beside its badge", () => {
    renderDetail(scenarioDetail({ scenario: { flags: { ...NO_FLAGS, stale: true, specificationNotLoaded: true } } }));
    const flags = screen.getByRole("list", { name: "Why this scenario is flagged" });
    expect(flags).toHaveTextContent("Stale");
    expect(flags).toHaveTextContent("The operation changed since this scenario was generated.");
    expect(flags).toHaveTextContent("Specification not loaded");
    expect(flags).toHaveTextContent("It stays readable");
  });

  it("shows the history by version with the approval each applies to", () => {
    const approval = { version: 2, contentHash: "h", approvedAt: "2026-10-18T10:00:00.000Z", actor: "x", destructiveConfirmed: false, carriedFromVersion: 1 };
    renderDetail(
      scenarioDetail({
        scenario: { currentVersion: 3, reviewState: "in_review" },
        versions: [
          versionSummary({ version: 1 }),
          versionSummary({ version: 2, author: "user", materialChange: false, editNote: "Reworded the title", approval, createdAt: "2026-10-18T09:30:00.000Z" }),
          versionSummary({ version: 3, author: "user", materialChange: true, createdAt: "2026-10-18T12:00:00.000Z" }),
        ],
      }),
    );
    const rows = screen.getAllByTestId("version-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Generated original")).toBeInTheDocument();
    expect(within(rows[0]).getByText("No approval")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Approval applies to version 2")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Carried over from version 1 because this edit was not material.")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Not current: version 3 is the current version/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Reworded the title")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Edited by you")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Material change")).toBeInTheDocument();
    expect(within(rows[2]).getByText("(current)")).toBeInTheDocument();
  });

  it("shows a withdrawn approval and a rejection with its reason", () => {
    const approval = { version: 1, contentHash: "h", approvedAt: "2026-10-18T10:00:00.000Z", actor: "x", destructiveConfirmed: true, withdrawnAt: "2026-10-18T11:00:00.000Z" };
    renderDetail(scenarioDetail({ versions: [versionSummary({ approval, rejection: { reason: "Out of scope", at: "2026-10-18T11:00:00.000Z" } })] }));
    const row = screen.getByTestId("version-row");
    expect(within(row).getByText("Withdrawn 2026-10-18 11:00 UTC.")).toBeInTheDocument();
    expect(within(row).getByText("Destructive: confirmed by name.")).toBeInTheDocument();
    expect(within(row).getByText("Rejected 2026-10-18 11:00 UTC: Out of scope")).toBeInTheDocument();
  });

  it("shows the specification element and rule the scenario came from", () => {
    renderDetail();
    expect(screen.getByText("/operations/GET /orders/security")).toBeInTheDocument();
    expect(screen.getByText("authentication.omit-credentials")).toBeInTheDocument();
  });
});

describe("PrerequisitePanel (T076, FR-019, FR-029)", () => {
  it("states how many are met and names exactly what is missing", () => {
    render(
      <PrerequisitePanel
        prerequisites={[
          { id: "1", kind: "identity", description: "An administrator identity", state: "missing", detail: "No profile is selected." },
          { id: "2", kind: "test-data", description: "A valid order id", state: "met" },
          { id: "3", kind: "ownership", description: "Two users who own different orders", state: "unsupported" },
        ]}
        requiredIdentities={[{ role: "admin", label: "Administrator" }]}
      />,
    );
    expect(screen.getByTestId("prerequisite-summary")).toHaveTextContent("1 of 3 prerequisites met. Missing: An administrator identity; Two users who own different orders.");
    const items = screen.getAllByTestId("prerequisite-item");
    expect(within(items[0]).getByText("Missing")).toBeInTheDocument();
    expect(within(items[0]).getByText("No profile is selected.")).toBeInTheDocument();
    expect(within(items[1]).getByText("Met")).toBeInTheDocument();
    expect(within(items[2]).getByText("Not supported")).toBeInTheDocument();
    expect(screen.getByText("Administrator (role: admin)")).toBeInTheDocument();
  });

  it("says a prerequisite that was not evaluated is not evaluated, not met", () => {
    render(<PrerequisitePanel prerequisites={[{ id: "1", kind: "role", description: "A second role" }]} requiredIdentities={[]} />);
    expect(within(screen.getByTestId("prerequisite-item")).getByText("Not evaluated")).toBeInTheDocument();
    expect(screen.getByTestId("prerequisite-summary")).toHaveTextContent("0 of 1 prerequisites met. Missing: A second role.");
  });

  it("says when there are no prerequisites", () => {
    render(<PrerequisitePanel prerequisites={[]} requiredIdentities={[]} />);
    expect(screen.getByText("This scenario has no prerequisites.")).toBeInTheDocument();
    expect(screen.queryByTestId("prerequisite-summary")).not.toBeInTheDocument();
  });
});
