import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { UserScript, UserScriptDebugResult } from "@apipilot/shared-domain";
import { UserScriptDebugView } from "../../src/components/userScript/UserScriptDebugOutput";
import type { UserScriptDebugRun } from "../../src/components/userScript/useUserScriptDebugRun";
import { UserScriptPage } from "../../src/pages/UserScriptPage";
import { environment, stubFetch } from "./performanceFixtures";

/** AP-053 specs/053-user-script-debug-run (FR-001, FR-005, FR-008; User Stories 1 to 3). */

const BASE = "/api/user-scripts";
const SHA = "ab".repeat(32);
const RUN_ID = "55555555-5555-4555-8555-555555555555";
const DEBUG_URL = (scriptId: string) => `${BASE}/${scriptId}/debug-runs`;

function userScript(overrides: Partial<UserScript> = {}): UserScript {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Orders",
    sizeBytes: 2048,
    sha256: SHA,
    confirmed: true,
    lastRun: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    check: { accepted: true, hosts: ["https://api.example.test:443"], envNames: [{ name: "API_KEY", mappable: true }], hasDefaultFunction: true },
    confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] },
    settings: { mapping: [{ name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, foundInScript: true }], removedNames: [], load: { kind: "script" }, thresholds: [] },
    ...overrides,
  };
}

function debugResult(overrides: Partial<UserScriptDebugResult> = {}): UserScriptDebugResult {
  return {
    debugRunId: RUN_ID,
    scriptId: userScript().id,
    scriptName: "Orders",
    scriptSha256: SHA,
    environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    startedAt: "2026-10-15T12:00:00.000Z",
    durationMs: 1234,
    outcome: "completed",
    k6ExitCode: 0,
    notes: ["The script ran once, with one virtual user and one iteration, whatever load it or its setup defines. The load profile and the thresholds set in ApiPilot did not apply."],
    exchanges: [
      {
        index: 1,
        name: [{ kind: "text", text: "GET /orders" }],
        request: {
          method: "GET",
          url: [{ kind: "text", text: "127.0.0.1:4600/orders?page=1" }],
          headers: [
            { name: "X-Api-Key", value: [{ kind: "masked", valueId: "v1", revealable: false, label: "secret value API_KEY" }] },
            { name: "Authorization", value: [{ kind: "masked", valueId: "v2", revealable: true, label: "Authorization header" }] },
          ],
          body: { kind: "none" },
        },
        response: { status: 500, statusText: "Internal Server Error", headers: [{ name: "Content-Type", value: [{ kind: "text", text: "application/json" }] }], body: { kind: "text", contentType: "application/json", text: [{ kind: "text", text: '{"error":"boom"}' }], sizeBytes: 16, truncated: false }, redirects: [] },
      },
      {
        index: 2,
        name: null,
        request: { method: "POST", url: [{ kind: "text", text: "127.0.0.1:4600/orders" }], headers: [], body: { kind: "text", contentType: "application/json", text: [{ kind: "text", text: '{"a":1}' }], sizeBytes: 7, truncated: false } },
        response: { status: 201, statusText: "Created", headers: [], body: { kind: "binary", contentType: "application/json (gzip-compressed)", sizeBytes: 35 }, redirects: [] },
      },
      { index: 3, name: null, request: { method: "GET", url: [{ kind: "text", text: "127.0.0.1:4600/drop" }], headers: [], body: { kind: "none" } }, response: null },
    ],
    ...overrides,
  };
}

function routes(script: UserScript, extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  return {
    [`GET ${BASE}`]: () => [200, { scripts: [script] }] as [number, unknown],
    [`GET ${BASE}/${script.id}`]: () => [200, { script }] as [number, unknown],
    [`GET ${BASE}/${script.id}/content`]: () => [200, "export default function () {}\n"] as [number, unknown],
    [`GET ${BASE}/${script.id}/values`]: () => [200, { values: [], baseUrl: "http://127.0.0.1:4600" }] as [number, unknown],
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    ...extra,
  };
}

async function openRuns() {
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  fireEvent.click(await screen.findByRole("button", { name: "Runs & reports" }));
  return screen.findByTestId("user-script-trigger");
}

afterEach(() => vi.unstubAllGlobals());

describe("the launch card's debug run", () => {
  it("offers Start debug run beside Run, with what it sends, what it masks and that nothing is stored", async () => {
    stubFetch(routes(userScript()));
    render(<UserScriptPage />);
    const card = await openRuns();
    const debugButton = within(card).getByRole("button", { name: "Start debug run on perf-local" });
    await waitFor(() => expect(debugButton).toBeEnabled());
    expect(within(card).getByRole("button", { name: "Run on perf-local" })).toBeEnabled();
    expect(within(card).getByText(/Runs the script once, with one virtual user and one iteration/)).toBeInTheDocument();
    expect(within(card).getByText(/It sends real requests, including writes, to the target/)).toBeInTheDocument();
    expect(within(card).getByText(/Nothing is stored: the output is gone when you close it or reload the page/)).toBeInTheDocument();
    expect(within(card).getByText(/console output is never shown/)).toBeInTheDocument();
    expect(within(card).getByText(/load profile and the thresholds set in ApiPilot do not apply/)).toBeInTheDocument();
  });

  it("is unavailable, with no request sent, while the script is unconfirmed", async () => {
    const calls = stubFetch(routes(userScript({ confirmed: false, confirmation: null })));
    render(<UserScriptPage />);
    const card = await openRuns();
    expect(within(card).getByRole("button", { name: "Start debug run on perf-local" })).toBeDisabled();
    expect(within(card).getByTestId("user-script-trigger-blocked")).toHaveTextContent("The script has not been confirmed.");
    expect(calls.some((call) => call.url.endsWith("/debug-runs"))).toBe(false);
  });

  it("is available for a script that cannot take a load profile, which a debug run ignores", async () => {
    const script = userScript({ check: { accepted: true, hosts: [], envNames: [], hasDefaultFunction: false }, settings: { mapping: [], removedNames: [], load: { kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 1000, targetVirtualUsers: 1 }], plannedDurationMs: 1000 } }, thresholds: [] } });
    stubFetch(routes(script));
    render(<UserScriptPage />);
    const card = await openRuns();
    expect(within(card).getByRole("button", { name: "Run on perf-local" })).toBeDisabled();
    await waitFor(() => expect(within(card).getByRole("button", { name: "Start debug run on perf-local" })).toBeEnabled());
  });

  it("starts only on the engineer's click, sends the shown SHA-256, and shows every exchange with masked text", async () => {
    const script = userScript();
    const calls = stubFetch(routes(script, { [`POST ${DEBUG_URL(script.id)}`]: () => [200, debugResult()] }));
    render(<UserScriptPage />);
    const card = await openRuns();
    expect(calls.some((call) => call.url.endsWith("/debug-runs"))).toBe(false);
    const button = within(card).getByRole("button", { name: "Start debug run on perf-local" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    const output = await screen.findByTestId("user-script-debug-output");
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/debug-runs"))!.body).toEqual({ environmentId: "env-1", scriptSha256: SHA });
    expect(within(output).getByText("Completed")).toBeInTheDocument();
    expect(within(output).getByText(/perf-local · http:\/\/127\.0\.0\.1:4600 · 1234 ms · 3 requests/)).toBeInTheDocument();
    const exchanges = within(output).getAllByTestId("debug-exchange");
    expect(exchanges).toHaveLength(3);
    // A failing exchange is open, a successful one is closed, and a request with no response says so.
    expect(within(exchanges[0]).getAllByText("500 Internal Server Error").length).toBeGreaterThan(0);
    expect(exchanges[0].querySelector("details")).toHaveAttribute("open");
    expect(exchanges[1].querySelector("details")).not.toHaveAttribute("open");
    expect(within(exchanges[2]).getByText("No response")).toBeInTheDocument();
    expect(within(exchanges[2]).getByText(/No response was received/)).toBeInTheDocument();
    // Masked values are markers; only the one the server allows can be revealed.
    expect(within(exchanges[0]).getAllByTestId("masked-value")).toHaveLength(2);
    expect(within(exchanges[0]).getAllByRole("button", { name: /^Reveal/ })).toHaveLength(1);
    expect(within(exchanges[0]).getByRole("button", { name: "Reveal Authorization header" })).toBeInTheDocument();
    // A compressed body is not shown, and says it is compressed.
    expect(within(exchanges[1]).getByText(/binary content \(application\/json \(gzip-compressed\), 35 bytes\) is not shown/i)).toBeInTheDocument();
  });

  it("reveals one masked value on request, hides it again, and forgets everything when closed", async () => {
    const script = userScript();
    const calls = stubFetch(
      routes(script, {
        [`POST ${DEBUG_URL(script.id)}`]: () => [200, debugResult()],
        [`GET ${DEBUG_URL(script.id)}/${RUN_ID}/values/v2`]: () => [200, { value: "Bearer REVEALED-TOKEN" }],
        [`DELETE ${DEBUG_URL(script.id)}/${RUN_ID}`]: () => [204, {}],
      }),
    );
    render(<UserScriptPage />);
    const card = await openRuns();
    const button = within(card).getByRole("button", { name: "Start debug run on perf-local" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const output = await screen.findByTestId("user-script-debug-output");

    expect(screen.queryByText("Bearer REVEALED-TOKEN")).not.toBeInTheDocument();
    fireEvent.click(within(output).getByRole("button", { name: "Reveal Authorization header" }));
    expect(await within(output).findByText(/Bearer REVEALED-TOKEN/)).toBeInTheDocument();
    fireEvent.click(within(output).getByRole("button", { name: "Hide Authorization header" }));
    expect(screen.queryByText(/Bearer REVEALED-TOKEN/)).not.toBeInTheDocument();

    fireEvent.click(within(output).getByRole("button", { name: "Close debug output" }));
    expect(screen.queryByTestId("user-script-debug-output")).not.toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith(`/debug-runs/${RUN_ID}`))).toBe(true));
  });

  it("shows the server's reason when the debug run cannot start", async () => {
    const script = userScript();
    stubFetch(routes(script, { [`POST ${DEBUG_URL(script.id)}`]: () => [409, { error: "execution_in_progress", message: "Another execution run is in progress in this session." }] }));
    render(<UserScriptPage />);
    const card = await openRuns();
    const button = within(card).getByRole("button", { name: "Start debug run on perf-local" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const error = await screen.findByTestId("debug-run-error");
    expect(error).toHaveTextContent("The debug run could not run.");
    expect(error).toHaveTextContent("Another execution run is in progress in this session.");
  });

  it("cancels the run by aborting its request, and is idle again without an error", async () => {
    const script = userScript();
    let aborted = false;
    stubFetch(routes(script));
    const base = globalThis.fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/debug-runs") && init?.method === "POST") {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
        return base(input, init);
      }),
    );
    render(<UserScriptPage />);
    const card = await openRuns();
    const button = within(card).getByRole("button", { name: "Start debug run on perf-local" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByTestId("debug-running")).toHaveTextContent("Running the script once");
    // While it runs, the card's debug button is its Cancel, as on Performance.
    expect(within(card).queryByRole("button", { name: "Start debug run on perf-local" })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Cancel debug run" }));
    await waitFor(() => expect(aborted).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("debug-running")).not.toBeInTheDocument());
    expect(screen.queryByTestId("debug-run-error")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Start debug run on perf-local" })).toBeInTheDocument();
  });
});

describe("UserScriptDebugView outcomes", () => {
  const view = (result: UserScriptDebugResult): UserScriptDebugRun => ({ state: { kind: "done", result }, running: false, blocked: null, start: () => undefined, cancel: () => undefined, close: () => undefined, reveal: async () => null });

  it("says, in words, how the run ended", () => {
    const cases: [Partial<UserScriptDebugResult>, string][] = [
      [{ outcome: "completed" }, "Completed"],
      [{ outcome: "failed", exchanges: [], k6Message: "GoError: boom", k6ExitCode: 107 }, "Failed"],
      [{ outcome: "no-requests", exchanges: [] }, "No requests sent"],
      [{ outcome: "cut-off", cutOffReason: "exchange-limit" }, "Cut off after 200 requests"],
      [{ outcome: "cut-off", cutOffReason: "time-limit" }, "Cut off at the 60 second limit"],
      [{ outcome: "cancelled" }, "Cancelled"],
    ];
    for (const [overrides, label] of cases) {
      const { unmount } = render(<UserScriptDebugView debug={view(debugResult(overrides))} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows k6's own message for a failed run, and states the run's limits as notes", () => {
    render(<UserScriptDebugView debug={view(debugResult({ outcome: "failed", exchanges: [], k6Message: "GoError: boom", k6ExitCode: 107 }))} />);
    expect(screen.getByText("GoError: boom")).toBeInTheDocument();
    expect(screen.getByText("k6 did not send a request.")).toBeInTheDocument();
    expect(screen.getByText(/load profile and the thresholds set in ApiPilot did not apply/)).toBeInTheDocument();
  });

  it("says a script that sent no HTTP request ran without one", () => {
    render(<UserScriptDebugView debug={view(debugResult({ outcome: "no-requests", exchanges: [] }))} />);
    expect(screen.getByText("The script ran without sending an HTTP request.")).toBeInTheDocument();
  });

  it("draws nothing when idle", () => {
    const { container } = render(<UserScriptDebugView debug={{ ...view(debugResult()), state: { kind: "idle" } }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
