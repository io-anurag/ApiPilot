import { LOAD_PROFILE_STARTING_STAGES, type LoadProfile, type LoadProfileKind, type LoadStage } from "@apipilot/shared-domain";
import { InvalidLoadProfileError } from "../errors";

/**
 * Load profiles (FR-017, FR-019). The starting stages live in shared-domain
 * (`LOAD_PROFILE_STARTING_STAGES`) so the frontend's editor shows exactly what the plan starts with.
 */
export const STARTING_STAGES = LOAD_PROFILE_STARTING_STAGES;

const PROFILE_KINDS: ReadonlySet<string> = new Set(Object.keys(STARTING_STAGES));

export function startingProfile(kind: LoadProfileKind): LoadProfile {
  const stages = STARTING_STAGES[kind].map((stage) => ({ ...stage }));
  return { kind, stages, plannedDurationMs: sum(stages) };
}

function sum(stages: readonly LoadStage[]): number {
  return stages.reduce((total, stage) => total + stage.durationMs, 0);
}

/**
 * Validates a client-sent profile: a known kind, at least one stage, whole-millisecond durations
 * over 0, whole virtual-user targets of 0 or more. No maximum and no warning (FR-019). The planned
 * duration is always recomputed here, never taken from the client.
 */
export function validateLoadProfile(input: unknown): LoadProfile {
  if (typeof input !== "object" || input === null) throw new InvalidLoadProfileError("A load profile is required.");
  const record = input as Record<string, unknown>;
  if (typeof record.kind !== "string" || !PROFILE_KINDS.has(record.kind)) {
    throw new InvalidLoadProfileError("The load profile must be smoke, load, stress, spike or soak.");
  }
  if (!Array.isArray(record.stages) || record.stages.length === 0) {
    throw new InvalidLoadProfileError("A load profile needs at least one stage.");
  }
  const stages = record.stages.map((raw): LoadStage => {
    const stage = (raw ?? {}) as Record<string, unknown>;
    const { durationMs, targetVirtualUsers } = stage;
    if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs <= 0) {
      throw new InvalidLoadProfileError("Every stage needs a duration over 0 ms.");
    }
    if (typeof targetVirtualUsers !== "number" || !Number.isInteger(targetVirtualUsers) || targetVirtualUsers < 0) {
      throw new InvalidLoadProfileError("Every stage needs a whole number of target virtual users, 0 or more.");
    }
    return { durationMs, targetVirtualUsers };
  });
  return { kind: record.kind as LoadProfileKind, stages, plannedDurationMs: sum(stages) };
}

export function validateThinkTime(input: unknown): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    throw new InvalidLoadProfileError("Think time must be a whole number of milliseconds, 0 or more.");
  }
  return input;
}
