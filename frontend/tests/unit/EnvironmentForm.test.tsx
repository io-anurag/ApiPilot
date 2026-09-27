import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EnvironmentForm } from "../../src/components/EnvironmentForm";
import { EnvironmentPicker } from "../../src/components/performance/EnvironmentPicker";
import { environment, SECRET, stubFetch } from "./performanceFixtures";

/** The environments UI restored for AP-029 (tasks T047). */

afterEach(() => vi.unstubAllGlobals());

describe("EnvironmentForm", () => {
  it("creates an environment, pre-filling rows for the values a plan needs, with values in password inputs", async () => {
    const calls = stubFetch({ "POST /api/test-generation-workflow/environments": (call) => [200, { environment: { ...environment(), ...(call.body as object), id: "env-9" } }] });
    const onSaved = vi.fn();
    render(<EnvironmentForm suggestedNames={["baseUrl", "clientId", "clientSecret"]} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "perf-local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://127.0.0.1:4600" } });
    const secretInput = screen.getByLabelText("Value for clientSecret");
    expect(secretInput).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText("Value for baseUrl")).not.toBeInTheDocument();
    fireEvent.change(secretInput, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Add environment" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: { clientSecret: SECRET }, requestDelayMs: 0 });
  });

  it("shows a save error", async () => {
    stubFetch({ "POST /api/test-generation-workflow/environments": () => [409, { error: "duplicate_environment_name", message: "An environment named 'perf-local' already exists in this session." }] });
    render(<EnvironmentForm onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "perf-local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add environment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});

describe("EnvironmentPicker", () => {
  it("shows the tier as text and the base URL, and opens the form in a dialog", () => {
    render(<EnvironmentPicker environments={[environment({ tier: "staging" })]} selectedId="env-1" suggestedNames={[]} onSelect={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Tier: staging")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:4600")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit values in perf-local" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit perf-local");
  });

  it("asks for an environment when there is none", () => {
    render(<EnvironmentPicker environments={[]} selectedId={null} suggestedNames={[]} onSelect={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("No environment yet. Add one to hold the values a run needs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New environment" })).toBeInTheDocument();
  });
});
