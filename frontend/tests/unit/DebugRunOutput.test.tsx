import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DebugExtractorFailure, DebugSkipCause } from "@apipilot/shared-domain";
import { DebugRunOutput, extractorFailureText, skipText } from "../../src/components/requestChain/DebugRunOutput";
import { failedExtractionResult, masked, sentStep, text } from "./debugRunFixtures";

/** AP-039 (specs/039-chain-debug-run tasks T021, T026, T034; FR-003 to FR-007, FR-015a, FR-015b, FR-022). */

const never = () => Promise.resolve(null);

describe("DebugRunOutput: what was sent and received", () => {
  it("shows a sent step with its request, response, status and duration, grouped by chain", () => {
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={never} />);
    expect(screen.getByRole("region", { name: "Chain Customer lifecycle" })).toBeInTheDocument();
    const [first] = screen.getAllByTestId("debug-step");
    expect(within(first).getByText("issueToken")).toBeInTheDocument();
    expect(within(first).getByLabelText("HTTP method POST")).toBeInTheDocument();
    expect(within(first).getAllByText(/200 OK/).length).toBeGreaterThan(0);
    expect(within(first).getByText("12 ms")).toBeInTheDocument();
    expect(within(first).getByText(/http:\/\/127\.0\.0\.1:4600\/auth\/token/)).toBeInTheDocument();
    expect(within(first).getByText("Request headers")).toBeInTheDocument();
    expect(within(first).getByText("Response body")).toBeInTheDocument();
    expect(within(first).getAllByRole("columnheader", { name: "Header", hidden: true }).length).toBe(2);
  });

  it("shows a step with no response as the attempted request and a reason, never an empty response", () => {
    const result = failedExtractionResult({
      chains: [{ chainId: "c1", chainName: "Chain", steps: [sentStep({ stepId: "s1", stepName: "ping", response: null, noResponseReason: "refused", statusOutcome: { expected: ["200"], received: null, ok: false } })] }],
    });
    render(<DebugRunOutput result={result} onReveal={never} />);
    expect(screen.getByText(/The target refused the connection\./)).toBeInTheDocument();
    expect(screen.getByText("No response")).toBeInTheDocument();
    expect(screen.getByText(/Expected 200; received nothing\./)).toBeInTheDocument();
    expect(screen.queryByText("Response body")).not.toBeInTheDocument();
  });

  it("shows the setup steps, the data row used and the notes", () => {
    const result = failedExtractionResult({
      setup: [sentStep({ stepId: "s0", stepName: "login" })],
      dataRows: [{ dataSetName: "customers", rowNumber: 1 }],
      notes: ["Think time and request pauses were not waited out.", "The run was cut off after 120 seconds; the steps not yet sent are marked."],
    });
    render(<DebugRunOutput result={result} onReveal={never} />);
    expect(screen.getByRole("region", { name: "Once before load steps" })).toBeInTheDocument();
    expect(screen.getByText("Data used: row 1 of customers.")).toBeInTheDocument();
    expect(screen.getByText(/cut off after 120 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/Think time and request pauses were not waited out/)).toBeInTheDocument();
  });

  it("states a redirect that was not followed, and the redirects that were", () => {
    const base = sentStep({ stepId: "s1", stepName: "go" });
    const result = failedExtractionResult({
      chains: [{ chainId: "c1", chainName: "Chain", steps: [{ ...base, response: { ...base.response!, status: 302, statusText: "Found", redirects: [text("http://127.0.0.1:4600/hop")], redirectBlockedTo: "evil.example.test" } }] }],
    });
    render(<DebugRunOutput result={result} onReveal={never} />);
    expect(screen.getByText("http://127.0.0.1:4600/hop")).toBeInTheDocument();
    expect(screen.getByText(/A redirect to evil\.example\.test was not followed/)).toBeInTheDocument();
  });

  it("describes a binary body and notes a truncated one with its full size", () => {
    const base = sentStep({ stepId: "s1", stepName: "dl" });
    const binary = { ...base, response: { ...base.response!, body: { kind: "binary" as const, contentType: "image/png", sizeBytes: 2048 } } };
    const cut = sentStep({ stepId: "s2", stepName: "big", response: { ...base.response!, body: { kind: "text", contentType: "text/plain", text: text("abc"), sizeBytes: 3 * 1024 * 1024, truncated: true }, redirects: [] } });
    render(<DebugRunOutput result={failedExtractionResult({ chains: [{ chainId: "c1", chainName: "Chain", steps: [binary, cut] }] })} onReveal={never} />);
    expect(screen.getByText(/binary content \(image\/png, 2\.0 KiB\) is not shown/)).toBeInTheDocument();
    expect(screen.getByText("Shown in part: the full body is 3.0 MiB.")).toBeInTheDocument();
  });
});

describe("DebugRunOutput: outcomes and causes in words", () => {
  it("explains a failed extractor and a step that was not sent, naming the stopping step", () => {
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={never} />);
    expect(screen.getByText(/Field access_token was not found in the response body/)).toBeInTheDocument();
    const [, second] = screen.getAllByTestId("debug-step");
    expect(second).toHaveAttribute("data-status", "not-sent");
    expect(within(second).getByText("Not sent")).toBeInTheDocument();
    expect(within(second).getByText(/the chain stopped at "issueToken" because a value it should extract was not found/)).toBeInTheDocument();
    expect(screen.getByText("Stopped early")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("shows checks with what was compared, and an extracted value with its source", () => {
    const step = sentStep({
      stepId: "s1",
      stepName: "get",
      statusOutcome: { expected: ["200", "2XX"], received: 200, ok: true },
      extractors: [{ extractorId: "x1", name: "customer_id", source: { kind: "body", path: "id" }, outcome: { kind: "extracted", value: text("c-77") } }],
      checks: [
        { checkId: "k1", kind: "field-exists", passed: true, detail: "Field id is present." },
        { checkId: "k2", kind: "time-at-most", passed: false, detail: "The response took 412 ms; the limit is 200 ms." },
      ],
    });
    render(<DebugRunOutput result={failedExtractionResult({ outcome: "completed", chains: [{ chainId: "c1", chainName: "Chain", steps: [step] }] })} onReveal={never} />);
    expect(screen.getByText("Expected 200, 2XX; received 200.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("c-77")).toBeInTheDocument();
    expect(screen.getByText("body: id")).toBeInTheDocument();
    expect(screen.getByText("Field id is present.")).toBeInTheDocument();
    expect(screen.getByText("The response took 412 ms; the limit is 200 ms.")).toBeInTheDocument();
    // Passed and failed are words, not only colours.
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("As expected")).toBeInTheDocument();
  });

  it.each<[DebugExtractorFailure, RegExp]>([
    [{ code: "not-extracted-status" }, /Not attempted: the response status was not one of the expected statuses/],
    [{ code: "body-not-json", contentType: "text/html" }, /The response body is not JSON \(content type text\/html\)/],
    [{ code: "body-not-json", contentType: null }, /not JSON \(no content type\)/],
    [{ code: "path-not-found", path: "a.b" }, /Field a\.b was not found/],
    [{ code: "value-not-scalar", found: "object" }, /an object, not a single text, number or boolean/],
    [{ code: "value-not-scalar", found: "array" }, /an array, not a single/],
    [{ code: "value-not-scalar", found: "null" }, /is null, not a single/],
    [{ code: "value-not-scalar", found: "empty-text" }, /empty text/],
    [{ code: "header-missing", header: "Location" }, /no Location header/],
  ])("words the extractor failure %j", (reason, pattern) => {
    expect(extractorFailureText(reason)).toMatch(pattern);
  });

  it.each<[DebugSkipCause, RegExp]>([
    [{ kind: "stopped-by", stepId: "s1", stepName: "A", reason: "unexpected-status" }, /stopped at "A" because it returned an unexpected status/],
    [{ kind: "stopped-by", stepId: "s1", stepName: "A", reason: "setup-failed" }, /a Once before load step failed/],
    [{ kind: "missing-value", names: ["api_key", "tenant"] }, /no value for api_key, tenant\. Add it to the environment/],
    [{ kind: "missing-extracted", names: ["token"] }, /token was not extracted by an earlier step/],
    [{ kind: "host-not-allowed", host: "evil.example.test" }, /evil\.example\.test, which is not an allowed host/],
    [{ kind: "not-reached", reason: "run-cancelled" }, /run was cancelled/],
    [{ kind: "not-reached", reason: "run-time-cap" }, /time limit/],
  ])("words the skip cause %j", (cause, pattern) => {
    expect(skipText(cause)).toMatch(pattern);
  });
});

describe("DebugRunOutput: masked values and reveal", () => {
  it("shows masked values as markers with accessible labels, and a reveal control only where the server allows one", () => {
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={never} />);
    const markers = screen.getAllByTestId("masked-value");
    expect(markers).toHaveLength(3);
    expect(screen.getByText(/masked: Authorization header/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal Authorization header" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal field token" })).toBeInTheDocument();
    // A secret the engineer supplied has no control: its value was never sent.
    expect(screen.getByText(/masked: secret value client_secret/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reveal secret value client_secret/ })).not.toBeInTheDocument();
  });

  it("reveals one value at a time, from the server, and masks it again on Hide", async () => {
    const onReveal = vi.fn(async (valueId: string) => (valueId === "v1" ? "Bearer tok-1" : "tok-2"));
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal Authorization header" }));
    await waitFor(() => expect(screen.getByTestId("revealed-value")).toHaveTextContent("Bearer tok-1"));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledWith("v1");
    // The other revealable value is still masked.
    expect(screen.getByRole("button", { name: "Reveal field token" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide Authorization header" }));
    expect(screen.queryByTestId("revealed-value")).not.toBeInTheDocument();
    expect(screen.queryByText("Bearer tok-1")).not.toBeInTheDocument();
  });

  it("says so when a value is no longer available", async () => {
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={never} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal field token" }));
    expect(await screen.findByText(/No longer available\. Run the Debug run again\./)).toBeInTheDocument();
  });

  it("keeps a revealed value out of storage, the URL and the document title", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={async () => "tok-secret-1"} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal Authorization header" }));
    await screen.findByTestId("revealed-value");
    expect(local).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("tok-secret-1");
    expect(document.title).not.toContain("tok-secret-1");
    local.mockRestore();
  });

  it("uses a masked marker, not the label alone, so a screen reader hears that a value was hidden", () => {
    render(<DebugRunOutput result={failedExtractionResult()} onReveal={never} />);
    for (const marker of screen.getAllByTestId("masked-value")) expect(marker.textContent).toMatch(/masked:/);
    expect(masked("x", "y")).toMatchObject({ kind: "masked" });
  });
});
