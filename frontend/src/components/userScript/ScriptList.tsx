import type { UserScriptSummary } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { Pill } from "../patterns/Pill";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { runStatusLabel } from "../performance/performanceViewModel";
import { DocumentGlyph, ScriptPanel } from "./ScriptPanel";

/** Size as the engineer reads it: bytes below 1 KiB, else KiB with one decimal. */
export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * The session's scripts (AP-034 FR-003): name, size, SHA-256, whether the current content is
 * confirmed (in text, never colour alone), and the last run. Selecting a name opens the script; the
 * open one is marked by the word "Open", a pale-lime row and a brand edge at its left (AP-054 FR-013,
 * FR-017: the table scrolls inside its card).
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
    >
      <div
        role="region"
        aria-label="Scripts table"
        // Focusable so a keyboard user can scroll a wide table.
        tabIndex={0}
        className={`${TABLE_STYLES.scroll} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
      >
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">Scripts in this session</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Script</th>
              <th scope="col" className={TABLE_STYLES.th}>Size</th>
              <th scope="col" className={TABLE_STYLES.th}>SHA-256</th>
              <th scope="col" className={TABLE_STYLES.th}>Confirmation</th>
              <th scope="col" className={TABLE_STYLES.th}>Last run</th>
            </tr>
          </thead>
          <tbody>
            {scripts.map((script) => {
              const open = script.id === selectedId;
              return (
                <tr key={script.id} aria-current={open ? "true" : undefined} className={`motion-safe:transition-colors ${open ? "bg-lime-pale" : "hover:bg-surface-hover"}`}>
                  <td className={`${TABLE_STYLES.td} border-l-2 ${open ? "border-l-brand-500" : "border-l-transparent"}`}>
                    <span className="flex items-center gap-2">
                      <DocumentGlyph className="h-4 w-4 shrink-0 text-muted" />
                      <button type="button" onClick={() => onSelect(script.id)} className="text-left font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        {script.name}
                      </button>
                      {open && <Pill tone="accent">Open</Pill>}
                    </span>
                  </td>
                  <td className={TABLE_STYLES.tdMono}>{formatSize(script.sizeBytes)}</td>
                  <td className={TABLE_STYLES.tdMono} title={script.sha256}>
                    {script.sha256.slice(0, 12)}…
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={script.confirmed ? "Confirmed" : "Needs confirmation"} tone={script.confirmed ? "success" : "warning"} />
                  </td>
                  <td className={TABLE_STYLES.td}>{script.lastRun ? <StatusBadge {...runStatusLabel(script.lastRun)} /> : <span className="text-xs text-muted">None</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ScriptPanel>
  );
}
