import type { ChainPlan } from "@apipilot/shared-domain";
import { getChainPlanDataSetRepository } from "../../../persistence/chainPlanDataSetRepository";
import { DataSetNotFoundError } from "../../errors";
import { parseCsv } from "../csv";
import type { DebugData } from "./runDebugRun";

/**
 * The first row of each data set the plan holds, for a Debug run (specs/039-chain-debug-run: "the
 * first row of a data set is used"; the runtime's `setup()` uses `firstRows()` the same way, and the
 * first iteration of the first virtual user reads row 0 in either data set mode). A later data set's
 * column wins over an earlier one of the same name, as `COLUMNS` does in the runtime. The values are
 * handed to the executor in memory only; `secretColumns` tells it which to mask.
 */
export function loadFirstDataRows(sessionId: string, plan: Pick<ChainPlan, "id" | "dataSets">): DebugData {
  const columns = new Map<string, string>();
  const secretColumns: string[] = [];
  const rows: DebugData["rows"] = [];
  for (const dataSet of plan.dataSets) {
    const bytes = getChainPlanDataSetRepository().content(sessionId, plan.id, dataSet.id);
    if (!bytes) throw new DataSetNotFoundError(dataSet.id);
    const first = parseCsv(bytes).rows[0];
    if (first === undefined) continue;
    dataSet.columns.forEach((column, index) => {
      const value = first[index];
      if (value !== undefined) columns.set(column.name, value);
      if (column.secret) secretColumns.push(column.name);
    });
    rows.push({ dataSetName: dataSet.name, rowNumber: 1 });
  }
  return { columns, secretColumns, rows };
}
