/** Point-in-time backend health value, per data-model.md. */
export interface HealthStatus {
  status: "ok";
  timestamp: string;
}

export function createHealthStatus(now: Date = new Date()): HealthStatus {
  return {
    status: "ok",
    timestamp: now.toISOString(),
  };
}

/** Example second shared domain type, proving reuse without duplication (US2). */
export interface VersionInfo {
  version: string;
  commit: string;
}

export function createVersionInfo(version: string, commit: string): VersionInfo {
  return { version, commit };
}

export * from "./apiModel";
export * from "./testModel";
export * from "./aiProvider";
