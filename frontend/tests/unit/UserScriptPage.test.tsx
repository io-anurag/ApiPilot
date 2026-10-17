import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { UserScript, UserScriptRun } from "@apipilot/shared-domain";
import { CONFIRM_CANNOT_RESTRICT, CONFIRM_NOT_VERIFIED, CONFIRM_RUN_TIME_HOSTS } from "../../src/components/userScript/ScriptConfirmDialog";
import { UserScriptPage } from "../../src/pages/UserScriptPage";
import { liveSnapshot } from "./liveRunFixtures";
import { environment, stubFetch } from "./performanceFixtures";

/** AP-034 US1 (FR-001, FR-003, FR-004, FR-012 to FR-014, FR-019, FR-023; tasks T027). */

const BASE = "/api/user-scripts";
const SHA = "ab".repeat(32);

function userScript(overrides: Partial<UserScript> = {}): UserScript {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Orders",
    sizeBytes: 2048,
    sha256: SHA,
    confirmed: false,
    lastRun: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    check: { accepted: true, hosts: ["https://api.example.test:443"], envNames: [{ name: "API_KEY", mappable: true }, { name: "BASE_URL", mappable: true }], hasDefaultFunction: true },
    confirmation: null,
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

function liveRun(): UserScriptRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    source: "user-script",
    status: "in-progress",
    environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: { scriptId: userScript().id, scriptName: "Orders", scriptSha256: SHA, load: { kind: "script" }, mapping: [], thresholds: [], hostsFound: ["https://api.example.test:443"] },
    k6Version: "1.2.0",
    k6ExitCode: null,
    exitMeaning: null,
    plannedDurationMs: null,
    startedAt: "2026-10-01T10:00:00.000Z",
    cancelRequested: false,
    progress: { elapsedMs: 4_000, currentVirtualUsers: 3, requestsSoFar: 120, failuresSoFar: 2 },
  };
}

function routes(script: UserScript, extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  return {
    [`GET ${BASE}`]: () => [200, { scripts: [script] }] as [number, unknown],
    [`GET ${BASE}/${script.id}`]: () => [200, { script }] as [number, unknown],
    [`GET ${BASE}/${script.id}/content`]: () => [200, 'import http from "k6/http";\nexport default function () {}\n'] as [number, unknown],
    [`GET ${BASE}/${script.id}/values`]: () => [200, { values: [{ name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, present: false }, { name: "BASE_URL", source: { kind: "base-url" }, present: true }], baseUrl: "http://127.0.0.1:4600" }] as [number, unknown],
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    ...extra,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("UserScriptPage", () => {
  it("shows an empty state with upload and the credentials note, and no exit control (AP-054)", async () => {
    stubFetch({ [`GET ${BASE}`]: () => [200, { scripts: [] }] });
    render(<UserScriptPage />);
    expect(await screen.findByTestId("user-script-empty")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload a k6 script")).toBeInTheDocument();
    expect(screen.getByText(/Credentials belong in environment values/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to start|Exit Run k6 Script/ })).not.toBeInTheDocument();
  });

  it("shows the path on the empty screen as a stepper, with the first step current and the others locked in words (AP-054 FR-016)", async () => {
    stubFetch({ [`GET ${BASE}`]: () => [200, { scripts: [] }] });
    render(<UserScriptPage />);
    const trail = await screen.findByRole("navigation", { name: "Run k6 Script progress" });
    expect(within(trail).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("k6 Script"),
      expect.stringContaining("Check"),
      expect.stringContaining("Confirm"),
      expect.stringContaining("Run"),
    ]);
    expect(within(trail).getByRole("button", { name: /k6 Script/ }).closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(trail).getByRole("button", { name: /Check/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(trail).getByText("Allowed modules only, once a script is added")).toBeInTheDocument();
  });

  it("checks a file dropped on the drop zone as it checks one chosen from the picker", async () => {
    const upload = vi.fn(() => [422, { error: "script_refused", message: "refused", problems: [{ rule: "import-remote", line: 1, column: 1, message: "Imports a module from a URL." }] }] as [number, unknown]);
    stubFetch({ [`GET ${BASE}`]: () => [200, { scripts: [] }], [`POST ${BASE}/upload`]: upload });
    render(<UserScriptPage />);
    const zone = (await screen.findByLabelText("Upload a k6 script")).closest("label") as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-active", "true");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "orders.js")] } });
    expect(await screen.findByTestId("script-problems")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(zone).not.toHaveAttribute("data-active");
  });

  it("lists every reason of a refused upload by line, and stores nothing", async () => {
    stubFetch({
      [`GET ${BASE}`]: () => [200, { scripts: [] }],
      [`POST ${BASE}/upload`]: () => [422, { error: "script_refused", message: "refused", problems: [{ rule: "import-remote", line: 1, column: 23, message: "Imports a module from a URL." }, { rule: "forbidden-identifier", line: 4, column: 9, message: "Uses `open`." }] }],
    });
    render(<UserScriptPage />);
    fireEvent.change(await screen.findByLabelText("Upload a k6 script"), { target: { files: [new File(["x"], "orders.js")] } });
    const problems = await screen.findByTestId("script-problems");
    expect(within(problems).getByText("Line 1, column 23:")).toBeInTheDocument();
    expect(within(problems).getByText("Line 4, column 9:")).toBeInTheDocument();
    expect(screen.getByText("The script was refused, so nothing was stored.")).toBeInTheDocument();
  });

  it("lists a script with size, SHA-256 and its confirmation state in text", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    const table = await screen.findByRole("table", { name: "Scripts in this session" });
    expect(within(table).getByText("Orders")).toBeInTheDocument();
    expect(within(table).getByText("2.0 KiB")).toBeInTheDocument();
    expect(within(table).getByText(`${SHA.slice(0, 12)}…`)).toBeInTheDocument();
    expect(within(table).getByText("Needs confirmation")).toBeInTheDocument();
  });

  it("marks the open script in the list, in words as well as by its look", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    const table = await screen.findByRole("table", { name: "Scripts in this session" });
    expect(within(table).queryByText("Open")).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Orders" }));
    await screen.findByTestId("user-script-workspace");
    expect(within(table).getByText("Open")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Orders/ })).toHaveAttribute("aria-current", "true");
  });

  it("offers the views as a navigation with a hint each, and marks the open one", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    const nav = await screen.findByRole("navigation", { name: "Script views" });
    const script = within(nav).getByRole("button", { name: "Script" });
    const setup = within(nav).getByRole("button", { name: "Run setup" });
    const runs = within(nav).getByRole("button", { name: "Runs & reports" });
    expect(script).toHaveAttribute("aria-current", "page");
    expect(setup).not.toHaveAttribute("aria-current");
    expect(runs).toHaveAccessibleDescription("No runs yet");
    fireEvent.click(setup);
    expect(setup).toHaveAttribute("aria-current", "page");
    expect(script).not.toHaveAttribute("aria-current");
  });

  it("says in words which views are done: checked and confirmed, then a target chosen", async () => {
    stubFetch(routes(userScript()));
    const { unmount } = render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    const nav = await screen.findByRole("navigation", { name: "Script views" });
    expect(within(nav).getByRole("button", { name: "Script" })).toHaveAccessibleDescription("Needs confirmation");
    expect(within(nav).getByRole("button", { name: "Run setup" })).toHaveAccessibleDescription("Target, values, load and thresholds");
    unmount();
    vi.unstubAllGlobals();

    stubFetch(routes(userScript({ confirmed: true, confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] } })));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    const done = await screen.findByRole("navigation", { name: "Script views" });
    expect(within(done).getByRole("button", { name: "Script" })).toHaveAccessibleDescription("Checked and confirmed");
    await waitFor(() => expect(within(done).getByRole("button", { name: "Run setup" })).toHaveAccessibleDescription("Target chosen"));
  });

  it("shows what the check found and the load, values and last run in the header facts", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    const facts = await screen.findByTestId("user-script-facts");
    expect(within(facts).getByText("Accepted")).toBeInTheDocument();
    expect(within(facts).getByText("Script's own")).toBeInTheDocument();
    expect(within(facts).getByText("2 mapped")).toBeInTheDocument();
    expect(within(facts).getByText("None")).toBeInTheDocument();
    expect(screen.getByText("https://api.example.test:443")).toBeInTheDocument();
  });

  it("puts the launch card on Runs & reports, not on Run setup, with a way back to the setup", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run setup" }));
    await screen.findByRole("heading", { name: "Target environment" });
    expect(screen.queryByTestId("user-script-trigger")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Runs & reports" }));
    const card = await screen.findByTestId("user-script-trigger");
    expect(card.compareDocumentPosition(screen.getByText("Runs of this script")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Run setup" }));
    expect(await screen.findByRole("heading", { name: "Target environment" })).toBeInTheDocument();
    expect(screen.queryByTestId("user-script-trigger")).not.toBeInTheDocument();
  });

  it("says the launch card is not ready, with the reason, until the script is confirmed, and ready afterwards", async () => {
    stubFetch(routes(userScript()));
    const { unmount } = render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
    const blocked = await screen.findByTestId("user-script-trigger");
    expect(within(blocked).getByRole("heading", { name: "Not ready to run yet" })).toBeInTheDocument();
    expect(within(blocked).getByTestId("user-script-trigger-blocked")).toHaveTextContent("The script has not been confirmed.");
    unmount();
    vi.unstubAllGlobals();

    stubFetch(routes(userScript({ confirmed: true, confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] } })));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
    const ready = await screen.findByTestId("user-script-trigger");
    expect(await within(ready).findByRole("heading", { name: "Ready to run" })).toBeInTheDocument();
    expect(within(ready).queryByTestId("user-script-trigger-blocked")).not.toBeInTheDocument();
    expect(within(ready).getByText("Nothing runs until you press this button.")).toBeInTheDocument();
  });

  it("states FR-014's points and the SHA-256 when confirming, and confirms exactly that SHA-256", async () => {
    const script = userScript();
    const calls = stubFetch(routes(script, { [`POST ${BASE}/${script.id}/confirmation`]: () => [200, { script: userScript({ confirmed: true, confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: script.check.accepted ? script.check.hosts : [] } }) }] }));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review and confirm" }));
    const dialog = await screen.findByTestId("script-confirm-dialog");
    for (const text of [CONFIRM_NOT_VERIFIED, CONFIRM_CANNOT_RESTRICT, CONFIRM_RUN_TIME_HOSTS, "https://api.example.test:443", SHA]) expect(within(dialog).getByText(text, { exact: false })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm this script" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/confirmation"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/confirmation"))!.body).toEqual({ sha256: SHA });
  });

  it("keeps the trigger unavailable until the script is confirmed, then names the target and hosts", async () => {
    stubFetch(routes(userScript()));
    const { unmount } = render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
    expect(await screen.findByText("The script has not been confirmed. Confirm its current content first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run on perf-local/ })).toBeDisabled();
    unmount();
    vi.unstubAllGlobals();

    stubFetch(routes(userScript({ confirmed: true, confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] } })));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
    const trigger = await screen.findByTestId("user-script-trigger");
    await waitFor(() => expect(within(trigger).getByRole("button", { name: "Run on perf-local" })).toBeEnabled());
    expect(within(trigger).getByText("Tier: local")).toBeInTheDocument();
    expect(within(trigger).getByText("http://127.0.0.1:4600")).toBeInTheDocument();
    expect(within(trigger).getByText("https://api.example.test:443")).toBeInTheDocument();
    expect(within(trigger).getByText(/Hosts built while the script runs cannot be listed/)).toBeInTheDocument();
    expect(within(trigger).getByText("Load is generated from the machine running the ApiPilot backend.")).toBeInTheDocument();
  });

  it("starts a run with the shown SHA-256 and shows live progress", async () => {
    const script = userScript({ confirmed: true, confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] } });
    const calls = stubFetch(routes(script, {
      [`POST ${BASE}/${script.id}/runs`]: () => [200, { run: liveRun() }],
      [`GET ${BASE}/runs/${liveRun().id}/live`]: () => [200, liveSnapshot({ kind: "user-script", runId: liveRun().id, chains: [] })],
    }));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
    const button = await screen.findByRole("button", { name: "Run on perf-local" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const live = await screen.findByTestId("user-script-live");
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/runs"))!.body).toEqual({ environmentId: "env-1", scriptSha256: SHA });
    expect(await within(live).findByText("120")).toBeInTheDocument();
    expect(within(live).getByText(/perf-local · Orders · started/)).toBeInTheDocument();
    // The target stays on screen through the run, in the launch card (AP-034 FR-023), which turns into Cancel run.
    const card = screen.getByTestId("user-script-trigger");
    expect(within(card).getByText("perf-local")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Run in progress" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
    expect(within(card).getByText(/Running · \d+ s · \d+ requests · \d+ failures/)).toBeInTheDocument();
  });
});
