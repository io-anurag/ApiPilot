import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StepRequestPreview } from "@apipilot/shared-domain";
import { CollectionCapturesPanel } from "../../src/components/performance/collection/CollectionCapturesPanel";
import { collectionPlanFixture } from "./performanceFixtures";

/** AP-036 FR-019 (research R20; tasks T058). */

function preview(stepId: string): StepRequestPreview {
  return {
    stepId,
    operationKey: "GET /api/v1/customers/{{customer_id}}",
    method: "GET",
    pathTemplate: "/api/v1/customers/{{customer_id}}",
    parameters: [{ location: "header", name: "If-Match", value: { kind: "environment", name: "etag", secret: false } }],
    auth: { kind: "collection-auth", schemeName: "noauth", location: null, references: [] },
    body: null,
    bodyStatus: "not-documented",
    bodyEdit: null,
    parameterEdit: null,
  };
}

function renderPanel(apply = vi.fn(async () => null), plan = collectionPlanFixture()) {
  render(<CollectionCapturesPanel plan={plan} busy={false} apply={apply} loadPreview={async (stepId) => ({ ok: true as const, request: preview(stepId) })} />);
  return apply;
}

describe("CollectionCapturesPanel", () => {
  it("lists a step's captures with the script line each came from", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "s-create" } });
    expect(screen.getByText("customer_id")).toBeInTheDocument();
    expect(screen.getByText(/request test script, line 2/)).toBeInTheDocument();
  });

  it("adds a capture by a typed path, saying a collection documents no response fields", async () => {
    const apply = renderPanel();
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "s-read" } });
    expect(await screen.findByText(/A collection documents no response fields/)).toHaveTextContent("Not documented in a specification");
    fireEvent.change(screen.getByLabelText("Capture name"), { target: { value: "etag" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "header" } });
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "ETag" } });
    fireEvent.click(screen.getByRole("button", { name: "Add capture" }));
    expect(apply).toHaveBeenCalledWith({ addedCaptures: { "s-read": [{ name: "etag", source: { kind: "header", name: "ETag" } }] } }, "Capture etag added.");
  });

  it("binds a step's environment reference to an earlier capture", async () => {
    const apply = renderPanel();
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "s-read" } });
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("etag"));
    fireEvent.click(screen.getByRole("button", { name: "Use captured value" }));
    expect(apply).toHaveBeenCalledWith({ addedBindings: { "s-read": [{ name: "etag", captureStepId: "s-token", captureName: "access_token" }] } }, expect.any(String));
  });

  it("removes a capture the engineer added, and shows typed paths as not documented", () => {
    const plan = collectionPlanFixture();
    const read = plan.journeys[0].steps[1];
    read.captures = [{ name: "version", source: { kind: "body", path: "meta.version", segments: [{ field: "meta" }, { field: "version" }] }, documented: false, origin: { kind: "user" } }];
    const apply = renderPanel(vi.fn(async () => null), plan);
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "s-read" } });
    expect(screen.getByText("Not documented in a specification")).toBeInTheDocument();
    expect(screen.getByText(/set by you/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove the capture version" }));
    expect(apply).toHaveBeenCalledWith({ addedCaptures: { "s-read": [] } }, "Capture version removed.");
  });
});
