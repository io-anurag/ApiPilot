import type { UserScriptSummary } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { runStatusLabel } from "../performance/performanceViewModel";
import { DocumentGlyph, ScriptPanel } from "./ScriptPanel";

/** Size as the engineer reads it: bytes below 1 KiB, else KiB with one decimal. */
export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * The session's scripts (AP-034 FR-003): name, size, SHA-256, whether the current content is
 * confirmed (in text, never colour alone), and the last run. Selecting a name opens the script; the
 * open one is marked by a rule at its left edge and by the word "Open" (specs/051-user-script-page-redesign
 * FR-001).
 */
export function ScriptList({
  scripts,
  selectedId,
  onSelect,
}: Readonly<{ scripts: readonly UserScriptSummary[]; selectedId: string | null; onSelect: (scriptId: string) => void }>) {
  return (
    <ScriptPanel
      title="Scripts in this session"
      titleId="user-script-list-title"
      level={2}
      meta="Choose a script to open it. Nothing runs until you confirm a script and press its trigger."
      aside={<span className="text-xs text-muted">{scripts.length === 1 ? "1 script" : `${scripts.length} scripts`}</span>}
      flush
    >
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Scripts in this session</caption>
          <thead>
            <tr className="bg-chrome text-left text-xs text-muted">
              <th scope="col" className="px-4 py-2 font-semibold">Script</th>
              <th scope="col" className="px-3 py-2 font-semibold">Size</th>
              <th scope="col" className="px-3 py-2 font-semibold">SHA-256</th>
              <th scope="col" className="px-3 py-2 font-semibold">Confirmation</th>
              <th scope="col" className="px-3 py-2 font-semibold">Last run</th>
            </tr>
          </thead>
          <tbody>
            {scripts.map((script) => {
              const open = script.id === selectedId;
              return (
                <tr key={script.id} aria-current={open ? "true" : undefined} className={`border-t border-border transition-colors ${open ? "bg-brand-600/10" : "hover:bg-surface-hover"}`}>
                  <td className={`border-l-2 px-4 py-2 ${open ? "border-l-brand-600 dark:border-l-brand-500" : "border-l-transparent"}`}>
                    <span className="flex items-center gap-2">
                      <DocumentGlyph className="h-4 w-4 shrink-0 text-muted" />
                      <button type="button" onClick={() => onSelect(script.id)} className="text-left font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">
                        {script.name}
                      </button>
                      {open && <StatusBadge label="Open" tone="info" />}
                    </span>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </ScriptPanel>
  );
}
