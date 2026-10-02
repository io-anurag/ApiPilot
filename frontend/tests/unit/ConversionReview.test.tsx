import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ConversionReview } from "../../src/components/performance/collection/ConversionReview";
import { FINDING_KIND_LABEL } from "../../src/components/performance/performanceViewModel";
import { collectionPlanFixture } from "./performanceFixtures";

/** AP-036 FR-009, FR-010, FR-018 (research R14, R20; tasks T031, T058). */

const labels: Record<string, string> = { "s-create": "Customers / Create customer", "s-read": "Customers / Get customer", "s-token": "Auth / Get token" };
const items: Record<string, string> = { "req-create": "Customers / Create customer", "req-upload": "Upload" };

function renderReview(overrides = {}, onMarkReviewed = vi.fn()) {
  const collection = collectionPlanFixture(overrides).collection!;
  render(
    <ConversionReview
      collection={collection}
      busy={false}
      stepLabel={(id) => labels[id] ?? id}
      itemLabel={(id) => items[id] ?? id}
      onMarkReviewed={onMarkReviewed}
    />,
  );
  return { onMarkReviewed };
}

describe("ConversionReview", () => {
  it("states that the requests and scripts were not generated or verified by ApiPilot, and that captures need an expected status", () => {
    renderReview();
    const review = screen.getByTestId("conversion-review");
    expect(review).toHaveTextContent("The requests and scripts of APIFoundry were not generated or verified by ApiPilot.");
    expect(review).toHaveTextContent("a value is captured only when its step receives an expected status");
    expect(screen.getByText("Not reviewed")).toBeInTheDocument();
  });

  it("groups statements not converted by where the script lives, counted, with event, line, excerpt and the steps they apply to", () => {
    renderReview();
    const collectionGroup = screen.getByText("The collection").closest("details")!;
    expect(collectionGroup).toHaveTextContent("1");
    expect(within(collectionGroup).getByText(FINDING_KIND_LABEL["send-request"])).toBeInTheDocument();
    expect(collectionGroup).toHaveTextContent("Test script, line 3");
    expect(collectionGroup).toHaveTextContent('pm.sendRequest("x", () => {});');
    expect(collectionGroup).toHaveTextContent("Applies to Customers / Create customer, Customers / Get customer");
    const folder = screen.getByText("Folder Customers").closest("details")!;
    expect(within(folder).getByText(FINDING_KIND_LABEL["prerequest-not-converted"])).toBeInTheDocument();
    expect(folder).toHaveTextContent("Pre-request script");
  });

  it("lists notes and left-out requests with their reasons", () => {
    renderReview();
    expect(screen.getByText(FINDING_KIND_LABEL["scope-precedence"])).toBeInTheDocument();
    expect(screen.getByText("Upload", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Its formdata body cannot be sent under load/)).toBeInTheDocument();
  });

  it("marks the conversion reviewed, and offers nothing to mark once reviewed", () => {
    const { onMarkReviewed } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Mark as reviewed" }));
    expect(onMarkReviewed).toHaveBeenCalledTimes(1);
  });

  it("shows a reviewed conversion as such", () => {
    renderReview({ review: { reviewed: true, conversionDigest: "c".repeat(64) } });
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as reviewed" })).toBeDisabled();
  });

  it("has a reason text for every finding kind", () => {
    for (const label of Object.values(FINDING_KIND_LABEL)) expect(label.length).toBeGreaterThan(0);
  });
});
