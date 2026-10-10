import { useEffect, useId, useRef } from "react";
import { Dialog } from "./Dialog";
import { RESULTS_VIEWS, WORKFLOWS } from "./workflowCatalog";

/**
 * The header's help dialog (AP-038 US4, FR-021): the keyboard shortcuts and what each workflow is
 * for, read from the shared workflow catalog so the descriptions match the start screen.
 */
export function HelpDialog({
  shortcutHint,
  onClose,
}: Readonly<{ shortcutHint: string; onClose: () => void }>) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const shortcuts: ReadonlyArray<readonly [keys: string, action: string]> = [
    [shortcutHint, "Open the command palette"],
    ["Esc", "Close a dialog or the palette"],
    ["↑ ↓ and Enter", "Move and choose in the palette"],
  ];

  return (
    <Dialog
      labelledBy={titleId}
      testId="help-dialog"
      onClose={onClose}
      onBackdropClick={onClose}
      panelClassName="w-full max-w-xl space-y-5 rounded-xl border border-border bg-surface p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="font-display text-lg font-bold text-text-primary">
          Keyboard shortcuts and workflows
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-2.5 py-1 text-sm font-medium text-text-secondary hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Close
        </button>
      </div>

      <table aria-label="Keyboard shortcuts" className="w-full text-sm">
        <tbody>
          {shortcuts.map(([keys, action]) => (
            <tr key={action} className="border-b border-border last:border-0">
              <th scope="row" className="w-40 py-2 pr-4 text-left font-normal">
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-text-primary">
                  {keys}
                </kbd>
              </th>
              <td className="py-2 text-text-secondary">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby={`${titleId}-workflows`} className="space-y-2">
        <h3 id={`${titleId}-workflows`} className="text-sm font-semibold text-text-primary">
          Workflows
        </h3>
        <ul className="space-y-2.5">
          {WORKFLOWS.map((workflow) => (
            <li key={workflow.id} className="flex gap-3 text-sm">
              <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${workflow.tone.marker}`} />
              <span>
                <span className="font-medium text-text-primary">{workflow.title}</span>
                <span className="block hyphens-auto text-justify text-muted">{workflow.description}</span>
              </span>
            </li>
          ))}
          {RESULTS_VIEWS.map((view) => (
            <li key={view.id} className="flex gap-3 text-sm">
              <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${view.marker}`} />
              <span>
                <span className="font-medium text-text-primary">{view.title}</span>
                <span className="block hyphens-auto text-justify text-muted">{view.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}
