import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TestGenerationWorkflowPage } from "../../src/pages/TestGenerationWorkflowPage";

/**
 * AP-056 US1: the guided workflow's upload accepts OpenAPI (YAML or JSON), HAR and API definition
 * files, shows the detected format, and turns a rejected upload into a specific message.
 */

const emptyApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

function workflowWithInput(input: Record<string, unknown>) {
  const ids = ["upload", "analysis", "apiReview", "deterministicGeneration", "aiEnhancement", "scenarioReview", "dependencyAnalysis", "workflowReview", "postmanGeneration", "execution"];
  const stages = Object.fromEntries(ids.map((id) => [id, { stageId: id, status: "not-yet-reached" }])) as Record<string, { stageId: string; status: string }>;
  stages.apiReview = { stageId: "apiReview", status: "active" };
  return {
    id: "wf-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeStageId: "apiReview",
    stages,
    specificationFilename: String(input.filename),
    input,
    apiModel: emptyApiModel,
  };
}

/** GET answers "no workflow"; the single POST answers with `post`. */
function stubFetch(post: { ok: boolean; status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return { ok: post.ok, status: post.status, json: () => Promise.resolve(post.body) };
      }
      return { ok: true, status: 204, json: () => Promise.resolve(null) };
    }),
  );
}

async function upload(name: string) {
  const input = await screen.findByLabelText("Upload OpenAPI specification");
  fireEvent.change(input, { target: { files: [new File(["content"], name)] } });
}

describe("workflow upload: accepted files and detected format", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts .yaml, .yml, .json and .har and says which formats are accepted", async () => {
    stubFetch({ ok: true, status: 200, body: {} });
    render(<TestGenerationWorkflowPage />);
    const input = await screen.findByLabelText("Upload OpenAPI specification");
    expect(input).toHaveAttribute("accept", ".yaml,.yml,.json,.har");
    const hint = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(hint).toHaveTextContent(/HAR capture/);
    expect(hint).toHaveTextContent(/API definition/);
    expect(screen.queryByText(/YAML · up to/)).not.toBeInTheDocument();
  });

  it("rejects an unsupported extension client-side, listing the supported ones", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 204, json: () => Promise.resolve(null) }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<TestGenerationWorkflowPage />);
    await upload("notes.txt");
    const alert = await screen.findByTestId("upload-error");
    expect(alert).toHaveTextContent(".yaml");
    expect(alert).toHaveTextContent(".json");
    expect(alert).toHaveTextContent(".har");
    expect(fetchSpy.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method !== "POST")).toBe(true);
  });

  it("shows the detected format after a successful upload", async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { workflow: workflowWithInput({ format: "openapi-json", label: "OpenAPI (JSON)", filename: "petstore.json" }) },
    });
    render(<TestGenerationWorkflowPage />);
    await upload("petstore.json");
    const badge = await screen.findByTestId("input-format-badge");
    expect(badge).toHaveTextContent("OpenAPI (JSON)");
    expect(badge).toHaveAttribute("data-format", "openapi-json");
  });

  it("shows no format badge for a workflow without a recorded input (older workflows)", async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { workflow: { ...workflowWithInput({ filename: "a.yaml" }), input: undefined } },
    });
    render(<TestGenerationWorkflowPage />);
    await upload("a.yaml");
    await screen.findByText("Active run");
    expect(screen.queryByTestId("input-format-badge")).not.toBeInTheDocument();
  });

  it("shows analysis progress as a status for a capture and a plain upload status otherwise", async () => {
    let release: (value: unknown) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "POST") {
          await new Promise((resolve) => {
            release = resolve;
          });
          return { ok: false, status: 400, json: () => Promise.resolve({ error: "invalid_har", message: "The capture contains no entries." }) };
        }
        return { ok: true, status: 204, json: () => Promise.resolve(null) };
      }),
    );
    render(<TestGenerationWorkflowPage />);
    await upload("capture.har");
    expect(await screen.findByRole("status")).toHaveTextContent("Analyzing capture…");
    release(undefined);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByTestId("upload-error")).toHaveTextContent("The capture contains no entries.");
  });
});

describe("workflow upload: rejected files", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the unrecognized-format message", async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: { error: "unrecognized_input_format", message: "The JSON file was not recognized. Supported inputs: OpenAPI 3.x." },
    });
    render(<TestGenerationWorkflowPage />);
    await upload("thing.json");
    expect(await screen.findByTestId("upload-error")).toHaveTextContent("The JSON file was not recognized.");
  });

  it("explains a Postman collection and offers to open Import & Run Collection", async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: {
        error: "postman_collection_detected",
        message: "This file is a Postman collection, which the guided workflow does not use. Nothing was imported.",
        redirectTo: "import-run-collection",
      },
    });
    const onOpenImportRun = vi.fn();
    render(<TestGenerationWorkflowPage onOpenImportRun={onOpenImportRun} />);
    await upload("collection.json");
    const alert = await screen.findByTestId("upload-error");
    expect(alert).toHaveTextContent("Postman collection");
    fireEvent.click(screen.getByRole("button", { name: "Open Import & Run Collection" }));
    expect(onOpenImportRun).toHaveBeenCalledTimes(1);
  });

  it("lists every problem of an invalid API definition with its location", async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: {
        error: "invalid_definition",
        message: "The API definition is not valid for version 1: 2 problems found. Nothing was imported.",
        problems: ["/version: must be 1 (the only supported version)", "/operations/0/path: is required"],
      },
    });
    render(<TestGenerationWorkflowPage />);
    await upload("api.json");
    const list = await screen.findByTestId("upload-problems");
    expect(list).toHaveTextContent("/version: must be 1");
    expect(list).toHaveTextContent("/operations/0/path: is required");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});
