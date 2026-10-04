import { analyzeChainPlan, type ChainPlan, type Environment } from "@apipilot/shared-domain";
import { runDebugRun, type DebugData, type DebugRunOutput } from "../../../src/performance/chain/debug/runDebugRun";
import type { Sender, SendInput, SendResult } from "../../../src/performance/chain/debug/sender";
import type { SandboxRequest, SandboxResponse } from "../performance/k6Sandbox";

/**
 * AP-039 (specs/039-chain-debug-run tasks T013): runs the debug executor over a plan with a fake
 * sender backed by the same `respond` function the k6 sandbox uses, so one stub answers both runtimes.
 */
export const FIXED_NOW_MS = Date.parse("2026-09-27T12:00:00.000Z");

export function environmentOf(values: Record<string, string>): Environment {
  const { baseUrl = "", ...variableValues } = values;
  return { id: "11111111-1111-4111-8111-111111111111", name: "Test env", tier: "local", baseUrl, variableValues, requestDelayMs: 0 };
}

export interface FakeSender {
  sender: Sender;
  /** Every request the sender was asked to send, in order. */
  sent: SendInput[];
}

export function fakeSender(respond: (request: SandboxRequest) => SandboxResponse): FakeSender {
  const sent: SendInput[] = [];
  const sender: Sender = {
    send(input: SendInput): Promise<SendResult> {
      sent.push(input);
      const response = respond({ method: input.method, url: input.url, body: input.body, headers: input.headers, tags: {}, responseType: "text" });
      const text = response.body === undefined ? "" : typeof response.body === "string" ? response.body : JSON.stringify(response.body);
      return Promise.resolve({
        kind: "response",
        status: response.status,
        statusText: "",
        headers: Object.entries(response.headers ?? {}),
        contentType: Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? (typeof response.body === "object" ? "application/json" : null),
        body: new TextEncoder().encode(text),
        bodyTruncated: false,
        durationMs: response.durationMs ?? 0,
        redirects: [],
      });
    },
  };
  return { sender, sent };
}

export const NO_DATA: DebugData = { columns: new Map(), secretColumns: [], rows: [] };

export interface DebugRunOptions {
  values: Record<string, string>;
  respond: (request: SandboxRequest) => SandboxResponse;
  runTag?: string;
  data?: DebugData;
  signal?: AbortSignal;
  nowMs?: () => number;
  sender?: Sender;
}

export async function debugRun(plan: ChainPlan, options: DebugRunOptions): Promise<DebugRunOutput & { sent: SendInput[] }> {
  const environment = environmentOf(options.values);
  const fake = fakeSender(options.respond);
  const output = await runDebugRun(
    {
      debugRunId: "debug-run-1",
      plan,
      analysis: analyzeChainPlan(plan, { environmentValueNames: null }),
      environment,
      data: options.data ?? NO_DATA,
      runTag: options.runTag ?? "",
      signal: options.signal ?? new AbortController().signal,
    },
    { sender: options.sender ?? fake.sender, nowMs: options.nowMs ?? (() => FIXED_NOW_MS) },
  );
  return { ...output, sent: fake.sent };
}
