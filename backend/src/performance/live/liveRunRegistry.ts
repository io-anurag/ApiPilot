import type { LiveRunKind, LiveRunSnapshot, LiveRunState } from "@apipilot/shared-domain";
import { onExpire } from "../../session/sessionRegistry";
import { buildSnapshot, type LiveCursor, type LiveParts } from "./buildSnapshot";

/**
 * In-memory live state of the runs this process is running or has just finished (AP-045 research
 * R4). A route reads it instead of the database, so a poll costs no write and no recomputation of
 * the stored result. An entry is owned by the session that started the run, and a run of another
 * session is not found. A finished run keeps its last view, so the dashboard does not change shape
 * the moment the run ends; only the newest `MAX_FINISHED` are kept, and a session's entries go
 * with it.
 */

const MAX_FINISHED = 50;

export interface LiveRunRegistration {
  sessionId: string;
  runId: string;
  kind: Extract<LiveRunKind, "chain" | "user-script">;
  plannedDurationMs: number | null;
  /** The aggregate's current figures at `nowMs`. */
  parts(nowMs: number): LiveParts;
}

interface Entry {
  registration: LiveRunRegistration;
  state: LiveRunState;
  frozen: LiveParts | null;
}

const entries = new Map<string, Entry>();

onExpire((sessionId) => {
  for (const [runId, entry] of entries) if (entry.registration.sessionId === sessionId) entries.delete(runId);
});

export function registerLiveSnapshotSource(registration: LiveRunRegistration): void {
  entries.set(registration.runId, { registration, state: "live", frozen: null });
}

/** Freezes the run's last view in its final state. A run that was never registered is ignored. */
export function finishLiveSnapshotSource(runId: string, state: Exclude<LiveRunState, "live">, endMs: number): void {
  const entry = entries.get(runId);
  if (!entry) return;
  entry.frozen = entry.registration.parts(endMs);
  entry.state = state;
  const finished = [...entries.entries()].filter(([, candidate]) => candidate.state !== "live");
  for (const [runIdToDrop] of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) entries.delete(runIdToDrop);
}

/** The snapshot of a run this session started and this process still holds, or undefined. */
export function readLiveSnapshot(sessionId: string, runId: string, nowMs: number, cursor: LiveCursor): LiveRunSnapshot | undefined {
  const entry = entries.get(runId);
  if (!entry || entry.registration.sessionId !== sessionId) return undefined;
  const { registration } = entry;
  const parts = entry.frozen ?? registration.parts(nowMs);
  return buildSnapshot(
    {
      runId,
      kind: registration.kind,
      state: entry.state,
      plannedDurationMs: registration.plannedDurationMs,
      plannedRequests: null,
      inFlight: null,
      ...parts,
    },
    cursor,
  );
}

/** For tests. */
export function clearLiveSnapshotSources(): void {
  entries.clear();
}
