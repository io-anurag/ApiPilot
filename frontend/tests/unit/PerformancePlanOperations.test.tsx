import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChainPlan } from "@apipilot/shared-domain";
import { PerformancePage } from "../../src/pages/PerformancePage";
import { quickTestView, stubFetch, type Call } from "./performanceFixtures";
import { baseRoutes, PLAN, QUICK, seededPlan, withChangedStep } from "./performancePathFixtures";
import { PLAN_ID, viewOf } from "./requestChainFixtures";

/**
 * AP-047 (specs/047-unified-performance-tab US3, FR-015 to FR-018): Change operations, the edited-removal
 * question and Reset to seed, on the Plan step; and the same change from the Operations step.
 */

const OPEN = { planId: PLAN_ID, nonce: 1 };
const RESELECT = `POST ${PLAN}/reselect`;

/** The plan after the third operation of the fixture specification is added. */
function plusDelete(plan: ChainPlan): ChainPlan {
  const key = "DELETE /customers/{id}";
  return {
    ...plan,
    revision: plan.revision + 1,
    chains: [...plan.chains, { id: "c3", name: key, steps: [{ ...plan.chains[0].steps[0], id: "s3", name: "deleteCustomer", method: "DELETE", url: "{{baseUrl}}/customers/{{id}}", source: { kind: "operation", operationKey: key, label: key, passwordFields: [] }, seedDigest: "d3" }] }],
    nextChainNumber: 4,
    nextStepNumber: 4,
  };
}

function setup(plan: ChainPlan, extra: Parameters<typeof stubFetch>[0] = {}, quick: [number, unknown] = [200, { quickTest: quickTestView() }]) {
  return stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => quick, "GET /api/chain-plans": () => [200, { plans: [] }], [`GET ${PLAN}`]: () => [200, viewOf(plan)], ...extra }));
}

async function openPlan() {
  render(<PerformancePage openRequest={OPEN} />);
  await screen.findByLabelText("Plan name");
}

const current = () => screen.getAllByRole("listitem").find((item) => item.getAttribute("aria-current") === "step");
const reselectCalls = (calls: Call[]) => calls.filter((call) => call.method === "POST" && call.url.endsWith("/reselect"));

afterEach(() => vi.unstubAllGlobals());

describe("Change operations on the Plan step", () => {
  it("opens with the operations the plan was seeded from selected, and changes nothing on Cancel", async () => {
    const calls = setup(seededPlan());
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Change operations…" }));
    const panel = await screen.findByTestId("change-operations-panel");
    expect(within(panel).getByText("2 of 3 selected")).toBeInTheDocument();
    expect(within(panel).getByRole("checkbox", { name: "GET /customers" })).toBeChecked();
    expect(within(panel).getByRole("checkbox", { name: "DELETE /customers/{id}" })).not.toBeChecked();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("change-operations-panel")).not.toBeInTheDocument());
    expect(reselectCalls(calls)).toHaveLength(0);
  });

  it("takes focus when it opens, keeps it inside, closes on Escape and gives focus back to the button", async () => {
    setup(seededPlan());
    await openPlan();
    const opener = screen.getByRole("button", { name: "Change operations…" });
    opener.focus();
    fireEvent.click(opener);
    const panel = await screen.findByTestId("change-operations-panel");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAccessibleName("Change operations");
    expect(within(panel).getByRole("heading", { name: "Change operations" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("change-operations-panel")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("merges the new selection in specification order, closes, and says what it did", async () => {
    const plan = seededPlan();
    const calls = setup(plan, { [RESELECT]: () => [200, { ...viewOf(plusDelete(plan)), added: ["DELETE /customers/{id}"], removed: [], keptEdited: [] }] });
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Change operations…" }));
    const panel = await screen.findByTestId("change-operations-panel");
    fireEvent.click(within(panel).getByRole("checkbox", { name: "DELETE /customers/{id}" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Apply to plan" }));
    await waitFor(() => expect(screen.queryByTestId("change-operations-panel")).not.toBeInTheDocument());
    expect(reselectCalls(calls)[0].body).toEqual({ revision: 1, mode: "merge", selectedOperationKeys: ["GET /customers", "POST /customers", "DELETE /customers/{id}"] });
    expect(await screen.findByTestId("reselect-notice")).toHaveTextContent("Plan updated: 1 operation added, 0 operations removed. Your edits to the other steps were kept.");
    expect(within(screen.getByRole("navigation", { name: "Chains and steps" })).getByText("deleteCustomer")).toBeInTheDocument();
  });

  it("cannot apply with nothing chosen, and says why", async () => {
    setup(seededPlan());
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Change operations…" }));
    const panel = await screen.findByTestId("change-operations-panel");
    fireEvent.click(within(panel).getByRole("checkbox", { name: /Select all/ }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: /Select all/ }));
    expect(within(panel).getByRole("button", { name: "Apply to plan" })).toBeDisabled();
    expect(within(panel).getByText("Choose at least one operation.")).toBeInTheDocument();
  });

  it("names the edited steps a merge would remove, changes nothing on Cancel, and removes them once confirmed", async () => {
    const plan = withChangedStep(seededPlan(), "POST /customers");
    const edited = [{ chainId: "c2", stepId: "s2", stepName: "createCustomer", operationKey: "POST /customers", reasons: ["step-changed"] }];
    let confirmed = false;
    const calls = setup(plan, {
      [RESELECT]: (call) => {
        if ((call.body as { confirmRemoveEdited?: boolean }).confirmRemoveEdited) {
          confirmed = true;
          return [200, { ...viewOf({ ...plan, revision: 2, chains: [plan.chains[0]] }), added: [], removed: ["POST /customers"], keptEdited: [] }];
        }
        return [409, { error: "edited_steps_would_be_removed", message: "m", edited }];
      },
    });
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Change operations…" }));
    const panel = await screen.findByTestId("change-operations-panel");
    fireEvent.click(within(panel).getByRole("checkbox", { name: "POST /customers" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Apply to plan" }));

    const dialog = await screen.findByTestId("edited-removal-dialog");
    expect(dialog).toHaveTextContent("Remove a step you edited?");
    expect(within(dialog).getByRole("list", { name: "Edited steps that would be removed" })).toHaveTextContent("createCustomer");
    expect(within(dialog).getByRole("list", { name: "Edited steps that would be removed" })).toHaveTextContent("POST /customers");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("edited-removal-dialog")).not.toBeInTheDocument());
    // The plan and the selection are exactly as they were, and the panel is still open to change its mind.
    expect(reselectCalls(calls)).toHaveLength(1);
    expect(confirmed).toBe(false);
    expect(within(screen.getByTestId("change-operations-panel")).getByRole("checkbox", { name: "POST /customers" })).not.toBeChecked();
    expect(within(screen.getByRole("navigation", { name: "Chains and steps" })).getByText("createCustomer")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("change-operations-panel")).getByRole("button", { name: "Apply to plan" }));
    fireEvent.click(within(await screen.findByTestId("edited-removal-dialog")).getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(confirmed).toBe(true));
    expect(reselectCalls(calls)[2].body).toMatchObject({ confirmRemoveEdited: true, selectedOperationKeys: ["GET /customers"] });
    await waitFor(() => expect(screen.queryByTestId("change-operations-panel")).not.toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Chains and steps" })).queryByText("createCustomer")).not.toBeInTheDocument());
  });

  it("reloads the plan and says so when it was changed elsewhere", async () => {
    const plan = seededPlan();
    const current = viewOf({ ...plan, revision: 7, name: "Changed elsewhere" });
    setup(plan, { [RESELECT]: () => [409, { error: "plan_revision_conflict", message: "m", current }] });
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Change operations…" }));
    const panel = await screen.findByTestId("change-operations-panel");
    fireEvent.click(within(panel).getByRole("checkbox", { name: "DELETE /customers/{id}" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Apply to plan" }));
    expect(await within(panel).findByTestId("change-operations-error")).toHaveTextContent("The plan was changed elsewhere and has been reloaded. Make your change again.");
    await waitFor(() => expect(screen.getByTestId("path-title")).toHaveTextContent("Changed elsewhere"));
  });
});

describe("when Change operations is not available", () => {
  it("is disabled, with the reason in text, when the uploaded specification is not the one the plan was seeded from", async () => {
    setup(seededPlan({ seedingReport: { source: { kind: "specification", filename: "old-spec.yaml" }, seededAt: "t", items: [] } }));
    await openPlan();
    expect(screen.getByRole("button", { name: "Change operations…" })).toBeDisabled();
    expect(screen.getByTestId("change-operations-unavailable")).toHaveTextContent("This plan was seeded from old-spec.yaml; the uploaded specification is now quick-performance.yaml.");
    expect(screen.queryByRole("button", { name: "Reset to seed…" })).not.toBeInTheDocument();
  });

  it("is disabled, with the reason, when no specification is uploaded", async () => {
    setup(seededPlan(), {}, [404, { error: "quick_test_not_found", message: "none" }]);
    await openPlan();
    await waitFor(() => expect(screen.getByTestId("change-operations-unavailable")).toHaveTextContent("is no longer uploaded"));
    expect(screen.getByRole("button", { name: "Change operations…" })).toBeDisabled();
  });

  it("is not offered for a plan seeded from a collection or built empty, which show their source read-only", async () => {
    setup(seededPlan({ seedingReport: { source: { kind: "collection", collectionId: "c", collectionName: "Shop" }, seededAt: "t", items: [] } }));
    await openPlan();
    expect(screen.queryByRole("button", { name: "Change operations…" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("change-operations-unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("Seeded from the collection Shop")).toBeInTheDocument();
  });
});

describe("Edited by you and Reset to seed (FR-017, FR-018)", () => {
  it("shows no edit indication and no Reset for a plan that matches its seed", async () => {
    setup(seededPlan());
    await openPlan();
    expect(screen.queryByText("Edited by you")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset to seed…" })).not.toBeInTheDocument();
  });

  it("marks an edited plan in text and offers Reset, which says what is lost and kept and changes nothing on Cancel", async () => {
    const calls = setup(withChangedStep(seededPlan(), "GET /customers"));
    await openPlan();
    expect(screen.getByText("Edited by you")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset to seed…" }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("You lose your edits to steps, their order and any chains you added");
    expect(dialog).toHaveTextContent("The plan's name, data sets, load profile, run-wide thresholds, environment and saved runs are kept.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    expect(reselectCalls(calls)).toHaveLength(0);
  });

  it("resets the chains from the operations the plan was seeded with, and the indication clears", async () => {
    const edited = withChangedStep(seededPlan(), "GET /customers");
    const calls = setup(edited, { [RESELECT]: () => [200, { ...viewOf({ ...seededPlan(), revision: 2 }), added: [], removed: [], keptEdited: [] }] });
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Reset to seed…" }));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Reset steps/ }));
    await waitFor(() => expect(reselectCalls(calls)).toHaveLength(1));
    expect(reselectCalls(calls)[0].body).toEqual({ revision: 1, mode: "reset", selectedOperationKeys: ["GET /customers", "POST /customers"] });
    expect(await screen.findByTestId("reselect-notice")).toHaveTextContent("The steps were reset to the seed.");
    await waitFor(() => expect(screen.queryByText("Edited by you")).not.toBeInTheDocument());
  });
});

describe("changing the operations from the Operations step", () => {
  it("applies a changed selection with Next, then carries on to the Plan step", async () => {
    const plan = seededPlan();
    const calls = setup(plan, { [RESELECT]: () => [200, { ...viewOf(plusDelete(plan)), added: ["DELETE /customers/{id}"], removed: [], keptEdited: [] }] });
    await openPlan();
    fireEvent.click(screen.getByTestId("performance-step-operations"));
    const selection = await screen.findByTestId("operation-selection");
    expect(within(selection).getByText("2 of 3 selected")).toBeInTheDocument();
    fireEvent.click(within(selection).getByRole("checkbox", { name: "DELETE /customers/{id}" }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    await screen.findByLabelText("Plan name");
    expect(current()).toHaveTextContent("Plan");
    expect(reselectCalls(calls)).toHaveLength(1);
    expect(reselectCalls(calls)[0].body).toMatchObject({ mode: "merge", selectedOperationKeys: ["GET /customers", "POST /customers", "DELETE /customers/{id}"] });
    expect(within(screen.getByRole("navigation", { name: "Chains and steps" })).getByText("deleteCustomer")).toBeInTheDocument();
  });

  it("moves on without calling the server when the selection did not change", async () => {
    const calls = setup(seededPlan());
    await openPlan();
    fireEvent.click(screen.getByTestId("performance-step-operations"));
    await screen.findByTestId("operation-selection");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    await screen.findByLabelText("Plan name");
    expect(reselectCalls(calls)).toHaveLength(0);
  });

  it("asks before removing an edited step, and stays on Operations when the engineer cancels", async () => {
    const plan = withChangedStep(seededPlan(), "POST /customers");
    const edited = [{ chainId: "c2", stepId: "s2", stepName: "createCustomer", operationKey: "POST /customers", reasons: ["step-changed"] }];
    const calls = setup(plan, { [RESELECT]: () => [409, { error: "edited_steps_would_be_removed", message: "m", edited }] });
    await openPlan();
    fireEvent.click(screen.getByTestId("performance-step-operations"));
    fireEvent.click(within(await screen.findByTestId("operation-selection")).getByRole("checkbox", { name: "POST /customers" }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    const dialog = await screen.findByTestId("edited-removal-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("edited-removal-dialog")).not.toBeInTheDocument());
    expect(current()).toHaveTextContent("Operations");
    expect(screen.getByTestId("operation-selection")).toBeInTheDocument();
    expect(reselectCalls(calls)).toHaveLength(1);
  });
});
