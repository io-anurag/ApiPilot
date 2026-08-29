import type { ReadinessState } from "@apipilot/shared-domain";

/**
 * Tracks the lifecycle state of a local AIProvider (FR-004). Transitions are only ever
 * driven by explicit calls (markLoading/markReady/markUnavailable/reset) — nothing in
 * this class re-attempts a load automatically after a failure (FR-019).
 */
export class ReadinessTracker {
  private state: ReadinessState;

  constructor() {
    this.state = notLoadedState();
  }

  getState(): ReadinessState {
    return { ...this.state };
  }

  markLoading(acceleratorRequested: boolean): void {
    this.state = {
      state: "loading",
      acceleratorRequested,
      acceleratorActive: false,
      updatedAt: new Date().toISOString(),
    };
  }

  markReady(params: {
    modelId: string;
    acceleratorRequested: boolean;
    acceleratorActive: boolean;
    /** Visible notice, e.g. an accelerator-unavailable fallback (FR-008); optional otherwise. */
    reason?: string;
  }): void {
    this.state = {
      state: "ready",
      modelId: params.modelId,
      reason: params.reason,
      acceleratorRequested: params.acceleratorRequested,
      acceleratorActive: params.acceleratorActive,
      updatedAt: new Date().toISOString(),
    };
  }

  /** `reason` is required and MUST be non-empty (no silent unavailability). */
  markUnavailable(params: {
    reason: string;
    acceleratorRequested?: boolean;
    acceleratorActive?: boolean;
  }): void {
    this.state = {
      state: "unavailable",
      reason: params.reason,
      acceleratorRequested: params.acceleratorRequested ?? this.state.acceleratorRequested,
      acceleratorActive: params.acceleratorActive ?? false,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Explicit reset back to not-loaded — the only way to clear an "unavailable" state (FR-019). */
  reset(): void {
    this.state = notLoadedState();
  }
}

function notLoadedState(): ReadinessState {
  return {
    state: "not-loaded",
    acceleratorRequested: false,
    acceleratorActive: false,
    updatedAt: new Date().toISOString(),
  };
}
