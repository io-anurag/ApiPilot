import { useState } from "react";
import type { ProfileCheck, ProfileView } from "@apipilot/shared-domain";
import { checkProfile, deleteProfile } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { VALIDITY, credentialSummary, violationText } from "./profileViewModel";

type CheckState = { kind: "checking" } | { kind: "done"; check: ProfileCheck } | { kind: "failed"; message: string };

/** What a check found, as text: whether it passed, where a request would go and why a blocked destination is blocked. */
function CheckResult({ state }: Readonly<{ state: CheckState }>) {
  if (state.kind === "checking") return <p role="status" className="text-sm text-text-secondary">Checking: resolving the host. No request is sent to the target.</p>;
  if (state.kind === "failed") return <ErrorState testId="profile-check-error" message="The check could not be completed" detail={state.message} />;
  const { check } = state;
  const destination = check.destination;
  return (
    <div className="space-y-1 text-sm" data-testid="profile-check-result">
      <p role="status" className="font-medium text-text-primary">
        {check.valid ? "Check passed: the profile is valid and its destination is allowed." : "Check failed: the profile cannot be used as it is."}
      </p>
      {destination && (
        <p className="text-text-secondary">
          Destination <span className="font-mono text-xs">{destination.host}:{destination.port}</span>
          {destination.resolvedClass ? `, address class ${destination.resolvedClass}` : ""}
          {destination.connectTo ? `, a request would connect to ${destination.connectTo}` : ""}.
          {destination.blockedReason ? ` Blocked (${destination.blockedReason}): ${destination.explanation ?? ""}` : ""}
        </p>
      )}
      {check.problems.length > 0 && (
        <ul className="list-disc pl-5 text-text-secondary" aria-label="Problems found by the check">
          {check.problems.map((problem) => (
            <li key={`${problem.field}-${problem.code}`}>{violationText(problem)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The profiles as a semantic table (specs/057 FR-034, FR-040): each profile's target, whether it is valid right now
 * (validity is judged again on every read, because the specification and the target can change) and every problem as
 * text with its code, how many credentials are set, and the actions: use it for a run, check it without sending
 * anything, edit it, delete it. An invalid profile cannot be chosen for a run, and the reason is on the row.
 */
export function ProfileList({
  profiles,
  selectedId,
  onSelect,
  onEdit,
  onDeleted,
}: Readonly<{
  profiles: readonly ProfileView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDeleted: (id: string) => void;
}>) {
  const [checks, setChecks] = useState<Readonly<Record<string, CheckState>>>({});
  const [deleting, setDeleting] = useState<ProfileView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function check(id: string) {
    setChecks((current) => ({ ...current, [id]: { kind: "checking" } }));
    const result = await checkProfile(id);
    setChecks((current) => ({ ...current, [id]: result.ok ? { kind: "done", check: result.data } : { kind: "failed", message: result.message } }));
  }

  async function confirmDelete(view: ProfileView) {
    setDeleting(null);
    setDeleteError(null);
    const result = await deleteProfile(view.profile.id);
    if (!result.ok) {
      setDeleteError(result.message);
      return;
    }
    onDeleted(view.profile.id);
  }

  if (profiles.length === 0) {
    return <EmptyState message="There are no profiles yet." description="A profile names the target, the hosts a request may reach, the identities and the limits. Create one to run approved scenarios." testId="profile-list-empty" />;
  }

  return (
    <div className="space-y-3" data-testid="profile-list">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Security profiles">
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">Security profiles with their target, validity, problems and credentials</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Profile</th>
              <th scope="col" className={TABLE_STYLES.th}>Target</th>
              <th scope="col" className={TABLE_STYLES.th}>Validity</th>
              <th scope="col" className={TABLE_STYLES.th}>Credentials</th>
              <th scope="col" className={TABLE_STYLES.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((view) => {
              const selected = view.profile.id === selectedId;
              const validity = view.valid ? VALIDITY.valid : VALIDITY.invalid;
              const state = checks[view.profile.id];
              return (
                <tr key={view.profile.id} data-testid="profile-row" data-profile-id={view.profile.id} className={selected ? "bg-surface-subtle" : undefined}>
                  <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>
                    {view.profile.name}
                    {selected && <span className="ml-2 text-xs font-normal text-text-secondary">(chosen for the run)</span>}
                  </th>
                  <td className={TABLE_STYLES.td}>
                    {view.environment ? (
                      <>
                        <span className="block">
                          {view.environment.name} <StatusBadge label={view.environment.tier} />
                        </span>
                        <span className="block break-all font-mono text-xs text-text-secondary">{view.environment.baseUrl}</span>
                      </>
                    ) : (
                      <span className="text-text-secondary">The target no longer exists</span>
                    )}
                  </td>
                  <td className={`${TABLE_STYLES.td} max-w-md`}>
                    <StatusBadge label={validity.label} tone={validity.tone} />
                    {view.problems.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-text-secondary" aria-label={`Problems with ${view.profile.name}`}>
                        {view.problems.map((problem) => (
                          <li key={`${problem.field}-${problem.code}`}>{violationText(problem)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={TABLE_STYLES.td}>{credentialSummary(view.credentialStatus)}</td>
                  <td className={TABLE_STYLES.td}>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(view.profile.id)}
                        disabled={!view.valid}
                        aria-pressed={selected}
                        aria-label={`Use ${view.profile.name} for a run`}
                        className={BUTTON_STYLES.secondary}
                      >
                        {selected ? "Chosen" : "Use for a run"}
                      </button>
                      <button type="button" onClick={() => void check(view.profile.id)} aria-label={`Check ${view.profile.name}`} className={BUTTON_STYLES.secondary}>
                        Check
                      </button>
                      <button type="button" onClick={() => onEdit(view.profile.id)} aria-label={`Edit ${view.profile.name}`} className={BUTTON_STYLES.secondary}>
                        Edit
                      </button>
                      <button type="button" onClick={() => setDeleting(view)} aria-label={`Delete ${view.profile.name}`} className={BUTTON_STYLES.secondary}>
                        Delete
                      </button>
                    </div>
                    {!view.valid && <p className="mt-1 text-xs text-text-secondary">Not available for a run until the problems above are fixed.</p>}
                    {state && (
                      <div className="mt-2">
                        <CheckResult state={state} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {deleteError && <ErrorState testId="profile-delete-error" message="The profile was not deleted" detail={deleteError} />}
      {deleting && (
        <ConfirmDialog
          message={`Delete the profile "${deleting.profile.name}"?`}
          affectedCount={1}
          confirmLabel="Delete profile"
          details={<p className="text-sm text-text-secondary">Its credentials are removed with it. Scenarios and earlier run summaries are kept.</p>}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
