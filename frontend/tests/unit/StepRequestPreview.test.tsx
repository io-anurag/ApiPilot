import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { StepRequestPreview as Preview } from "@apipilot/shared-domain";
import { StepRequestPreview } from "../../src/components/performance/StepRequestPreview";
import { SECRET } from "./performanceFixtures";

/** AP-032 FR-008, US1 AS7 (specs/032-quick-performance-test tasks T022). */

const PREVIEW: Preview = {
  stepId: "s-1",
  operationKey: "POST /orders/{orderId}",
  method: "POST",
  pathTemplate: "/orders/{orderId}",
  parameters: [
    { location: "path", name: "orderId", value: { kind: "environment", name: "orderId", secret: false } },
    { location: "query", name: "state", value: { kind: "generated", text: "open" } },
    { location: "header", name: "X-Trace", value: { kind: "template", text: "t-{{traceId}}", references: [{ kind: "environment", name: "traceId", secret: false }] } },
    { location: "header", name: "X-Api-Key", value: { kind: "environment", name: "apiKey", secret: true } },
    { location: "query", name: "ref", value: { kind: "workflow-variable", name: "wf.ref", variable: "ref", producerStepId: "s-0" } },
  ],
  auth: { kind: "chained-login", schemeName: "LoginAuth", location: "header", references: [{ kind: "credential", name: "token", schemeName: "LoginAuth" }] },
  body: {
    contentType: "json",
    text: '{"customerEmail":"{{apipilot_unique_0}}"}',
    references: [{ kind: "unique-per-iteration", name: "apipilot_unique_0", format: "email" }],
  },
};

describe("StepRequestPreview", () => {
  it("loads the request on first open only, and shows where every value comes from", async () => {
    const load = vi.fn(async () => ({ ok: true as const, request: PREVIEW }));
    render(<StepRequestPreview stepId="s-1" operationKey="POST /orders/{orderId}" stepLabel={(id) => (id === "s-0" ? "POST /refs" : id)} loadPreview={load} />);
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Request"));
    const table = await screen.findByRole("table", { name: "Request parameters for POST /orders/{orderId}" });
    expect(load).toHaveBeenCalledTimes(1);
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("orderId");
    expect(rows[1]).toHaveTextContent("from environment: orderId");
    expect(rows[2]).toHaveTextContent("open");
    expect(rows[3]).toHaveTextContent("t-{{traceId}}");
    expect(rows[4]).toHaveTextContent("from environment: apiKey");
    expect(rows[4]).toHaveTextContent("secret");
    expect(rows[5]).toHaveTextContent("from step POST /refs");
    expect(screen.getByText(/token acquired by the plan/)).toBeInTheDocument();
    expect(screen.getByText(/unique per virtual user and iteration/)).toBeInTheDocument();
    expect(screen.getByTestId("code-block")).toHaveTextContent('{"customerEmail":"{{apipilot_unique_0}}"}');

    fireEvent.click(screen.getByText("Request"));
    fireEvent.click(screen.getByText("Request"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows an error when the preview cannot be loaded", async () => {
    const load = vi.fn(async () => ({ ok: false as const, error: "step_not_found", message: "Not in this plan." }));
    render(<StepRequestPreview stepId="s-1" operationKey="GET /x" stepLabel={(id) => id} loadPreview={load} />);
    fireEvent.click(screen.getByText("Request"));
    expect(await screen.findByText("Not in this plan.")).toBeInTheDocument();
  });

  it("never renders a value for an environment entry", async () => {
    const load = vi.fn(async () => ({ ok: true as const, request: PREVIEW }));
    const { container } = render(<StepRequestPreview stepId="s-1" operationKey="POST /orders/{orderId}" stepLabel={(id) => id} loadPreview={load} />);
    fireEvent.click(screen.getByText("Request"));
    await screen.findByRole("table", { name: "Request parameters for POST /orders/{orderId}" });
    expect(container.textContent).not.toContain(SECRET);
  });
});
