import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewEnvironmentFromCollection } from "../../src/components/performance/collection/NewEnvironmentFromCollection";
import { stubFetch } from "./performanceFixtures";

/** AP-036 FR-017 (research R17; tasks T064). */

const ROUTE = "POST /api/collection-performance/environment";

afterEach(() => vi.unstubAllGlobals());

describe("NewEnvironmentFromCollection", () => {
  it("creates the environment under the name given, and hands back only its id", async () => {
    const calls = stubFetch({ [ROUTE]: () => [201, { environment: { id: "env-9", name: "perf-from-collection" } }] });
    const onCreated = vi.fn();
    render(<NewEnvironmentFromCollection collectionName="APIFoundry" onCreated={onCreated} />);
    const input = screen.getByLabelText("Environment name");
    expect(input).toHaveValue("perf from APIFoundry");
    fireEvent.change(input, { target: { value: "perf-from-collection" } });
    fireEvent.click(screen.getByRole("button", { name: "New environment from this collection" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("env-9"));
    expect(calls[0].body).toEqual({ name: "perf-from-collection" });
  });

  it.each([
    ["duplicate_environment_name", "An environment with this name already exists"],
    ["base_url_missing", "gives its base URL variable no value"],
    ["collection_deleted", "was deleted"],
  ])("explains a %s refusal and creates nothing", async (error, text) => {
    stubFetch({ [ROUTE]: () => [error === "base_url_missing" ? 422 : 409, { error, message: "m" }] });
    const onCreated = vi.fn();
    render(<NewEnvironmentFromCollection collectionName="APIFoundry" onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "New environment from this collection" }));
    expect(await screen.findByTestId("new-environment-from-collection-error")).toHaveTextContent(text);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("does not submit an empty name", () => {
    const calls = stubFetch({});
    render(<NewEnvironmentFromCollection collectionName="APIFoundry" onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Environment name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "New environment from this collection" })).toBeDisabled();
    expect(calls).toEqual([]);
  });
});
