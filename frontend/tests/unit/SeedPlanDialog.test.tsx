import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SeedPlanDialog } from "../../src/components/requestChain/SeedPlanDialog";
import { SeedingReportView } from "../../src/components/requestChain/SeedingReportView";
import { stubFetch } from "./performanceFixtures";
import { chainPlanFixture, PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T052; FR-020, FR-025, FR-027, FR-033). */

afterEach(() => vi.unstubAllGlobals());

const ENVIRONMENT = { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {}, requestDelayMs: 0 };

describe("SeedPlanDialog", () => {
  it("explains the seed, offers an environment for credentials, and seeds with the name and environment chosen", async () => {
    const calls = stubFetch({
      ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [ENVIRONMENT] }],
      ["POST /api/chain-plans/seed"]: () => [201, { ...viewOf(chainPlanFixture()), movedCredentials: [] }],
    });
    const onSeeded = vi.fn();
    render(<SeedPlanDialog source={{ kind: "specification" }} defaultName="Weak API" onSeeded={onSeeded} onCancel={() => undefined} />);
    expect(screen.getByText(/never re-derived from its source/)).toBeInTheDocument();
    expect(screen.getByLabelText("Plan name")).toHaveValue("Weak API");
    await screen.findByRole("option", { name: "Local stub (local)" });
    expect(screen.getByRole("option", { name: "None: literal credentials are not kept" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Environment for credentials (optional)"), { target: { value: "e1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onSeeded).toHaveBeenCalledWith(PLAN_ID));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Weak API", source: { kind: "specification" }, environmentId: "e1" });
  });

  it("shows why seeding failed", async () => {
    stubFetch({
      ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [] }],
      ["POST /api/chain-plans/seed"]: () => [404, { error: "quick_test_not_found", message: "Upload a specification in Quick performance test first." }],
    });
    render(<SeedPlanDialog source={{ kind: "specification" }} defaultName="x" onSeeded={() => undefined} onCancel={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(await screen.findByTestId("seed-plan-error")).toHaveTextContent("Upload a specification in Quick performance test first.");
  });
});

describe("SeedingReportView", () => {
  it("groups what was not carried over by kind, with its source, and goes to the step", () => {
    const onGoToStep = vi.fn();
    render(
      <SeedingReportView
        report={{
          source: { kind: "collection", collectionId: "c", collectionName: "APIFoundry" },
          seededAt: "t",
          items: [
            { kind: "pre-request-script", sourceLabel: "Customers / Create", detail: "The pre-request script was not carried over.", stepId: "s2" },
            { kind: "literal-credential-dropped", sourceLabel: "Auth / Token", detail: "Set client_secret_s1 as a secret value.", stepId: null },
          ],
        }}
        onGoToStep={onGoToStep}
      />,
    );
    expect(screen.getByText("Pre-request scripts not carried over (1)")).toBeInTheDocument();
    expect(screen.getByText("Literal credentials not kept (1)")).toBeInTheDocument();
    expect(screen.getByText("Customers / Create")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to step" }));
    expect(onGoToStep).toHaveBeenCalledWith("s2");
    expect(screen.getByText(/never blocks the script/)).toBeInTheDocument();
  });
});
