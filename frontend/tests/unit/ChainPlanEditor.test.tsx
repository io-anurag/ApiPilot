import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChainPlan } from "@apipilot/shared-domain";
import { ChainPlanEditor } from "../../src/components/requestChain/ChainPlanEditor";
import { stubFetch, type Call } from "./performanceFixtures";
import { lifecyclePlan, PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T030; US1, FR-002 to FR-015, FR-027). */

const BASE = `/api/chain-plans/${PLAN_ID}`;

afterEach(() => vi.unstubAllGlobals());

function savedPlan(call: Call, revision: number): ChainPlan {
  const body = call.body as { plan: ChainPlan };
  const plan = body.plan;
  return {
    ...lifecyclePlan(),
    ...plan,
    id: PLAN_ID,
    revision,
    chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => ({ source: { kind: "added" as const }, seedDigest: null, changed: false, ...step })) })),
  } as ChainPlan;
}

function setup(plan: ChainPlan = lifecyclePlan(), save?: (call: Call) => [number, unknown]) {
  let revision = plan.revision;
  return stubFetch({
    [`GET ${BASE}`]: () => [200, viewOf(plan)],
    ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [] }],
    [`GET /api/chain-plans/${PLAN_ID}/runs`]: () => [200, { runs: [] }],
    ["GET /api/chain-plans/readiness"]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "t" } }],
    [`PUT ${BASE}`]:
      save ??
      ((call) => {
        revision += 1;
        return [200, { ...viewOf(savedPlan(call, revision)), movedCredentials: [] }];
      }),
  });
}

function puts(calls: Call[]): ChainPlan[] {
  return calls.filter((call) => call.method === "PUT").map((call) => (call.body as { plan: ChainPlan }).plan);
}

describe("ChainPlanEditor", () => {
  it("says what still blocks a run above the tabs, as the other performance screens do", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    const pending = await screen.findByTestId("performance-pending");
    expect(pending).toHaveTextContent("Before you can run");
    expect(within(pending).getByText(/No target environment yet/)).toBeInTheDocument();
    expect(within(pending).getByText("The k6 script has not been generated.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run setup (2 to do)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Runs & reports (0)" })).toBeInTheDocument();
    fireEvent.click(within(pending).getByRole("button", { name: "Choose a target environment" }));
    expect(screen.getByRole("button", { name: "Run setup (2 to do)" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the chain and its steps, the authoring notice, and the selected step's request", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    expect(await screen.findByTestId("chain-plan-name")).toHaveTextContent("Customer lifecycle");
    expect(screen.getByRole("heading", { name: "Performance plan" })).toBeInTheDocument();
    expect(screen.getByText(/Steps are authored by you and not verified by ApiPilot/)).toBeInTheDocument();
    const tree = screen.getByRole("navigation", { name: "Chains and steps" });
    expect(within(tree).getByText("Get a token")).toBeInTheDocument();
    expect(within(tree).getByText("Once before load")).toBeInTheDocument();
    expect(screen.getByLabelText("Step name")).toHaveValue("Get a token");
    expect(screen.getByRole("combobox", { name: "URL" })).toHaveValue("{{baseUrl}}/auth/token");
  });

  it("adds a step to a chain and saves the whole plan with a new id", async () => {
    const calls = setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add step" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const sent = puts(calls)[0];
    expect(sent.chains[0].steps.map((step) => step.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(sent.nextStepNumber).toBe(5);
    expect(screen.getByLabelText("Step name")).toHaveValue("New request");
  });

  it("splits a pasted URL's query into rows, and saves the field on blur", async () => {
    const calls = setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    const url = screen.getByRole("combobox", { name: "URL" });
    fireEvent.change(url, { target: { value: "{{baseUrl}}/api/v1/customers?page=1&size=20" } });
    expect(url).toHaveValue("{{baseUrl}}/api/v1/customers");
    fireEvent.blur(url);
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0].chains[0].steps[2].query).toEqual([
      { name: "page", value: "1" },
      { name: "size", value: "20" },
    ]);
  });

  it("lists a use before extraction, never refuses the move, and jumps to the step", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    const blockers = await screen.findByTestId("plan-blockers");
    expect(blockers).toHaveTextContent("Get the customer uses {{customer_id}} before any step extracts it.");
    fireEvent.click(screen.getByText("Create a customer"));
    fireEvent.click(within(blockers).getByRole("button", { name: "Go to step" }));
    expect(screen.getByLabelText("Step name")).toHaveValue("Get the customer");
    expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
  });

  it("refuses Host as a header in text, with the reason", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    fireEvent.change(screen.getByLabelText("Headers 1 name"), { target: { value: "Host" } });
    expect(screen.getByRole("alert")).toHaveTextContent("k6 sets Host for every request, so a step cannot set it.");
  });

  it("does not send a header row that was added and left empty", async () => {
    const calls = setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    fireEvent.click(screen.getByRole("button", { name: "+ Add header" }));
    const name = screen.getByLabelText("Step name");
    fireEvent.change(name, { target: { value: "Get one customer" } });
    fireEvent.blur(name);
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const sent = puts(calls)[0].chains.flatMap((chain) => chain.steps).find((step) => step.id === "s3")!;
    expect(sent.headers).toEqual([{ name: "Authorization", value: "Bearer {{token}}" }]);
  });

  it("says Not saved, not Saved, while the server refuses the plan, and blocks generation", async () => {
    setup(lifecyclePlan(), () => [422, { error: "invalid_step", message: "\"\" is not a valid header name.", stepId: "s3", field: "headers" }]);
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    const name = screen.getByLabelText("Step name");
    fireEvent.change(name, { target: { value: "Renamed" } });
    fireEvent.blur(name);
    expect(await screen.findByTestId("chain-plan-save-error")).toHaveTextContent("is not a valid header name.");
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("performance-pending")).getByRole("button", { name: "Generate the k6 script" })).toBeDisabled();
  });

  it("announces a moved credential and asks for an environment when one is needed", async () => {
    let attempt = 0;
    setup(lifecyclePlan(), (call) => {
      attempt += 1;
      if (attempt === 1) return [422, { error: "credential_needs_environment", message: "This step holds a credential typed as text.", stepId: "s3", location: { kind: "header", name: "Authorization" } }];
      return [200, { ...viewOf(savedPlan(call, 2)), movedCredentials: [{ stepId: "s3", location: { kind: "header", name: "Authorization" }, valueName: "authorization_s3", environmentName: "Local stub" }] }];
    });
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    const value = screen.getByRole("combobox", { name: "Headers 1 value" });
    fireEvent.change(value, { target: { value: "Bearer abc" } });
    fireEvent.blur(value);
    expect(await screen.findByTestId("chain-plan-save-error")).toHaveTextContent("Choose one under Run setup.");
    fireEvent.blur(value);
    await waitFor(() => expect(screen.getByTestId("chain-plan-announcement")).toHaveTextContent("The Authorization header value was moved into the secret value authorization_s3 of Local stub."));
  });

  it("reloads the plan when it was saved elsewhere", async () => {
    const current = viewOf(lifecyclePlan({ revision: 7, name: "Changed elsewhere" }));
    setup(lifecyclePlan(), () => [409, { error: "plan_revision_conflict", message: "m", current }]);
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add step" }));
    expect(await screen.findByTestId("chain-plan-name")).toHaveTextContent("Changed elsewhere");
    expect(screen.getByTestId("chain-plan-announcement")).toHaveTextContent("The plan was changed elsewhere and has been reloaded.");
  });

  it("adds a chain, renames it and deletes it after confirmation", async () => {
    const calls = setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add chain" }));
    fireEvent.change(screen.getByLabelText("Chain name"), { target: { value: "Reports" } });
    const prompt = screen.getByLabelText("Chain name").closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(prompt).getByRole("button", { name: "Add chain" }));
    expect(await screen.findByRole("heading", { name: /^Reports/ })).toBeInTheDocument();
    expect(screen.getByText(/Reports has no step that runs in the load/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete chain Reports" }));
    fireEvent.click(within(screen.getByTestId("confirm-dialog")).getByRole("button", { name: "Delete chain (0)" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /^Reports/ })).not.toBeInTheDocument());
    await waitFor(() => expect(puts(calls).length).toBeGreaterThanOrEqual(2));
    expect(puts(calls)[0].chains.map((chain) => [chain.id, chain.name])).toEqual([
      ["c1", "Customer lifecycle"],
      ["c2", "Reports"],
    ]);
  });

  it("keeps the step's actions in the editor header and out of the tree", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    const tree = screen.getByRole("navigation", { name: "Chains and steps" });
    expect(within(tree).queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
    const actions = screen.getByRole("group", { name: "Step actions" });
    expect(within(actions).getByRole("button", { name: "Move up" })).toBeEnabled();
    expect(within(actions).getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("collapses a chain, and re-opens it when a step in it is chosen from the plan check", async () => {
    const plan = lifecyclePlan();
    setup(plan);
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    const toggle = screen.getByRole("button", { name: /^Customer lifecycle/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "+ Add step" })).not.toBeInTheDocument();
    fireEvent.click(within(await screen.findByTestId("plan-blockers")).getByRole("button", { name: "Go to step" }));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the plan check by itself while a problem blocks the script, and lets the engineer close it", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Get the customer"));
    const panel = screen.getByRole("button", { name: /^Plan check/ });
    expect(panel).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveTextContent("Ready to generate");
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(panel).toHaveAttribute("aria-expanded", "true"));
    expect(panel).toHaveTextContent("1 problem blocks the script");
    fireEvent.click(panel);
    expect(panel).toHaveAttribute("aria-expanded", "false");
  });

  it("filters a long plan by method, name or URL", async () => {
    const plan = lifecyclePlan();
    const template = plan.chains[0].steps[2];
    plan.chains[0].steps.push(
      ...["s11", "s12", "s13"].map((stepId, index) => ({ ...template, id: stepId, name: `Extra ${index + 1}`, url: `{{baseUrl}}/extra/${index + 1}` })),
    );
    setup(plan);
    render(<ChainPlanEditor planId={PLAN_ID} />);
    const filter = await screen.findByRole("searchbox", { name: "Filter steps" });
    const tree = screen.getByRole("navigation", { name: "Chains and steps" });
    fireEvent.change(filter, { target: { value: "extra/2" } });
    expect(within(tree).getByText("Extra 2")).toBeInTheDocument();
    expect(within(tree).queryByText("Extra 1")).not.toBeInTheDocument();
    expect(within(tree).queryByText("Get a token")).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "nothing like this" } });
    expect(within(tree).getByText(/No step matches/)).toBeInTheDocument();
  });

  it("shows each step's source and its Changed mark as text (FR-033)", async () => {
    const plan = lifecyclePlan();
    plan.chains[0].steps[1] = { ...plan.chains[0].steps[1], source: { kind: "operation", operationKey: "POST /customers", label: "POST /customers", passwordFields: [] }, seedDigest: "d", changed: true };
    setup(plan);
    render(<ChainPlanEditor planId={PLAN_ID} />);
    fireEvent.click(await screen.findByText("Create a customer"));
    expect(screen.getByText("From operation POST /customers")).toBeInTheDocument();
    expect(screen.getAllByText("Changed").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByText("Get a token"));
    expect(screen.getByText("Added by you")).toBeInTheDocument();
  });

  it("offers the Debug run beside the run trigger on Run setup, never starts it by itself, and keeps both off Runs & reports", async () => {
    const calls = setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    await screen.findByTestId("chain-plan-name");
    fireEvent.click(screen.getByRole("button", { name: "Run setup (2 to do)" }));
    expect(screen.getByRole("heading", { name: "Debug run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not ready to run yet" })).toBeInTheDocument();
    // Without a target environment it says why it cannot start.
    expect(screen.getByRole("button", { name: /Start debug run/ })).toBeDisabled();
    expect(screen.getByTestId("debug-blocked")).toHaveTextContent("Choose the target environment.");
    fireEvent.click(screen.getByRole("button", { name: "Runs & reports (0)" }));
    expect(screen.queryByRole("button", { name: /Start debug run/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Run setup" })).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/debug-runs"))).toBe(false);
  });

  it("leads the Run setup tab with the launch card, which lists the chains and hosts, then the configuration rows", async () => {
    setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    await screen.findByTestId("chain-plan-name");
    fireEvent.click(screen.getByRole("button", { name: "Run setup (2 to do)" }));
    const card = within(screen.getByTestId("run-launch-card"));
    expect(card.getByRole("heading", { name: "Not ready to run yet" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: /Start run on/ })).toBeDisabled();
    expect(card.getByRole("button", { name: /Start debug run/ })).toBeDisabled();
    const facts = within(screen.getByTestId("run-launch-facts"));
    expect(facts.getByText("Smoke")).toBeInTheDocument();
    expect(facts.getByText("01:00")).toBeInTheDocument();
    expect(facts.getByText("1000 ms")).toBeInTheDocument();
    expect(facts.getByText("Not generated")).toBeInTheDocument();
    // The load profile chart sits with the load profile editor, in the Configuration card.
    const configuration = within(screen.getByRole("region", { name: "Configuration" }));
    expect(configuration.getByTestId("load-profile-chart")).toBeInTheDocument();
    // What the run sends is read in the launch card, not in a second card.
    expect(card.getByTestId("trigger-chains")).toHaveTextContent(/Customer lifecycles*3 steps/);
    expect(card.getByTestId("trigger-hosts")).toBeInTheDocument();
    // Optional rows show a summary until the engineer chooses Edit.
    expect(configuration.getByText("None set. The report shows measurements with no pass/fail verdict.")).toBeInTheDocument();
    const edit = configuration.getByRole("button", { name: "Edit Thresholds (optional)" });
    expect(edit).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(edit);
    expect(configuration.getByRole("button", { name: "Hide Thresholds (optional)" })).toHaveAttribute("aria-expanded", "true");
    expect(configuration.getByRole("button", { name: "+ Add threshold" })).toBeInTheDocument();
    // The launch card comes first in reading order.
    const heading = within(screen.getByTestId("run-launch-card")).getByRole("heading", { name: "Not ready to run yet" });
    expect(heading.compareDocumentPosition(document.getElementById("chain-environment-title") as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("saves each Run setup edit and goes back to Saved: think time, load profile and a threshold", async () => {
    const calls = setup();
    render(<ChainPlanEditor planId={PLAN_ID} />);
    await screen.findByTestId("chain-plan-name");
    fireEvent.click(screen.getByRole("button", { name: "Run setup (2 to do)" }));
    const setupRegion = within(screen.getByRole("region", { name: "Configuration" }));

    const think = setupRegion.getByLabelText("Default think time after each step (ms)");
    fireEvent.change(think, { target: { value: "2500" } });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    fireEvent.blur(think);
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0].thinkTimeMs).toBe(2500);
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    fireEvent.change(setupRegion.getByLabelText("Stage 1 target virtual users"), { target: { value: "10" } });
    fireEvent.click(setupRegion.getByRole("button", { name: "Save load profile" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)[1].loadProfile.stages[0].targetVirtualUsers).toBe(10);
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    fireEvent.click(setupRegion.getByRole("button", { name: "Edit Thresholds (optional)" }));
    fireEvent.change(setupRegion.getByLabelText("At most"), { target: { value: "800" } });
    fireEvent.click(setupRegion.getByRole("button", { name: "+ Add threshold" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(3));
    expect(puts(calls)[2].thresholds).toHaveLength(1);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("shows the seeding report panel only when seeding left something out; otherwise one line says nothing was", async () => {
    const source = { kind: "specification" as const, filename: "openapi.yaml" };
    setup(lifecyclePlan({ seedingReport: { source, seededAt: "t", items: [] } }));
    const first = render(<ChainPlanEditor planId={PLAN_ID} />);
    expect(await screen.findByTestId("seeding-report-empty")).toHaveTextContent("Seeding report: everything was carried over.");
    expect(screen.queryByRole("button", { name: /Seeding report/ })).not.toBeInTheDocument();
    first.unmount();

    const item = { kind: "left-out-request" as const, sourceLabel: "GET /health", detail: "Left out of the plan.", stepId: null };
    setup(lifecyclePlan({ seedingReport: { source, seededAt: "t", items: [item] } }));
    render(<ChainPlanEditor planId={PLAN_ID} />);
    expect(await screen.findByRole("button", { name: /Seeding report/ })).toBeInTheDocument();
    expect(screen.queryByTestId("seeding-report-empty")).not.toBeInTheDocument();
  });
});
