import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { StepRequestPreview as Preview } from "@apipilot/shared-domain";
import { StepRequestPreview } from "../../src/components/performance/StepRequestPreview";
import { leftOutReasonText } from "../../src/components/performance/performanceViewModel";
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
  bodyStatus: "sent",
  bodyEdit: { kind: "json", text: '{\n  "customerEmail": "user@example.com"\n}', edited: false, mismatches: [], replacements: [] },
  parameterEdit: null,
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

  describe("says what body the step sends (AP-033 FR-001, tasks T012)", () => {
    async function open(request: Preview) {
      const load = vi.fn(async () => ({ ok: true as const, request }));
      render(<StepRequestPreview stepId="s-1" operationKey={request.operationKey} stepLabel={(id) => id} loadPreview={load} />);
      fireEvent.click(screen.getByText("Request"));
      await screen.findByText(request.pathTemplate);
    }

    it("states that a request has no body", async () => {
      await open({ ...PREVIEW, parameters: [], body: null, bodyStatus: "not-documented", bodyEdit: null });
      expect(screen.getByText("This request has no body.")).toBeInTheDocument();
      expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    });

    it("states that the operation accepts a body this step does not send", async () => {
      await open({ ...PREVIEW, parameters: [], body: null, bodyStatus: "documented-not-sent", bodyEdit: { kind: "json", text: "", edited: false, mismatches: [], replacements: [] } });
      expect(screen.getByText("This operation accepts a body that this step does not send.")).toBeInTheDocument();
    });

    it("states that a form or multipart body cannot be edited", async () => {
      await open({ ...PREVIEW, parameters: [], body: null, bodyStatus: "unsupported-content-type", bodyEdit: null });
      expect(screen.getByText("Form and multipart bodies are shown but cannot be edited.")).toBeInTheDocument();
    });

    it("still shows a sent body with its reference notes", async () => {
      await open(PREVIEW);
      expect(screen.getByTestId("code-block")).toHaveTextContent('{"customerEmail":"{{apipilot_unique_0}}"}');
      expect(screen.queryByText("This request has no body.")).not.toBeInTheDocument();
    });
  });

  it("never renders a value for an environment entry", async () => {
    const load = vi.fn(async () => ({ ok: true as const, request: PREVIEW }));
    const { container } = render(<StepRequestPreview stepId="s-1" operationKey="POST /orders/{orderId}" stepLabel={(id) => id} loadPreview={load} />);
    fireEvent.click(screen.getByText("Request"));
    await screen.findByRole("table", { name: "Request parameters for POST /orders/{orderId}" });
    expect(container.textContent).not.toContain(SECRET);
  });
});

/** AP-036 FR-013 (research R9; tasks T052). */
describe("StepRequestPreview of a collection step", () => {
  it("shows a Postman dynamic variable as generated at run time, with its $name, and offers no body editor", async () => {
    const preview: Preview = {
      stepId: "s-create",
      operationKey: "POST /api/v1/customers",
      method: "POST",
      pathTemplate: "/api/v1/customers",
      parameters: [],
      auth: { kind: "collection-auth", schemeName: "noauth", location: null, references: [] },
      body: {
        contentType: "json",
        text: '{"name":"{{apipilot_dyn_0}}","email":"{{apipilot_dyn_1}}"}',
        references: [
          { kind: "generated-value", name: "apipilot_dyn_0", variable: "$randomFullName" },
          { kind: "generated-value", name: "apipilot_dyn_1", variable: "$randomEmail" },
        ],
      },
      bodyStatus: "sent",
      bodyEdit: null,
      parameterEdit: null,
    };
    render(<StepRequestPreview stepId="s-create" operationKey="POST /api/v1/customers" stepLabel={(id) => id} loadPreview={async () => ({ ok: true as const, request: preview })} autoLoad />);
    expect(await screen.findByText("generated at run time ($randomFullName)")).toBeInTheDocument();
    expect(screen.getByText("generated at run time ($randomEmail)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit body/ })).not.toBeInTheDocument();
  });

  it("explains a request left out for a variable ApiPilot cannot generate", () => {
    expect(leftOutReasonText({ reason: "unsupported-dynamic-variable", detail: "$randomColor" })).toBe("Uses {{$randomColor}}, which ApiPilot cannot generate.");
    expect(leftOutReasonText({ reason: "unknown-dynamic-variable", detail: "$notReal" })).toBe("Uses {{$notReal}}, which ApiPilot cannot generate.");
  });
});
