import { useEffect, useRef } from "react";
import { BUTTON_STYLES } from "../controlStyles";
import { Dialog } from "../Dialog";

/** AP-034 FR-014: the statements the confirmation must make, word for word in tests. */
export const CONFIRM_NOT_VERIFIED = "This script was not written or verified by ApiPilot.";
export const CONFIRM_RUN_TIME_HOSTS = "Hosts built while the script runs cannot be listed.";
export const CONFIRM_CANNOT_RESTRICT = "ApiPilot cannot restrict where the script sends requests.";

/**
 * The explicit confirmation of one script's exact content (AP-034 FR-013 to FR-015; constitution
 * XVII, 2026-09-30; layout: specs/051-user-script-page-redesign FR-006). It names the SHA-256 it
 * confirms, lists every host the check found, and states plainly what ApiPilot cannot check. Cancel is
 * focused first, so Enter never confirms by accident.
 */
export function ScriptConfirmDialog({
  scriptName,
  sha256,
  hosts,
  confirming,
  onConfirm,
  onCancel,
}: Readonly<{ scriptName: string; sha256: string; hosts: readonly string[]; confirming: boolean; onConfirm: () => void; onCancel: () => void }>) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <Dialog role="alertdialog" labelledBy="script-confirm-title" testId="script-confirm-dialog" onClose={onCancel} panelClassName="w-full max-w-xl overflow-hidden rounded-xl border border-warning-300 bg-surface shadow-xl dark:border-warning-500">
      <div className="h-1 bg-warning-600 dark:bg-warning-500" />
      <div className="flex items-start gap-3 border-b border-border bg-surface-subtle px-5 py-4">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-warning-600/40 bg-warning-600/15 text-base font-bold text-text-primary">
          !
        </span>
        <div className="min-w-0">
          <h3 id="script-confirm-title" className="break-words text-base font-semibold text-text-primary">
            Confirm {scriptName} before it runs
          </h3>
          <p className="mt-0.5 text-xs text-muted">Read these three points. Confirming approves exactly the content named below.</p>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <ul className="space-y-2 rounded-lg border border-warning-600/30 bg-warning-600/10 px-4 py-3 text-sm text-text-primary">
          <li>{CONFIRM_NOT_VERIFIED}</li>
          <li>{CONFIRM_CANNOT_RESTRICT}</li>
          <li>{CONFIRM_RUN_TIME_HOSTS}</li>
        </ul>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase text-muted">Hosts written in the script</p>
          {hosts.length === 0 ? (
            <p className="text-sm">None were found in the script text.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {hosts.map((host) => (
                <li key={host} className="break-all rounded-md border border-border bg-surface-subtle px-2 py-1 font-mono text-xs">
                  {host}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase text-muted">You confirm exactly this content (SHA-256)</p>
          <p className="break-all rounded-md border border-code-border bg-code-surface px-3 py-2 font-mono text-xs text-code-text">
            <span>{sha256}</span>
          </p>
          <p className="text-xs text-muted">Any change to the script needs a new confirmation.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-chrome px-5 py-3">
        <button type="button" ref={cancelRef} className={BUTTON_STYLES.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={BUTTON_STYLES.warning} disabled={confirming} onClick={onConfirm}>
          {confirming ? "Confirming…" : "Confirm this script"}
        </button>
      </div>
    </Dialog>
  );
}
