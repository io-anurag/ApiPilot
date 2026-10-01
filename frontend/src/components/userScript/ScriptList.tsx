import type { UserScriptSummary } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { runStatusLabel } from "../performance/performanceViewModel";

/** Size as the engineer reads it: bytes below 1 KiB, else KiB with one decimal. */
export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * The session's scripts (AP-034 FR-003): name, size, SHA-256, whether the current content is
 * confirmed (in text, never colour alone), and the last run. Selecting a name opens the script.
 */
export function ScriptList({
  scripts,
  selectedId,
  onSelect,
}: Readonly<{ scripts: readonly UserScriptSummary[]; selectedId: string | null; onSelect: (scriptId: string) => void }>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Scripts in this session</caption>
        <thead>
          <tr className="bg-chrome text-left text-xs text-muted">
            <th scope="col" className="px-3 py-2 font-semibold">Script</th>
            <th scope="col" className="px-3 py-2 font-semibold">Size</th>
            <th scope="col" className="px-3 py-2 font-semibold">SHA-256</th>
            <th scope="col" className="px-3 py-2 font-semibold">Confirmation</th>
            <th scope="col" className="px-3 py-2 font-semibold">Last run</th>
          </tr>
        </thead>
        <tbody>
          {scripts.map((script) => (
            <tr key={script.id} aria-current={script.id === selectedId ? "true" : undefined} className={`border-t border-border ${script.id === selectedId ? "bg-brand-50/60 dark:bg-brand-500/10" : ""}`}>
              <td className="px-3 py-2">
                <button type="button" onClick={() => onSelect(script.id)} className="text-left font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">
                  {script.name}
                </button>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{formatSize(script.sizeBytes)}</td>
              <td className="px-3 py-2 font-mono text-xs" title={script.sha256}>
                {script.sha256.slice(0, 12)}…
              </td>
              <td className="px-3 py-2">
                <StatusBadge label={script.confirmed ? "Confirmed" : "Needs confirmation"} tone={script.confirmed ? "success" : "warning"} />
              </td>
              <td className="px-3 py-2">{script.lastRun ? <StatusBadge {...runStatusLabel(script.lastRun)} /> : <span className="text-xs text-muted">None</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
