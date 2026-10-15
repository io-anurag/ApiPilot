import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { UserScript, UserScriptRun } from "@apipilot/shared-domain";
import { UserScriptPage } from "../../src/pages/UserScriptPage";
import { environment, stubFetch } from "./performanceFixtures";

/** specs/051-user-script-page-redesign FR-004 (Runs & reports as the Performance Run step) and AP-034 FR-019, FR-023, FR-035. */

const BASE = "/api/user-scripts";
const SHA = "ab".repeat(32);

function userScript(overrides: Partial<UserScript> = {}): UserScript {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Orders",
    sizeBytes: 2048,
    sha256: SHA,
    confirmed: true,
    lastRun: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    check: { accepted: true, hosts: ["https://api.example.test:443"], envNames: [{ name: "API_KEY", mappable: true }, { name: "BASE_URL", mappable: true }], hasDefaultFunction: true },
    confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] },
    settings: {
      mapping: [
        { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, foundInScript: true },
        { name: "BASE_URL", source: { kind: "base-url" }, foundInScript: true },
      ],
      removedNames: [],
      load: { kind: "script" },
      thresholds: [],
    },
    ...overrides,
  };
}

function finishedRun(overrides: Partial<UserScriptRun> = {}): UserScriptRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    source: "user-script",
    status: "completed",
    environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: { scriptId: userScript().id, scriptName: "Orders", scriptSha256: SHA, load: { kind: "script" }, mapping: [], thresholds: [], hostsFound: ["https://api.example.test:443"] },
    k6Version: "1.2.0",
    k6ExitCode: 0,
    exitMeaning: "completed",
    plannedDurationMs: null,
    startedAt: "2026-10-01T10:00:00.000Z",
    cancelRequested: false,
    result: { requestGroups: [] } as never,
    ...overrides,
  } as UserScriptRun;
}

function routes(script: UserScript, runs: UserScriptRun[] = [], extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  const detail = Object.fromEntries(runs.map((run) => [`GET ${BASE}/runs/${run.id}`, () => [200, { run }] as [number, unknown]]));
  return {
    [`GET ${BASE}`]: () => [200, { scripts: [script] }] as [number, unknown],
    [`GET ${BASE}/${script.id}`]: () => [200, { script }] as [number, unknown],
    [`GET ${BASE}/${script.id}/content`]: () => [200, "export default function () {}\n"] as [number, unknown],
    [`GET ${BASE}/${script.id}/values`]: () => [200, { values: [{ name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, present: false }, { name: "BASE_URL", source: { kind: "base-url" }, present: true }], baseUrl: "http://127.0.0.1:4600" }] as [number, unknown],
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    ...detail,
    ...extra,
  };
}

async function openRuns() {
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
  return screen.findByTestId("user-script-trigger");
}

afterEach(() => vi.unstubAllGlobals());

describe("Runs & reports, laid out as Performance's Run step", () => {
  it("leads with the launch card: facts strip, the values the script receives, hosts, and what ApiPilot cannot tell", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    const card = await openRuns();
    const facts = within(card).getByTestId("user-script-facts-strip");
    for (const label of ["Target", "Base URL", "Load", "Script", "Hosts found"]) expect(within(facts).getByText(label)).toBeInTheDocument();
    expect(within(facts).getByText("Tier: local")).toBeInTheDocument();
    expect(within(facts).getByText("http://127.0.0.1:4600")).toBeInTheDocument();
    expect(within(facts).getByText(`${SHA.slice(0, 8)}…`)).toBeInTheDocument();

    const values = within(card).getByTestId("trigger-values");
    expect(within(values).getByText("API_KEY")).toBeInTheDocument();
    expect(await within(values).findByText("Missing")).toBeInTheDocument();
    expect(within(values).getByText("Present")).toBeInTheDocument();
    expect(within(card).getByTestId("trigger-hosts")).toHaveTextContent("https://api.example.test:443");
    expect(within(card).getByTestId("user-script-writes-note")).toHaveTextContent("ApiPilot cannot tell which requests the script sends or whether they change data.");
    // Order: the launch card comes before the run list.
    expect(card.compareDocumentPosition(screen.getByText("Runs of this script")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with no run yet: no finished run, a way to the setup, and an empty list that says how to start", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    await openRuns();
    expect(screen.getByText("No finished run yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Run setup" })).toBeInTheDocument();
    expect(screen.queryByText("This run used")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-script-runs-empty")).toHaveTextContent("No runs yet.");
  });

  it("after a run: the last run in the launch card, the Last run card with Run again, what it used, and the list", async () => {
    const run = finishedRun();
    stubFetch(routes(userScript(), [run]));
    render(<UserScriptPage />);
    const card = await openRuns();
    expect(await within(card).findByTestId("run-launch-last-run")).toHaveTextContent("Last run: 2026-10-01 10:00:00 UTC · Completed · View runs & reports");

    const lastRun = screen.getByRole("region", { name: "Last run" });
    expect(within(lastRun).getByText("2026-10-01 10:00:00 UTC")).toBeInTheDocument();
    expect(within(lastRun).getByText("Completed")).toBeInTheDocument();
    await waitFor(() => expect(within(lastRun).getByRole("button", { name: "Run again on perf-local" })).toBeEnabled());
    expect(within(lastRun).queryByTestId("run-again-blocked")).not.toBeInTheDocument();

    const used = screen.getByRole("region", { name: "This run used" });
    expect(within(used).getByText(/Orders/)).toBeInTheDocument();
    expect(within(used).getByText("The script's own load settings")).toBeInTheDocument();
    expect(within(used).getByText("https://api.example.test:443")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Runs of this script" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Started", "Environment", "Status", "Script SHA-256", "Report"]);
    expect(within(table).getByText("2026-10-01 10:00:00 UTC")).toBeInTheDocument();
    expect(within(table).getByText(`${SHA.slice(0, 12)}…`)).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "View report" })).toBeInTheDocument();
  });

  it("starts Run again on the last run's environment, with the SHA-256 the run showed, and only on the click", async () => {
    const run = finishedRun();
    const started = finishedRun({ id: "33333333-3333-4333-8333-333333333333", status: "in-progress", result: undefined });
    const calls = stubFetch(routes(userScript(), [run], { [`POST ${BASE}/${userScript().id}/runs`]: () => [200, { run: started }] }));
    render(<UserScriptPage />);
    await openRuns();
    const again = await screen.findByRole("button", { name: "Run again on perf-local" });
    await waitFor(() => expect(again).toBeEnabled());
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/runs"))).toBe(false);
    fireEvent.click(again);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/runs"))).toBe(true));
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/runs"))!.body).toEqual({ environmentId: "env-1", scriptSha256: SHA });
  });

  it("offers no Run again, and says why in words, when the script changed since the run", async () => {
    stubFetch(routes(userScript(), [finishedRun({ snapshot: { ...finishedRun().snapshot, scriptSha256: "cd".repeat(32) } })]));
    render(<UserScriptPage />);
    await openRuns();
    const again = await screen.findByRole("button", { name: "Run again on perf-local" });
    expect(again).toBeDisabled();
    expect(screen.getByTestId("run-again-blocked")).toHaveTextContent("The script changed since this run.");
  });

  it("says when the run's environment no longer exists", async () => {
    stubFetch(routes(userScript(), [finishedRun({ environment: { id: "gone", name: "retired", tier: "local", baseUrl: "http://x" } })]));
    render(<UserScriptPage />);
    await openRuns();
    expect(await screen.findByRole("button", { name: "Run again on retired" })).toBeDisabled();
    expect(screen.getByTestId("run-again-blocked")).toHaveTextContent("This run's environment no longer exists.");
  });

  it("goes to Run setup from the Last run card", async () => {
    stubFetch(routes(userScript(), [finishedRun()]));
    render(<UserScriptPage />);
    await openRuns();
    fireEvent.click(await screen.findByRole("button", { name: "Go to Run setup" }));
    expect(await screen.findByTestId("user-script-configuration")).toBeInTheDocument();
  });
});
