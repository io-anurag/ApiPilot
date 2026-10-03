import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { UserScript, UserScriptRun } from "@apipilot/shared-domain";
import { EntryChooser } from "../../src/components/EntryChooser";
import { CONFIRM_CANNOT_RESTRICT, CONFIRM_NOT_VERIFIED, CONFIRM_RUN_TIME_HOSTS } from "../../src/components/userScript/ScriptConfirmDialog";
import { UserScriptPage } from "../../src/pages/UserScriptPage";
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

describe("Run k6 Script entry", () => {
  it("is offered on the start screen", () => {
    const onSelect = vi.fn();
    render(<EntryChooser onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Run k6 Script" }));
    expect(onSelect).toHaveBeenCalledWith("user-script");
  });
});

describe("UserScriptPage", () => {
  it("shows an empty state with upload, the credentials note and Back to start", async () => {
    stubFetch({ [`GET ${BASE}`]: () => [200, { scripts: [] }] });
    const onExit = vi.fn();
    render(<UserScriptPage onExit={onExit} />);
    expect(await screen.findByTestId("user-script-empty")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload a k6 script")).toBeInTheDocument();
    expect(screen.getByText(/Credentials belong in environment values/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exit Run k6 Script and return to the start screen" }));
    expect(onExit).toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole("button", { name: "Run setup" }));
    expect(await screen.findByText("The script has not been confirmed. Confirm its current content first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run on perf-local/ })).toBeDisabled();
    unmount();
    vi.unstubAllGlobals();

    stubFetch(routes(userScript({ confirmed: true, confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] } })));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run setup" }));
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
    const calls = stubFetch(routes(script, { [`POST ${BASE}/${script.id}/runs`]: () => [200, { run: liveRun() }] }));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run setup" }));
    const button = await screen.findByRole("button", { name: "Run on perf-local" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const live = await screen.findByTestId("user-script-live");
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/runs"))!.body).toEqual({ environmentId: "env-1", scriptSha256: SHA });
    expect(within(live).getByText("120")).toBeInTheDocument();
    expect(within(live).getByText("perf-local")).toBeInTheDocument();
  });
});
