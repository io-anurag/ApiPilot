import { useEffect, useRef } from "react";
import { BUTTON_STYLES } from "../controlStyles";
import { Dialog } from "../Dialog";

/** AP-034 FR-014: the statements the confirmation must make, word for word in tests. */
export const CONFIRM_NOT_VERIFIED = "This script was not written or verified by ApiPilot.";
export const CONFIRM_RUN_TIME_HOSTS = "Hosts built while the script runs cannot be listed.";
export const CONFIRM_CANNOT_RESTRICT = "ApiPilot cannot restrict where the script sends requests.";

/**
 * The explicit confirmation of one script's exact content (AP-034 FR-013 to FR-015; constitution
 * XVII, 2026-09-30). It names the SHA-256 it confirms, lists every host the check found, and states
 * plainly what ApiPilot cannot check. Cancel is focused first, so Enter never confirms by accident.
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
    <Dialog role="alertdialog" labelledBy="script-confirm-title" testId="script-confirm-dialog" onClose={onCancel} panelClassName="w-full max-w-xl space-y-4 rounded-lg border border-warning-300 bg-surface p-5 shadow-xl dark:border-warning-500">
      <h3 id="script-confirm-title" className="text-base font-semibold">
        Confirm {scriptName} before it runs
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>{CONFIRM_NOT_VERIFIED}</li>
        <li>{CONFIRM_CANNOT_RESTRICT}</li>
        <li>{CONFIRM_RUN_TIME_HOSTS}</li>
      </ul>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted">Hosts written in the script</p>
        {hosts.length === 0 ? (
          <p className="text-sm">None were found in the script text.</p>
        ) : (
          <ul className="space-y-0.5 font-mono text-xs">
            {hosts.map((host) => (
              <li key={host}>{host}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">
        You confirm exactly this content, SHA-256 <span className="break-all font-mono">{sha256}</span>. Any change to it needs a new confirmation.
      </p>
      <div className="flex justify-end gap-2">
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
