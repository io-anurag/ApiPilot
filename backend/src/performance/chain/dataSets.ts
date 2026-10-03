import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { CHAIN_PLAN_LIMITS, REFERENCE_NAME, type ChainPlan, type ChainPlanView, type DataSetColumn, type DataSetInfo, type DataSetMode, type DataSetPreview } from "@apipilot/shared-domain";
import { getChainPlanDataSetRepository } from "../../persistence/chainPlanDataSetRepository";
import { getSessionId } from "../../session/sessionContext";
import { DataSetLimitExceededError, DataSetNotFoundError, DataSetTooLargeError, InvalidChainPlanError } from "../errors";
import { getPlan, viewOf } from "./chainPlanStore";
import { DataSetInvalidError, parseCsv } from "./csv";

/**
 * A request-chain plan's CSV data sets (specs/037-request-chain-performance FR-041 to FR-047;
 * research R14). A file is checked whole before anything is stored; its bytes are encrypted at rest
 * and reach k6 only as a per-run JSON copy written into the run directory and removed with it. Only
 * the preview reads values back, and it hides every secret column's cells (FR-045). Nothing here
 * logs or returns a value otherwise.
 */
const MODES: readonly DataSetMode[] = ["row-per-virtual-user", "row-per-iteration"];
const PREVIEW_ROWS = 5;

/** FR-046: the SHA-256 of the uploaded bytes exactly as received. */
function sha256OfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function nameOf(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "" || raw.trim().length > CHAIN_PLAN_LIMITS.nameLength) {
    throw new InvalidChainPlanError("name", `A data set needs a name of 1 to ${CHAIN_PLAN_LIMITS.nameLength} characters.`);
  }
  return raw.trim();
}

function modeOf(raw: unknown): DataSetMode {
  if (typeof raw !== "string" || !(MODES as readonly string[]).includes(raw)) {
    throw new InvalidChainPlanError("mode", "A data set takes one row per virtual user, or the next row per iteration.");
  }
  return raw as DataSetMode;
}

function dataSetOf(plan: ChainPlan, dataSetId: string): DataSetInfo {
  const dataSet = plan.dataSets.find((candidate) => candidate.id === dataSetId);
  if (!dataSet) throw new DataSetNotFoundError(dataSetId);
  return dataSet;
}

/** FR-042: no column name may already belong to another data set of the plan. */
function requireUniqueColumns(plan: ChainPlan, columns: readonly string[], exceptId: string | null): void {
  for (const other of plan.dataSets) {
    if (other.id === exceptId) continue;
    const clash = columns.find((column) => other.columns.some((existing) => existing.name === column));
    if (clash !== undefined) throw new DataSetInvalidError({ reason: "column-in-other-data-set", column: clash, dataSetName: other.name });
  }
}

function parseFile(bytes: Buffer): { columns: string[]; rowCount: number } {
  if (bytes.length > CHAIN_PLAN_LIMITS.dataSetBytes) throw new DataSetTooLargeError(CHAIN_PLAN_LIMITS.dataSetBytes);
  const parsed = parseCsv(bytes);
  return { columns: parsed.columns, rowCount: parsed.rows.length };
}

export function addDataSet(planId: string, bytes: Buffer, rawName: unknown, rawMode: unknown, now: string): { dataSet: DataSetInfo; view: ChainPlanView } {
  const plan = getPlan(planId);
  if (plan.dataSets.length >= CHAIN_PLAN_LIMITS.dataSets) throw new DataSetLimitExceededError(CHAIN_PLAN_LIMITS.dataSets);
  const name = nameOf(rawName);
  const mode = modeOf(rawMode);
  const { columns, rowCount } = parseFile(bytes);
  requireUniqueColumns(plan, columns, null);
  const dataSet: DataSetInfo = { id: randomUUID(), name, mode, columns: columns.map((column) => ({ name: column, secret: false })), rowCount, sizeBytes: bytes.length, sha256: sha256OfBytes(bytes) };
  getChainPlanDataSetRepository().create(getSessionId(), { ...dataSet, planId, content: bytes, at: now });
  return { dataSet, view: viewOf(getPlan(planId)) };
}

/** Renames the data set or its columns, marks columns secret, or changes the mode; the columns keep their count and order. */
export function updateDataSet(planId: string, dataSetId: string, body: unknown, now: string): { dataSet: DataSetInfo; view: ChainPlanView } {
  const plan = getPlan(planId);
  const current = dataSetOf(plan, dataSetId);
  const input = (body ?? {}) as { name?: unknown; mode?: unknown; columns?: unknown };
  const name = nameOf(input.name);
  const mode = modeOf(input.mode);
  if (!Array.isArray(input.columns) || input.columns.length !== current.columns.length) {
    throw new InvalidChainPlanError("columns", "Columns keep their number and order; rename them or mark them secret.");
  }
  const columns: DataSetColumn[] = (input.columns as unknown[]).map((raw) => {
    const column = (raw ?? {}) as { name?: unknown; secret?: unknown };
    if (typeof column.name !== "string" || !REFERENCE_NAME.test(column.name)) {
      throw new DataSetInvalidError({ reason: "invalid-column-name", line: 1, column: String(column.name ?? "") });
    }
    return { name: column.name, secret: column.secret === true };
  });
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.name)) throw new DataSetInvalidError({ reason: "duplicate-column", line: 1, column: column.name });
    seen.add(column.name);
  }
  requireUniqueColumns(plan, columns.map((column) => column.name), dataSetId);
  getChainPlanDataSetRepository().updateMeta(getSessionId(), planId, dataSetId, { name, mode, columns }, now);
  return { dataSet: { ...current, name, mode, columns }, view: viewOf(getPlan(planId)) };
}

/** A new file for the data set; columns marked secret stay secret by name. */
export function replaceDataSetFile(planId: string, dataSetId: string, bytes: Buffer, now: string): { dataSet: DataSetInfo; view: ChainPlanView } {
  const plan = getPlan(planId);
  const current = dataSetOf(plan, dataSetId);
  const { columns, rowCount } = parseFile(bytes);
  requireUniqueColumns(plan, columns, dataSetId);
  const secret = new Set(current.columns.filter((column) => column.secret).map((column) => column.name));
  const file = { columns: columns.map((column) => ({ name: column, secret: secret.has(column) })), rowCount, sizeBytes: bytes.length, sha256: sha256OfBytes(bytes), content: bytes };
  getChainPlanDataSetRepository().replaceContent(getSessionId(), planId, dataSetId, file, now);
  return { dataSet: { ...current, columns: file.columns, rowCount, sizeBytes: bytes.length, sha256: file.sha256 }, view: viewOf(getPlan(planId)) };
}

export function removeDataSet(planId: string, dataSetId: string): ChainPlanView {
  const plan = getPlan(planId);
  dataSetOf(plan, dataSetId);
  getChainPlanDataSetRepository().delete(getSessionId(), planId, dataSetId);
  return viewOf(getPlan(planId));
}

/** FR-045: the first rows, with every secret column's cells hidden. */
export function previewDataSet(planId: string, dataSetId: string): DataSetPreview {
  const plan = getPlan(planId);
  const dataSet = dataSetOf(plan, dataSetId);
  const bytes = getChainPlanDataSetRepository().content(getSessionId(), planId, dataSetId);
  if (!bytes) throw new DataSetNotFoundError(dataSetId);
  const rows = parseCsv(bytes).rows.slice(0, PREVIEW_ROWS);
  return { columns: dataSet.columns, rows: rows.map((row) => row.map((cell, index) => (dataSet.columns[index]?.secret ? null : cell))) };
}

/**
 * Research R14: writes each data set the plan uses as `apipilot-data-<i>.json`, owner-only, in the
 * run directory, after the script integrity check. The run directory and so every copy is removed
 * when the run settles and at startup. Reads with the session captured before the response.
 */
export function runCopyWriter(sessionId: string, plan: Pick<ChainPlan, "id" | "dataSets">): ((runDir: string) => void) | undefined {
  if (plan.dataSets.length === 0) return undefined;
  return (runDir: string) => {
    plan.dataSets.forEach((dataSet, index) => {
      const bytes = getChainPlanDataSetRepository().content(sessionId, plan.id, dataSet.id);
      if (!bytes) throw new DataSetNotFoundError(dataSet.id);
      writeFileSync(path.join(runDir, `apipilot-data-${index}.json`), JSON.stringify(parseCsv(bytes).rows), { encoding: "utf-8", mode: 0o600 });
    });
  };
}
