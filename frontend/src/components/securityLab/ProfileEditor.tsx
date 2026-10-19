import { useId, useState } from "react";
import type { CredentialStatus, EnvironmentTier, ProfileView, ProfileViolation, SecurityCategory, TargetEnvironment } from "@apipilot/shared-domain";
import { createEnvironment, createProfile, fetchCredentialStatus, updateProfile } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { IdentityEditor } from "./IdentityEditor";
import {
  TARGET_TIERS,
  TIER_LABEL,
  allowsAddressRanges,
  allowsRelaxedTls,
  draftFromProfile,
  emptyIdentity,
  emptyTestData,
  inputFromDraft,
  isTier,
  parseProfileViolations,
  violationText,
  type ProfileDraft,
  type TestDataDraft,
} from "./profileViewModel";

interface SaveFailure {
  readonly message: string;
  readonly violations: ProfileViolation[];
  /** Fields the form could not read as typed, found before anything was sent. */
  readonly unreadable: string[];
}

/**
 * Creates or edits a security profile (specs/057 FR-034 to FR-040). A profile is session data: the target, the hosts
 * and ports a request may reach, the identities and their write-only credentials, test data, the limits, the
 * categories it permits, whether destructive scenarios are permitted and how cleanup is done. Options a tier does not
 * allow are not offered (address ranges and relaxed TLS are local-only) and are never sent. The server validates
 * everything and its violations are shown by code and text. After a save the editor stays open on the saved profile,
 * so credentials, which can be set only for a saved profile, can be entered next.
 */
export function ProfileEditor({
  initial,
  environments,
  categories,
  onEnvironmentCreated,
  onChanged,
  onClose,
}: Readonly<{
  initial?: ProfileView;
  environments: readonly TargetEnvironment[];
  categories: readonly SecurityCategory[];
  onEnvironmentCreated: (environment: TargetEnvironment) => void;
  /** A profile was saved, or a credential changed: the list should be read again. */
  onChanged: () => void;
  onClose: () => void;
}>) {
  const base = useId();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(initial?.profile));
  const [saved, setSaved] = useState<ProfileView | undefined>(initial);
  const [status, setStatus] = useState<readonly CredentialStatus[]>(initial?.credentialStatus ?? []);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [targetForm, setTargetForm] = useState<{ name: string; tier: EnvironmentTier; baseUrl: string } | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  const environment = environments.find((candidate) => candidate.id === draft.environmentId);
  const tier = environment?.tier;
  const profileId = saved?.profile.id;
  const executableCategories = categories.filter((category) => category.executable);
  const identityNames = draft.identities.map((identity) => identity.name.trim()).filter((name) => name !== "");

  const set = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSavedNotice(false);
  };

  async function refreshStatus() {
    if (!profileId) return;
    const result = await fetchCredentialStatus(profileId);
    if (result.ok) setStatus(result.data.credentialStatus);
    onChanged();
  }

  async function save() {
    const { input, errors } = inputFromDraft(draft, tier);
    if (!input) {
      setFailure({ message: "Some fields could not be read.", violations: [], unreadable: errors.map((entry) => `${entry.field}: ${entry.message}`) });
      return;
    }
    setSaving(true);
    setFailure(null);
    const result = profileId ? await updateProfile(profileId, input) : await createProfile(input);
    setSaving(false);
    if (!result.ok) {
      setFailure({ message: result.message, violations: result.error === "profile_invalid" ? parseProfileViolations(result.details) : [], unreadable: [] });
      return;
    }
    setSaved(result.data);
    setStatus(result.data.credentialStatus);
    setSavedNotice(true);
    onChanged();
  }

  async function createTarget() {
    if (!targetForm) return;
    setTargetError(null);
    const result = await createEnvironment({ name: targetForm.name.trim(), tier: targetForm.tier, baseUrl: targetForm.baseUrl.trim() });
    if (!result.ok) {
      setTargetError(result.message);
      return;
    }
    onEnvironmentCreated(result.data.environment);
    set("environmentId", result.data.environment.id);
    setTargetForm(null);
  }

  const toggleCategory = (id: string, checked: boolean) =>
    set("permittedCategories", checked ? [...draft.permittedCategories, id] : draft.permittedCategories.filter((entry) => entry !== id));
  const updateTestData = (key: string, patch: Partial<TestDataDraft>) =>
    set("testData", draft.testData.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));

  const field = (id: string, label: string, help?: string) => (
    <label htmlFor={`${base}-${id}`} className="text-sm font-medium text-text-primary">
      {label}
      {help && <span className="block text-xs font-normal text-text-secondary">{help}</span>}
    </label>
  );

  return (
    <form
      aria-label={profileId ? "Edit profile" : "New profile"}
      data-testid="profile-editor"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) void save();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {field("name", "Profile name")}
        <input id={`${base}-name`} type="text" value={draft.name} onChange={(event) => set("name", event.target.value)} autoComplete="off" className={`${FIELD_STYLES} w-full min-w-0 max-w-md`} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-text-primary">Target</legend>
        <p className="text-xs text-text-secondary">
          The target holds a name, a tier and a base URL only. Production targets are always refused.
        </p>
        <div className="flex min-w-0 flex-col gap-1">
          {field("environment", "Target environment")}
          <select id={`${base}-environment`} value={draft.environmentId} onChange={(event) => set("environmentId", event.target.value)} className={`${FIELD_STYLES} w-full min-w-0 max-w-md`}>
            <option value="">Choose a target</option>
            {environments.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({TIER_LABEL[candidate.tier]}, {candidate.baseUrl})
              </option>
            ))}
          </select>
        </div>
        {environment && (
          <p className="text-sm text-text-secondary" data-testid="target-summary">
            Tier: {TIER_LABEL[environment.tier]}. Base URL: <span className="break-all font-mono text-xs">{environment.baseUrl}</span>
          </p>
        )}
        {targetForm ? (
          <div className="space-y-2 rounded-md border border-border p-3" role="group" aria-label="New target">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${base}-t-name`} className="text-xs font-medium text-text-secondary">Target name</label>
                <input id={`${base}-t-name`} type="text" value={targetForm.name} onChange={(event) => setTargetForm({ ...targetForm, name: event.target.value })} className={`${FIELD_STYLES} w-full min-w-0`} />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${base}-t-tier`} className="text-xs font-medium text-text-secondary">Tier</label>
                <select id={`${base}-t-tier`} value={targetForm.tier} onChange={(event) => isTier(event.target.value) && setTargetForm({ ...targetForm, tier: event.target.value })} className={`${FIELD_STYLES} w-full min-w-0`}>
                  {TARGET_TIERS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {TIER_LABEL[candidate]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${base}-t-url`} className="text-xs font-medium text-text-secondary">Base URL (no credentials in it)</label>
                <input id={`${base}-t-url`} type="url" value={targetForm.baseUrl} onChange={(event) => setTargetForm({ ...targetForm, baseUrl: event.target.value })} autoComplete="off" spellCheck={false} className={`${FIELD_STYLES} w-full min-w-0 font-mono`} />
              </div>
            </div>
            {targetError && <ErrorState testId="target-error" message="The target was not created" detail={targetError} />}
            <div className="flex gap-2">
              <button type="button" onClick={() => void createTarget()} className={BUTTON_STYLES.secondary}>
                Create target
              </button>
              <button type="button" onClick={() => setTargetForm(null)} className={BUTTON_STYLES.secondary}>
                Cancel new target
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setTargetForm({ name: "", tier: "local", baseUrl: "" })} className={BUTTON_STYLES.secondary}>
            Create a new target
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-text-primary">Where requests may go</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            {field("hosts", "Allowed hosts", "One per line. A bare host name or IP address: no scheme, port, path or wildcard.")}
            <textarea id={`${base}-hosts`} rows={3} value={draft.allowedHosts} onChange={(event) => set("allowedHosts", event.target.value)} spellCheck={false} className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {field("ports", "Allowed ports", "Comma-separated, such as 443, 8443.")}
            <input id={`${base}-ports`} type="text" value={draft.allowedPorts} onChange={(event) => set("allowedPorts", event.target.value)} autoComplete="off" className={`${FIELD_STYLES} w-full min-w-0 font-mono`} />
          </div>
        </div>
        {allowsAddressRanges(tier) ? (
          <div className="flex min-w-0 flex-col gap-1">
            {field("ranges", "Allowed address ranges (local target only)", "One per line: an IP address or a CIDR range such as 127.0.0.1 or 10.0.0.0/8.")}
            <textarea id={`${base}-ranges`} rows={2} value={draft.allowedAddressRanges} onChange={(event) => set("allowedAddressRanges", event.target.value)} spellCheck={false} className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`} />
          </div>
        ) : (
          <p className="text-xs text-text-secondary" data-testid="ranges-local-only">
            Address ranges are offered for a local target only. Other tiers can never reach loopback, private or link-local addresses.
          </p>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          {field("tls", "Certificate verification (TLS)")}
          <select id={`${base}-tls`} value={allowsRelaxedTls(tier) ? draft.tlsPolicy : "verify"} onChange={(event) => set("tlsPolicy", event.target.value === "relaxed-local" ? "relaxed-local" : "verify")} className={`${FIELD_STYLES} w-full min-w-0 max-w-md`}>
            <option value="verify">Verify certificates</option>
            {allowsRelaxedTls(tier) && <option value="relaxed-local">Relaxed, for a local target with a self-signed certificate</option>}
          </select>
          {!allowsRelaxedTls(tier) && <p className="text-xs text-text-secondary">Relaxed verification is offered for a local target only.</p>}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-text-primary">Identities</legend>
        {draft.identities.length === 0 && <p className="text-sm text-text-secondary">No identities. Add one if a scenario needs to authenticate or to act as a particular user.</p>}
        {draft.identities.map((identity, index) => (
          <IdentityEditor
            key={identity.key}
            draft={identity}
            index={index}
            onChange={(next) => set("identities", draft.identities.map((entry) => (entry.key === identity.key ? next : entry)))}
            onRemove={() => set("identities", draft.identities.filter((entry) => entry.key !== identity.key))}
            profileId={profileId}
            status={status}
            onStatusChanged={() => void refreshStatus()}
          />
        ))}
        <button type="button" onClick={() => set("identities", [...draft.identities, emptyIdentity()])} className={BUTTON_STYLES.secondary}>
          Add an identity
        </button>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-text-primary">Test data</legend>
        <p className="text-xs text-text-secondary">Non-secret values such as a resource id, shown back in plain text. A value that looks like a credential is refused.</p>
        {draft.testData.map((entry, index) => (
          <div key={entry.key} role="group" aria-label={`Test data ${index + 1}`} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-4" data-testid="test-data-row">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${base}-td-${entry.key}-owner`} className="text-xs font-medium text-text-secondary">Owned by identity</label>
              <select id={`${base}-td-${entry.key}-owner`} value={entry.ownerIdentity} onChange={(event) => updateTestData(entry.key, { ownerIdentity: event.target.value })} className={`${FIELD_STYLES} w-full min-w-0`}>
                <option value="">Choose an identity</option>
                {identityNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${base}-td-${entry.key}-op`} className="text-xs font-medium text-text-secondary">Operation (optional)</label>
              <input id={`${base}-td-${entry.key}-op`} type="text" value={entry.operationKey} onChange={(event) => updateTestData(entry.key, { operationKey: event.target.value })} className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${base}-td-${entry.key}-param`} className="text-xs font-medium text-text-secondary">Parameter</label>
              <input id={`${base}-td-${entry.key}-param`} type="text" value={entry.parameter} onChange={(event) => updateTestData(entry.key, { parameter: event.target.value })} className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${base}-td-${entry.key}-value`} className="text-xs font-medium text-text-secondary">Value</label>
              <input id={`${base}-td-${entry.key}-value`} type="text" value={entry.value} onChange={(event) => updateTestData(entry.key, { value: event.target.value })} autoComplete="off" className={`${FIELD_STYLES} w-full min-w-0 font-mono text-xs`} />
            </div>
            <div className="sm:col-span-4">
              <button type="button" onClick={() => set("testData", draft.testData.filter((candidate) => candidate.key !== entry.key))} className={BUTTON_STYLES.secondary}>
                Remove test data {index + 1}
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => set("testData", [...draft.testData, emptyTestData()])} className={BUTTON_STYLES.secondary}>
          Add test data
        </button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-text-primary">Limits</legend>
        <p className="text-xs text-text-secondary">A run can lower these but never raise them. A value above the server&apos;s ceiling is refused, and the refusal names the ceiling.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1">
            {field("max-requests", "Most requests per run")}
            <input id={`${base}-max-requests`} type="number" min={1} inputMode="numeric" value={draft.maxRequests} onChange={(event) => set("maxRequests", event.target.value)} className={`${FIELD_STYLES} w-full min-w-0`} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {field("max-concurrency", "Most requests at once")}
            <input id={`${base}-max-concurrency`} type="number" min={1} inputMode="numeric" value={draft.maxConcurrency} onChange={(event) => set("maxConcurrency", event.target.value)} className={`${FIELD_STYLES} w-full min-w-0`} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {field("timeout", "Timeout per request (milliseconds)")}
            <input id={`${base}-timeout`} type="number" min={1} inputMode="numeric" value={draft.timeoutMs} onChange={(event) => set("timeoutMs", event.target.value)} className={`${FIELD_STYLES} w-full min-w-0`} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-text-primary">Permitted categories</legend>
        <p className="text-xs text-text-secondary">Only categories that can run are listed. A scenario of any other category cannot be run with this profile.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {executableCategories.map((category) => (
            <label key={category.id} className="flex items-center gap-1.5 text-sm text-text-primary">
              <input type="checkbox" className="h-4 w-4 rounded border-border-control" checked={draft.permittedCategories.includes(category.id)} onChange={(event) => toggleCategory(category.id, event.target.checked)} />
              {category.name}
            </label>
          ))}
          {executableCategories.length === 0 && <p className="text-sm text-text-secondary">The category list is not available yet.</p>}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-text-primary">Destructive scenarios and cleanup</legend>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" className="h-4 w-4 rounded border-border-control" checked={draft.destructivePermitted} onChange={(event) => set("destructivePermitted", event.target.checked)} />
          Permit destructive scenarios (each is still confirmed by name before a run)
        </label>
        <div className="flex min-w-0 flex-col gap-1">
          {field("cleanup", "Cleanup after a run")}
          <select id={`${base}-cleanup`} value={draft.cleanupStrategy} onChange={(event) => set("cleanupStrategy", event.target.value === "delete-created-via-spec" ? "delete-created-via-spec" : "none")} className={`${FIELD_STYLES} w-full min-w-0 max-w-md`}>
            <option value="none">No cleanup</option>
            <option value="delete-created-via-spec">Delete what a scenario creates, using the delete operation in the specification</option>
          </select>
        </div>
        {draft.cleanupStrategy === "delete-created-via-spec" && (
          <div className="flex min-w-0 flex-col gap-1">
            {field("cleanup-id", "Response field holding the id of what was created")}
            <input id={`${base}-cleanup-id`} type="text" value={draft.cleanupIdField} onChange={(event) => set("cleanupIdField", event.target.value)} autoComplete="off" className={`${FIELD_STYLES} w-full min-w-0 max-w-md font-mono`} />
          </div>
        )}
      </fieldset>

      {failure && (
        <ErrorState
          testId="profile-error"
          message={failure.violations.length > 0 ? "The profile is not valid. Fix each listed problem and save again." : failure.unreadable.length > 0 ? "Some fields could not be read" : "The profile was not saved"}
          detail={failure.violations.length > 0 || failure.unreadable.length > 0 ? undefined : failure.message}
        >
          {(failure.violations.length > 0 || failure.unreadable.length > 0) && (
            <ul className="list-disc pl-5" aria-label="Violations">
              {failure.unreadable.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {failure.violations.map((violation) => (
                <li key={`${violation.field}-${violation.code}-${violation.message}`}>{violationText(violation)}</li>
              ))}
            </ul>
          )}
        </ErrorState>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={BUTTON_STYLES.primary}>
          {saving ? "Saving..." : profileId ? "Save changes" : "Save profile"}
        </button>
        <button type="button" onClick={onClose} className={BUTTON_STYLES.secondary}>
          Close
        </button>
        {savedNotice && (
          <span role="status" className="text-sm text-text-secondary">
            Saved. {saved && saved.credentialStatus.length > 0 ? "Credentials can be set above." : "Add a security scheme to an identity to set a credential."}
          </span>
        )}
      </div>
    </form>
  );
}
