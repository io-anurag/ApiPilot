import { describe, expect, it } from "vitest";
import type { DebugRunResult } from "@apipilot/shared-domain";
import { HeldValues, HOLD_MS } from "../../../../../src/performance/chain/debug/heldValues";
import { RUN_CAP_MS } from "../../../../../src/performance/chain/debug/runDebugRun";
import type { Sender, SendResult } from "../../../../../src/performance/chain/debug/sender";
import { bodyExtractor, chain, chainPlan, step } from "../../../../fixtures/chain/chainPlans";
import { debugRun, FIXED_NOW_MS } from "../../../../fixtures/chain/debugRun";

/** AP-039 (specs/039-chain-debug-run tasks T016, T031, T036; FR-023, FR-025). */

const BASE = "http://127.0.0.1:4600";
const ok = (): SendResult => ({ kind: "response", status: 200, statusText: "", headers: [], contentType: "application/json", body: new TextEncoder().encode("{}"), bodyTruncated: false, durationMs: 1, redirects: [] });

const threeSteps = () =>
  chainPlan({ chains: [chain("c1", "Chain", [step({ id: "s1", url: "{{baseUrl}}/a" }), step({ id: "s2", url: "{{baseUrl}}/b" }), step({ id: "s3", url: "{{baseUrl}}/c" })])] });

function notReached(result: DebugRunResult): string[] {
  return result.chains[0].steps.map((entry) => (entry.status === "not-sent" && entry.cause.kind === "not-reached" ? entry.cause.reason : entry.status));
}

describe("a cancelled Debug run", () => {
  it("aborts the in-flight request and marks the steps not yet sent as not reached", async () => {
    const controller = new AbortController();
    let calls = 0;
    const sender: Sender = {
      send: (input) => {
        calls += 1;
        if (calls === 2) controller.abort();
        return Promise.resolve(input.signal.aborted ? { kind: "no-response", reason: "aborted", durationMs: 0, redirects: [] } : ok());
      },
    };
    const run = await debugRun(threeSteps(), { values: { baseUrl: BASE }, respond: () => ({ status: 200 }), sender, signal: controller.signal });
    expect(run.result.outcome).toBe("cancelled");
    expect(notReached(run.result)).toEqual(["sent", "sent", "run-cancelled"]);
    expect(calls).toBe(2);
  });

  it("sends nothing when it was cancelled before it started", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const sender: Sender = { send: () => (calls++, Promise.resolve(ok())) };
    const run = await debugRun(threeSteps(), { values: { baseUrl: BASE }, respond: () => ({ status: 200 }), sender, signal: controller.signal });
    expect(calls).toBe(0);
    expect(run.result.outcome).toBe("cancelled");
    expect(notReached(run.result)).toEqual(["run-cancelled", "run-cancelled", "run-cancelled"]);
  });
});

describe("the overall time limit", () => {
  it("cuts the run off, says so, and marks the remaining steps not sent", async () => {
    let now = FIXED_NOW_MS;
    const sender: Sender = {
      send: () => {
        now += RUN_CAP_MS / 2 + 1;
        return Promise.resolve(ok());
      },
    };
    const run = await debugRun(threeSteps(), { values: { baseUrl: BASE }, respond: () => ({ status: 200 }), sender, nowMs: () => now });
    expect(run.result.outcome).toBe("cut-off");
    expect(notReached(run.result)).toEqual(["sent", "sent", "run-time-cap"]);
    expect(run.result.notes.join(" ")).toContain("cut off");
  });

  it("gives each request at most what is left of the time", async () => {
    let now = FIXED_NOW_MS;
    const timeouts: number[] = [];
    const sender: Sender = {
      send: (input) => {
        timeouts.push(input.timeoutMs);
        now += 50_000;
        return Promise.resolve(ok());
      },
    };
    await debugRun(threeSteps(), { values: { baseUrl: BASE }, respond: () => ({ status: 200 }), sender, nowMs: () => now });
    expect(timeouts[0]).toBe(30_000);
    expect(timeouts.every((value) => value > 0 && value <= 30_000)).toBe(true);
  });
});

describe("shared scope and extracted values in the result", () => {
  it("shows an extracted ordinary value as text and an extracted credential masked", async () => {
    const plan = chainPlan({
      chains: [chain("c1", "Chain", [step({ id: "s1", url: "{{baseUrl}}/a", extractors: [bodyExtractor("x1", "customer_id", "id"), bodyExtractor("x2", "access_token", "tok")] })])],
    });
    const run = await debugRun(plan, { values: { baseUrl: BASE }, respond: () => ({ status: 200, body: { id: "c-77", tok: "t-secret-9" } }) });
    const first = run.result.chains[0].steps[0];
    if (first.status !== "sent") throw new Error("expected sent");
    const [plainValue, credential] = first.extractors.map((entry) => (entry.outcome.kind === "extracted" ? entry.outcome.value : []));
    expect(plainValue).toEqual([{ kind: "text", text: "c-77" }]);
    expect(credential).toHaveLength(1);
    expect(credential[0]).toMatchObject({ kind: "masked", revealable: true, label: "extracted value access_token" });
    expect([...run.revealable.values()]).toContain("t-secret-9");
    expect(JSON.stringify(run.result)).not.toContain("t-secret-9");
  });
});

describe("held values", () => {
  const values = (...entries: [string, string][]) => new Map(entries);

  it("reveals only the latest run's values of the plan, to the session that holds them", () => {
    const held = new HeldValues(() => 0);
    held.hold("s1", "p1", "run-a", values(["v1", "one"]));
    expect(held.reveal("s1", "p1", "run-a", "v1")).toBe("one");
    expect(held.reveal("s2", "p1", "run-a", "v1")).toBeNull();
    expect(held.reveal("s1", "p2", "run-a", "v1")).toBeNull();
    expect(held.reveal("s1", "p1", "run-b", "v1")).toBeNull();
    expect(held.reveal("s1", "p1", "run-a", "v2")).toBeNull();
    held.hold("s1", "p1", "run-b", values(["v1", "two"]));
    expect(held.reveal("s1", "p1", "run-a", "v1")).toBeNull();
    expect(held.reveal("s1", "p1", "run-b", "v1")).toBe("two");
  });

  it("expires after the hold time, on an injected clock", () => {
    let now = 0;
    const held = new HeldValues(() => now);
    held.hold("s1", "p1", "run-a", values(["v1", "one"]));
    now = HOLD_MS - 1;
    expect(held.reveal("s1", "p1", "run-a", "v1")).toBe("one");
    now = HOLD_MS;
    expect(held.reveal("s1", "p1", "run-a", "v1")).toBeNull();
  });

  it("discards a run's values, but not a newer run's, and clears a session", () => {
    const held = new HeldValues(() => 0);
    held.hold("s1", "p1", "run-b", values(["v1", "two"]));
    held.discard("s1", "p1", "run-a");
    expect(held.reveal("s1", "p1", "run-b", "v1")).toBe("two");
    held.discard("s1", "p1", "run-b");
    expect(held.reveal("s1", "p1", "run-b", "v1")).toBeNull();
    held.hold("s1", "p1", "run-c", values(["v1", "three"]));
    held.hold("s2", "p1", "run-d", values(["v1", "four"]));
    held.clearSession("s1");
    expect(held.reveal("s1", "p1", "run-c", "v1")).toBeNull();
    expect(held.reveal("s2", "p1", "run-d", "v1")).toBe("four");
  });

  it("holds nothing for a run with no revealable value, and drops the previous run's", () => {
    const held = new HeldValues(() => 0);
    held.hold("s1", "p1", "run-a", values(["v1", "one"]));
    held.hold("s1", "p1", "run-b", new Map());
    expect(held.reveal("s1", "p1", "run-a", "v1")).toBeNull();
  });
});
