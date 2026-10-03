import request from "supertest";
import { createApp } from "../../../src/app";
import type { PerformanceTestingDependencies } from "../../../src/api/performanceTesting";
import { unavailableProbe } from "./agent";
import { establishSession } from "./session";
import { QUICK_SPECIFICATION_FILENAME, quickSpecificationBuffer } from "./specification";

/** AP-032 quick performance test routes (specs/032-quick-performance-test contracts/quick-performance-api.md): the upload and status that remain for seeding. */
export const QUICK_BASE = "/api/quick-performance";

export interface QuickAgent {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}

/** A supertest agent with its own session and no quick test or guided workflow yet. */
export async function quickAgent(deps: Partial<PerformanceTestingDependencies> = {}): Promise<QuickAgent> {
  const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe(), ...deps } }));
  const sessionId = await establishSession(agent);
  return { agent, sessionId };
}

export function uploadQuick(
  agent: QuickAgent["agent"],
  options: { buffer?: Buffer; filename?: string; replaceExisting?: boolean } = {},
) {
  const url = options.replaceExisting ? `${QUICK_BASE}?replaceExisting=true` : QUICK_BASE;
  return agent.post(url).attach("file", options.buffer ?? quickSpecificationBuffer(), options.filename ?? QUICK_SPECIFICATION_FILENAME);
}
