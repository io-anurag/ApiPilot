import { useId, useState } from "react";
import type { CredentialStatus } from "@apipilot/shared-domain";
import { setCredential } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { parseList, type IdentityDraft } from "./profileViewModel";

type Kind = "active" | "expired";

const KIND_LABEL: Readonly<Record<Kind, string>> = { active: "Active credential", expired: "Expired credential" };

/**
 * One credential of one identity (specs/057 FR-038, FR-048, research R8). The field is write-only: it takes a value,
 * sends it once and is emptied the moment the save succeeds, and the only thing ever shown back is "Set" or "Not set".
 * The value is held in this component's state only while it is being typed; it is never logged, stored in the draft
 * of the profile, or returned by any route. An empty value clears the credential through the same route.
 */
function CredentialRow({
  profileId,
  identity,
  scheme,
  kind,
  set,
  onStatusChanged,
}: Readonly<{
  profileId: string;
  identity: string;
  scheme: string;
  kind: Kind;
  set: boolean;
  onStatusChanged: () => void;
}>) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "cleared" | null>(null);

  async function send(next: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    const result = await setCredential(profileId, { identity, scheme, kind, value: next });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setValue("");
    setSaved(next === "" ? "cleared" : "saved");
    onStatusChanged();
  }

  return (
    <li className="space-y-1 rounded-md border border-border p-2" data-testid="credential-row" data-scheme={scheme} data-kind={kind}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-text-primary">
          {KIND_LABEL[kind]} for <span className="font-mono text-xs">{scheme}</span>
        </span>
        <StatusBadge label={set ? "Set" : "Not set"} tone={set ? "success" : "neutral"} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-xs font-medium text-text-secondary">
            New {kind} value for {scheme} (write-only)
          </label>
          <input
            id={inputId}
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className={`${FIELD_STYLES} w-full font-mono`}
          />
        </div>
        <button type="button" onClick={() => void send(value)} disabled={busy || value === ""} className={BUTTON_STYLES.secondary}>
          Save credential
        </button>
        <button type="button" onClick={() => void send("")} disabled={busy || !set} className={BUTTON_STYLES.secondary}>
          Clear credential
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger-700 dark:text-danger-100">
          The credential was not saved: {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-text-secondary">
          {saved === "saved" ? "Saved. The value was sent to the server and is no longer held here." : "Cleared."}
        </p>
      )}
    </li>
  );
}

/**
 * One test identity of a profile (specs/057 FR-034, FR-035): a name, a role, and the security schemes it holds a
 * credential for, active and known-expired. Credentials are set only for a saved profile and only for schemes the
 * saved profile declares; until then the editor says so rather than offering a field that would be refused.
 */
export function IdentityEditor({
  draft,
  index,
  onChange,
  onRemove,
  profileId,
  status,
  onStatusChanged,
}: Readonly<{
  draft: IdentityDraft;
  index: number;
  onChange: (next: IdentityDraft) => void;
  onRemove: () => void;
  /** Present once the profile is saved; credentials cannot be set before. */
  profileId: string | undefined;
  status: readonly CredentialStatus[];
  onStatusChanged: () => void;
}>) {
  const base = useId();
  const active = parseList(draft.credentialSchemes);
  const expired = parseList(draft.expiredCredentialSchemes);
  const label = draft.name.trim() || `Identity ${index + 1}`;

  const rows: Array<{ scheme: string; kind: Kind }> = [
    ...active.map((scheme) => ({ scheme, kind: "active" as const })),
    ...expired.map((scheme) => ({ scheme, kind: "expired" as const })),
  ];
  const known = (scheme: string, kind: Kind): CredentialStatus | undefined =>
    status.find((entry) => entry.identity === draft.name.trim() && entry.scheme === scheme && entry.kind === kind);

  return (
    <fieldset className="space-y-3 rounded-lg border border-border-strong p-3" data-testid="identity-editor">
      <legend className="px-1 text-sm font-semibold text-text-primary">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-name`} className="text-xs font-medium text-text-secondary">
            Identity name (letters, digits, . _ - and single spaces)
          </label>
          <input id={`${base}-name`} type="text" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} autoComplete="off" className={`${FIELD_STYLES} w-full min-w-0`} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-role`} className="text-xs font-medium text-text-secondary">
            Role (for example owner or other-user)
          </label>
          <input id={`${base}-role`} type="text" value={draft.role} onChange={(event) => onChange({ ...draft, role: event.target.value })} autoComplete="off" className={`${FIELD_STYLES} w-full min-w-0`} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-active`} className="text-xs font-medium text-text-secondary">
            Security schemes with an active credential (one per line, names from the specification)
          </label>
          <textarea
            id={`${base}-active`}
            rows={2}
            value={draft.credentialSchemes}
            onChange={(event) => onChange({ ...draft, credentialSchemes: event.target.value })}
            spellCheck={false}
            className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-expired`} className="text-xs font-medium text-text-secondary">
            Security schemes with a known-expired credential (one per line)
          </label>
          <textarea
            id={`${base}-expired`}
            rows={2}
            value={draft.expiredCredentialSchemes}
            onChange={(event) => onChange({ ...draft, expiredCredentialSchemes: event.target.value })}
            spellCheck={false}
            className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`}
          />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted">Credentials for {label}</p>
          <p className="text-xs text-text-secondary">
            Values are write-only: the server stores them for this session only and never shows one. Only whether each is set is shown.
          </p>
          <ul className="space-y-2" aria-label={`Credentials for ${label}`}>
            {rows.map(({ scheme, kind }) => {
              const entry = known(scheme, kind);
              if (!profileId || !entry) {
                return (
                  <li key={`${kind}-${scheme}`} className="flex flex-wrap items-center gap-2 text-sm text-text-secondary" data-testid="credential-pending">
                    <StatusBadge label="Not set" tone="neutral" />
                    <span>
                      {KIND_LABEL[kind]} for <span className="font-mono text-xs">{scheme}</span>: save the profile with this scheme to set it.
                    </span>
                  </li>
                );
              }
              return <CredentialRow key={`${kind}-${scheme}`} profileId={profileId} identity={draft.name.trim()} scheme={scheme} kind={kind} set={entry.set} onStatusChanged={onStatusChanged} />;
            })}
          </ul>
        </div>
      )}

      <button type="button" onClick={onRemove} className={BUTTON_STYLES.secondary}>
        Remove {label}
      </button>
    </fieldset>
  );
}
