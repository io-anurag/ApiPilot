import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Environment } from "@apipilot/shared-domain";
import { EnvironmentForm } from "../../src/components/EnvironmentForm";

function stubFetch(response: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(response) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EnvironmentForm", () => {
  it("creates a new environment and reports it via onSaved", async () => {
    const created: Environment = {
      id: "env-1",
      name: "Local",
      tier: "local",
      baseUrl: "http://localhost:4000",
      variableValues: {},
      requestDelayMs: 0,
    };
    stubFetch({ environment: created });
    const onSaved = vi.fn();

    render(<EnvironmentForm onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:4000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add environment" }));

    await screen.findByRole("button", { name: "Add environment" });
    expect(onSaved).toHaveBeenCalledWith(created);
  });

  it("pre-fills fields from an existing environment when editing", () => {
    const existing: Environment = {
      id: "env-2",
      name: "Staging",
      tier: "staging",
      baseUrl: "https://staging.example.com",
      variableValues: { apiKey: "secret" },
      requestDelayMs: 250,
    };
    render(<EnvironmentForm initial={existing} onSaved={vi.fn()} />);

    expect(screen.getByLabelText("Name")).toHaveValue("Staging");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://staging.example.com");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("disables submission until a name and base URL are present", () => {
    render(<EnvironmentForm onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add environment" })).toBeDisabled();
  });
});
