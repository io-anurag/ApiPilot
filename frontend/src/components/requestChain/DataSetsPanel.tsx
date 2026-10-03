import { useId, useRef, useState } from "react";
import { CHAIN_PLAN_LIMITS, type ChainPlan, type ChainPlanAnalysis, type ChainPlanView, type DataSetInfo, type DataSetMode, type DataSetPreview } from "@apipilot/shared-domain";
import { deleteDataSet, fetchDataSetPreview, replaceDataSetFile, updateDataSet, uploadDataSet } from "../../services/requestChainClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { SetupItem } from "../performance/SetupItem";

const MODE_LABELS: Record<DataSetMode, string> = {
  "row-per-iteration": "Next row per iteration",
  "row-per-virtual-user": "One row per virtual user",
};

function stepNames(plan: ChainPlan, stepIds: readonly string[]): string {
  const steps = plan.chains.flatMap((chain) => chain.steps);
  return stepIds.map((id) => steps.find((step) => step.id === id)?.name ?? id).join(", ");
}

/**
 * The plan's CSV data sets (specs/037-request-chain-performance US6, FR-041 to FR-046): upload with a
 * name and a mode, then mark columns secret, rename, change the mode, replace the file, preview the
 * first rows with secret cells hidden, or remove. A refused file is shown with the reason and line,
 * and nothing is kept. Values are never shown except the preview's non-secret cells.
 */
export function DataSetsPanel({ plan, analysis, onPlanChanged }: Readonly<{ plan: ChainPlan; analysis: ChainPlanAnalysis; onPlanChanged: (view: ChainPlanView) => void }>) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<DataSetMode>("row-per-iteration");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, DataSetPreview>>({});
  const [replacing, setReplacing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DataSetInfo | null>(null);

  async function run<T extends { ok: boolean }>(action: () => Promise<T>, onDone: (result: T) => void) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError((result as unknown as { message: string }).message);
    else onDone(result);
  }

  function handleUpload() {
    if (!file) return;
    void run(
      () => uploadDataSet(plan.id, file, name.trim() || file.name.replace(/\.csv$/i, ""), mode),
      (result) => {
        if (!result.ok) return;
        onPlanChanged(result);
        setFile(null);
        setName("");
        if (fileInput.current) fileInput.current.value = "";
      },
    );
  }

  function save(dataSet: DataSetInfo, patch: Partial<Pick<DataSetInfo, "name" | "mode" | "columns">>) {
    void run(
      () => updateDataSet(plan.id, dataSet.id, { name: patch.name ?? dataSet.name, mode: patch.mode ?? dataSet.mode, columns: patch.columns ?? dataSet.columns }),
      (result) => result.ok && onPlanChanged(result),
    );
  }

  const usage = (dataSetId: string, column: string) => analysis.dataSetUsage.find((entry) => entry.dataSetId === dataSetId && entry.column === column)?.stepIds ?? [];

  return (
    <SetupItem state={plan.dataSets.length > 0 ? "done" : "optional"} title="Data sets (optional)" titleId={`${id}-title`} summary="CSV files whose columns are {{name}} values. Values are encrypted on this machine and reach k6 only while a run lasts.">
      {error && <ErrorState message={error} testId="data-set-error" />}
      {plan.dataSets.map((dataSet) => {
        const preview = previews[dataSet.id];
        return (
          <section key={dataSet.id} aria-label={`Data set ${dataSet.name}`} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium">{dataSet.name}</span> <span className="text-muted">· {dataSet.rowCount.toLocaleString()} rows · {dataSet.columns.length} columns</span>
              </p>
              <label className="flex items-center gap-1 text-xs">
                <span>Mode</span>
                <select className="rounded border border-border bg-surface px-1 py-0.5" value={dataSet.mode} disabled={busy} onChange={(event) => save(dataSet, { mode: event.target.value as DataSetMode })}>
                  {(Object.keys(MODE_LABELS) as DataSetMode[]).map((option) => (
                    <option key={option} value={option}>
                      {MODE_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="sr-only">{`Columns of ${dataSet.name}`}</caption>
                <thead className="text-xs text-muted">
                  <tr>
                    <th scope="col" className="pb-1 pr-2 font-medium">Column</th>
                    <th scope="col" className="pb-1 pr-2 font-medium">Secret</th>
                    <th scope="col" className="pb-1 font-medium">Used by</th>
                  </tr>
                </thead>
                <tbody>
                  {dataSet.columns.map((column, index) => (
                    <tr key={column.name}>
                      <td className="py-0.5 pr-2 font-mono text-xs">{`{{${column.name}}}`}</td>
                      <td className="py-0.5 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Mark ${column.name} secret`}
                          checked={column.secret}
                          disabled={busy}
                          onChange={(event) => save(dataSet, { columns: dataSet.columns.map((current, at) => (at === index ? { ...current, secret: event.target.checked } : current)) })}
                        />
                      </td>
                      <td className="py-0.5 text-xs text-muted">{usage(dataSet.id, column.name).length > 0 ? stepNames(plan, usage(dataSet.id, column.name)) : "No step"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left font-mono text-xs" data-testid="data-set-preview">
                  <caption className="sr-only">{`First rows of ${dataSet.name}`}</caption>
                  <thead>
                    <tr>{preview.columns.map((column) => <th key={column.name} scope="col" className="pr-2 font-medium">{column.name}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="pr-2">{cell === null ? <span className="font-sans italic text-muted">hidden</span> : cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className={BUTTON_STYLES.ghost}
                disabled={busy}
                onClick={() =>
                  preview
                    ? setPreviews(({ [dataSet.id]: _closed, ...rest }) => rest)
                    : void run(() => fetchDataSetPreview(plan.id, dataSet.id), (result) => result.ok && setPreviews((current) => ({ ...current, [dataSet.id]: result.preview })))
                }
              >
                {preview ? "Hide preview" : "Preview first rows"}
              </button>
              <button
                type="button"
                className={BUTTON_STYLES.ghost}
                disabled={busy}
                onClick={() => {
                  setReplacing(dataSet.id);
                  replaceInput.current?.click();
                }}
              >
                Replace file
              </button>
              <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setRemoving(dataSet)}>
                Remove
              </button>
            </div>
          </section>
        );
      })}
      <input
        ref={replaceInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-label="Replace the data set's file"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          const target = replacing;
          event.target.value = "";
          if (!chosen || !target) return;
          void run(() => replaceDataSetFile(plan.id, target, chosen), (result) => result.ok && onPlanChanged(result));
        }}
      />
      {plan.dataSets.length < CHAIN_PLAN_LIMITS.dataSets ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <label htmlFor={`${id}-file`} className="text-xs font-medium text-muted">
              CSV file (UTF-8, header row, up to 5 MiB)
            </label>
            <input id={`${id}-file`} ref={fileInput} type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-name`} className="text-xs font-medium text-muted">
              Data set name
            </label>
            <input id={`${id}-name`} className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm" value={name} placeholder={file?.name.replace(/\.csv$/i, "") ?? ""} onChange={(event) => setName(event.target.value)} />
            <label htmlFor={`${id}-mode`} className="sr-only">
              Mode
            </label>
            <select id={`${id}-mode`} className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm" value={mode} onChange={(event) => setMode(event.target.value as DataSetMode)}>
              {(Object.keys(MODE_LABELS) as DataSetMode[]).map((option) => (
                <option key={option} value={option}>
                  {MODE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={BUTTON_STYLES.secondary} disabled={busy || !file} onClick={handleUpload}>
            Add data set
          </button>
        </div>
      ) : (
        <StatusBadge label={`A plan has at most ${CHAIN_PLAN_LIMITS.dataSets} data sets`} />
      )}
      {removing && (
        <ConfirmDialog
          message={`Remove the data set "${removing.name}"? Steps that use its columns will need those values from the environment.`}
          affectedCount={1}
          confirmLabel="Remove data set"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const target = removing;
            setRemoving(null);
            void run(() => deleteDataSet(plan.id, target.id), (result) => result.ok && onPlanChanged(result));
          }}
        />
      )}
    </SetupItem>
  );
}
