import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useQuickTest } from "../../src/hooks/useQuickTest";
import { SourceStep } from "../../src/components/performance/path/SourceStep";
import type { SourceKind } from "../../src/components/performance/path/pathState";
import { quickTestView, stubFetch, type Call } from "./performanceFixtures";

const QUICK = "/api/quick-performance";
const NONE = [404, { error: "quick_test_not_found", message: "none" }] as [number, unknown];

function file(name = "petstore.yaml"): File {
  return new File(["openapi: 3.0.3"], name, { type: "application/yaml" });
}

function uploads(calls: Call[]): Call[] {
  return calls.filter((call) => call.method === "POST" && call.url.split("?")[0] === QUICK);
}

function Harness({ initialSource = "specification", locked = false, planSourceLabel, onUploaded = () => undefined }: Readonly<{ initialSource?: SourceKind; locked?: boolean; planSourceLabel?: string; onUploaded?: (filename: string) => void }>) {
  const quickTest = useQuickTest();
  const [source, setSource] = useState<SourceKind>(initialSource);
  const [replacing, setReplacing] = useState(false);
  return (
    <SourceStep
      source={source}
      locked={locked}
      planSourceLabel={planSourceLabel}
      onSourceChange={setSource}
      quickTest={quickTest}
      replacing={replacing}
      onReplacingChange={setReplacing}
      onSpecificationUploaded={(view) => onUploaded(view.specification.filename)}
    />
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("SourceStep (US1: FR-023, FR-025)", () => {
  it("shows the upload with no specification and analyses a chosen file", async () => {
    const onUploaded = vi.fn();
    const calls = stubFetch({ [`GET ${QUICK}`]: () => NONE, [`POST ${QUICK}`]: () => [200, { quickTest: quickTestView() }] });
    render(<Harness onUploaded={onUploaded} />);
    fireEvent.change(await screen.findByLabelText("Upload OpenAPI specification"), { target: { files: [file()] } });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("quick-performance.yaml"));
    expect(uploads(calls)).toHaveLength(1);
    expect(uploads(calls)[0].url).not.toContain("replaceExisting");
    const uploaded = await screen.findByTestId("uploaded-specification");
    expect(uploaded).toHaveTextContent("Quick Performance Fixture");
    expect(uploaded).toHaveTextContent("13 operations analyzed");
  });

  it("offers the specification uploaded earlier for reuse, with its file name and operation count", async () => {
    stubFetch({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }] });
    render(<Harness />);
    const uploaded = await screen.findByTestId("uploaded-specification");
    expect(uploaded).toHaveTextContent("quick-performance.yaml");
    expect(uploaded).toHaveTextContent("13 operations analyzed");
    expect(screen.queryByLabelText("Upload OpenAPI specification")).not.toBeInTheDocument();
  });

  it("shows the server's upload error and keeps the previous specification out of the way", async () => {
    stubFetch({ [`GET ${QUICK}`]: () => NONE, [`POST ${QUICK}`]: () => [400, { error: "unsupported_version", message: "Only OpenAPI 3.x is supported." }] });
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText("Upload OpenAPI specification"), { target: { files: [file()] } });
    expect(await screen.findByText("Only OpenAPI 3.x is supported.")).toBeInTheDocument();
    expect(screen.queryByTestId("uploaded-specification")).not.toBeInTheDocument();
  });

  it("describes the other sources instead of an upload", async () => {
    stubFetch({ [`GET ${QUICK}`]: () => NONE });
    render(<Harness initialSource="workflow" />);
    expect(await screen.findByText(/seeded as they are, one chain each/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload OpenAPI specification")).not.toBeInTheDocument();
  });

  it("is read-only once a plan exists and names what it was seeded from", async () => {
    stubFetch({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }] });
    render(<Harness locked planSourceLabel="old-spec.yaml" />);
    expect(await screen.findByText(/This plan was seeded from old-spec.yaml/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guided workflow/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload a different specification" })).not.toBeInTheDocument();
    expect(screen.getByTestId("spec-source-changed")).toHaveTextContent("The uploaded specification is now quick-performance.yaml");
  });
});

describe("SourceStep replace flow (US6: FR-024)", () => {
  it("asks first, states what is kept, and sends nothing on Cancel", async () => {
    const calls = stubFetch({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Upload a different specification" }));
    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), { target: { files: [file("other.yaml")] } });
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("Plans already created from it are kept, and so are runs and reports.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    expect(uploads(calls)).toHaveLength(0);
    expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument();
  });

  it("replaces after confirmation and tells the page so it can reset the selection", async () => {
    const onUploaded = vi.fn();
    const calls = stubFetch({
      [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      [`POST ${QUICK}`]: () => [200, { quickTest: { specification: { ...quickTestView().specification, filename: "other.yaml" } } }],
    });
    render(<Harness onUploaded={onUploaded} />);
    fireEvent.click(await screen.findByRole("button", { name: "Upload a different specification" }));
    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), { target: { files: [file("other.yaml")] } });
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Replace/ }));
    await waitFor(() => expect(uploads(calls)).toHaveLength(1));
    expect(uploads(calls)[0].url).toContain("replaceExisting=true");
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("other.yaml"));
    expect(await screen.findByTestId("uploaded-specification")).toHaveTextContent("other.yaml");
  });

  it("keeps the current specification when the engineer backs out of the upload", async () => {
    stubFetch({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Upload a different specification" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep quick-performance.yaml" }));
    expect(await screen.findByTestId("uploaded-specification")).toBeInTheDocument();
  });
});
