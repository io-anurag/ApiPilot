import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EnvironmentForm } from "../../src/components/EnvironmentForm";
import { EnvironmentPicker } from "../../src/components/performance/EnvironmentPicker";
import { environment, SECRET, stubFetch } from "./performanceFixtures";

/** The environments UI restored for AP-029 (tasks T047). */

afterEach(() => vi.unstubAllGlobals());

describe("EnvironmentForm", () => {
  it("creates an environment, pre-filling rows for the values a plan needs, with visible values", async () => {
    const calls = stubFetch({
      "POST /api/test-generation-workflow/environments": (call) => [
        200,
        { environment: { ...environment(), ...(call.body as object), id: "env-9" } },
      ],
    });
    const onSaved = vi.fn();
    render(
      <EnvironmentForm
        suggestedNames={["baseUrl", "clientId", "clientSecret"]}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "perf-local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://127.0.0.1:4600" },
    });
    const secretInput = screen.getByLabelText("Value for clientSecret");
    expect(secretInput).toHaveAttribute("type", "text");
    expect(screen.queryByLabelText("Value for baseUrl")).not.toBeInTheDocument();
    expect(screen.getByText("· 0 of 2 filled")).toBeInTheDocument();
    fireEvent.change(secretInput, { target: { value: SECRET } });
    expect(screen.getByText("· 1 of 2 filled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save perf-local" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0].body).toEqual({
      name: "perf-local",
      tier: "local",
      baseUrl: "http://127.0.0.1:4600",
      variableValues: { clientSecret: SECRET },
      requestDelayMs: 0,
    });
  });

  it("names the save button after the entered name, and focuses a row it adds", () => {
    render(<EnvironmentForm onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add environment" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  QA_Run  " } });
    expect(screen.getByRole("button", { name: "Save QA_Run" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
    expect(screen.getByLabelText("Variable name 2")).toHaveFocus();
  });

  it("shows a save error", async () => {
    stubFetch({
      "POST /api/test-generation-workflow/environments": () => [
        409,
        {
          error: "duplicate_environment_name",
          message: "An environment named 'perf-local' already exists in this session.",
        },
      ],
    });
    render(<EnvironmentForm onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "perf-local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save perf-local" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});

describe("EnvironmentPicker", () => {
  it("shows the tier as text and the base URL, and opens the form in a dialog", () => {
    render(
      <EnvironmentPicker
        environments={[environment({ tier: "staging" })]}
        selectedId="env-1"
        suggestedNames={[]}
        onSelect={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("Tier: staging")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:4600")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit values in perf-local" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit perf-local");
    fireEvent.click(screen.getByRole("button", { name: "Close environment dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("titles the dialog with the name as it is typed", () => {
    render(
      <EnvironmentPicker
        environments={[environment()]}
        selectedId="env-1"
        suggestedNames={[]}
        onSelect={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New environment" }));
    const dialog = screen.getByRole("dialog", { name: "New environment" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "perf-qa" } });
    expect(dialog).toHaveAccessibleName("New environment: perf-qa");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit values in perf-local" }));
    expect(screen.getByRole("dialog", { name: "Edit perf-local" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "perf-renamed" } });
    expect(screen.getByRole("dialog", { name: "Edit perf-renamed" })).toBeInTheDocument();
  });

  it("asks for an environment when there is none", () => {
    render(
      <EnvironmentPicker
        environments={[]}
        selectedId={null}
        suggestedNames={[]}
        onSelect={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No environment yet. Add one to hold the values a run needs."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New environment" })).toBeInTheDocument();
  });
});
