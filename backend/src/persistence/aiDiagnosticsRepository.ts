import type { BenchmarkCandidateResult, BenchmarkReport, ReadinessState } from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable, process-wide (not session-scoped) history of AI readiness transitions and benchmark
 * runs (specs/025-local-persistence-layer contracts/persistence-repositories.md, research.md
 * D5/D6). Purely additive/historical: the live `ReadinessTracker` state machine
 * (`backend/src/ai/readiness.ts`) is never resumed from this history — see `getLastKnownReadiness`.
 */
export interface AiDiagnosticsRepository {
  recordReadinessTransition(state: ReadinessState): void;
  getLastKnownReadiness(): ReadinessState | undefined;
  recordBenchmarkRun(report: BenchmarkReport): void;
  getLatestBenchmarkRun(): BenchmarkReport | undefined;
}

interface ReadinessRow {
  state: string;
  reason: string | null;
  model_id: string | null;
  accelerator_requested: number;
  accelerator_active: number;
  updated_at: string;
}

interface BenchmarkRow {
  run_at: string;
  workload_set_id: string;
  candidates: string;
  selected_model_id: string;
  selection_rationale: string;
}

export class SqliteAiDiagnosticsRepository implements AiDiagnosticsRepository {
  constructor(private readonly connection: SqliteConnection) {}

  recordReadinessTransition(state: ReadinessState): void {
    this.connection.db
      .prepare(
        `INSERT INTO ai_readiness_history
           (state, reason, model_id, accelerator_requested, accelerator_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        state.state,
        state.reason ?? null,
        state.modelId ?? null,
        state.acceleratorRequested ? 1 : 0,
        state.acceleratorActive ? 1 : 0,
        state.updatedAt,
      );
  }

  getLastKnownReadiness(): ReadinessState | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM ai_readiness_history ORDER BY id DESC LIMIT 1")
      .get() as ReadinessRow | undefined;
    if (!row) return undefined;
    return {
      state: row.state as ReadinessState["state"],
      reason: row.reason ?? undefined,
      modelId: row.model_id ?? undefined,
      acceleratorRequested: row.accelerator_requested === 1,
      acceleratorActive: row.accelerator_active === 1,
      updatedAt: row.updated_at,
    };
  }

  recordBenchmarkRun(report: BenchmarkReport): void {
    this.connection.db
      .prepare(
        `INSERT INTO benchmark_runs
           (run_at, workload_set_id, candidates, selected_model_id, selection_rationale)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        report.runAt,
        report.workloadSetId,
        JSON.stringify(report.candidates),
        report.selectedModelId,
        report.selectionRationale,
      );
  }

  getLatestBenchmarkRun(): BenchmarkReport | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM benchmark_runs ORDER BY id DESC LIMIT 1")
      .get() as BenchmarkRow | undefined;
    if (!row) return undefined;
    return {
      runAt: row.run_at,
      workloadSetId: row.workload_set_id,
      candidates: JSON.parse(row.candidates) as BenchmarkCandidateResult[],
      selectedModelId: row.selected_model_id,
      selectionRationale: row.selection_rationale,
    };
  }
}

let singleton: AiDiagnosticsRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getAiDiagnosticsRepository(): AiDiagnosticsRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteAiDiagnosticsRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
