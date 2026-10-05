import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Environment, MappedValueStatus, ScriptProblem, UserScript, UserScriptRun, UserScriptRunSummary, UserScriptThresholdScope } from "@apipilot/shared-domain";
import { LOAD_PROFILE_STARTING_STAGES } from "@apipilot/shared-domain";
import { fetchEnvironments } from "../../services/environmentsClient";
import { userScriptClient, userScriptRunsClient, type UserScriptSettingsInput, type UserScriptStartInput } from "../../services/userScriptClient";
import { BUTTON_STYLES } from "../controlStyles";
import { CodeBlock } from "../CodeBlock";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import { PromptDialog } from "../PromptDialog";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { Tabs } from "../Tabs";
import { EnvironmentPicker } from "../performance/EnvironmentPicker";
import { LoadProfileEditor } from "../performance/LoadProfileEditor";
import { ThresholdEditor } from "../performance/ThresholdEditor";
import { usePerformanceRuns } from "../performance/usePerformanceRuns";
import { ScriptConfirmDialog } from "./ScriptConfirmDialog";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptProblems } from "./ScriptProblems";
import { formatSize } from "./ScriptList";
import { UserScriptRunActivity } from "./UserScriptRunActivity";
import { UserScriptRunTrigger } from "./UserScriptRunTrigger";
import { ValueMappingEditor } from "./ValueMappingEditor";

type WorkspaceTab = "script" | "setup" | "runs";

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "script", label: "Script" },
  { id: "setup", label: "Run setup" },
  { id: "runs", label: "Runs & reports" },
];

export const RUN_TIME_NOTE = "Values built while the script runs cannot be found.";

/**
 * One stored script (AP-034 US1 to US3): its content and check results, its run setup and its
 * runs. Keyed by the script's id, so its runs hook belongs to that script alone. Reports unsaved
 * editor changes to the page, which asks before leaving them (FR-011).
 */
export function ScriptWorkspace({
  scriptId,
  onChanged,
  onDeleted,
  onDirtyChange,
}: Readonly<{
  scriptId: string;
  onChanged: () => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}>) {
  const runsClient = useMemo(() => userScriptRunsClient(scriptId), [scriptId]);
  const runs = usePerformanceRuns<UserScriptRun, UserScriptRunSummary, UserScriptStartInput>(runsClient);
  const [script, setScript] = useState<UserScript | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("script");
  const [pendingTab, setPendingTab] = useState<WorkspaceTab | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [askConfirm, setAskConfirm] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [askRename, setAskRename] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<File | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftProblems, setDraftProblems] = useState<ScriptProblem[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentsError, setEnvironmentsError] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<MappedValueStatus[] | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  const dirty = draft !== null && draft !== content;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    const [detail, text] = await Promise.all([userScriptClient.fetchScript(scriptId), userScriptClient.fetchContent(scriptId)]);
    if (!detail.ok) {
      setLoadError(detail.message);
      return;
    }
    setLoadError(null);
    setScript(detail.script);
    setContent(text.ok ? text.content : null);
  }, [scriptId]);

  const loadEnvironments = useCallback(async () => {
    const result = await fetchEnvironments();
    if (!result.ok) {
      setEnvironmentsError(result.message);
      return;
    }
    setEnvironmentsError(null);
    setEnvironments(result.environments);
    setEnvironmentId((current) => current ?? result.environments[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
    void loadEnvironments();
  }, [load, loadEnvironments]);

  useEffect(() => {
    if (!environmentId || !script) {
      setStatuses(null);
      return;
    }
    let cancelled = false;
    void userScriptClient.fetchValues(scriptId, environmentId).then((result) => {
      if (!cancelled) setStatuses(result.ok ? result.values : null);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, script, scriptId]);

  function applied(next: UserScript, note?: string) {
    setScript(next);
    setActionError(null);
    setMessage(note ?? null);
    onChanged();
  }

  async function saveSettings(change: Partial<UserScriptSettingsInput>) {
    if (!script) return;
    setBusy(true);
    const result = await userScriptClient.saveSettings(script.id, {
      mapping: change.mapping ?? script.settings.mapping.map(({ name, source }) => ({ name, source })),
      removedNames: change.removedNames ?? script.settings.removedNames,
      load: change.load ?? script.settings.load,
      thresholds: change.thresholds ?? script.settings.thresholds.map(({ scope, metric, comparator, limit }) => ({ scope, metric, comparator, limit })),
    });
    setBusy(false);
    if (result.ok) applied(result.script, "Saved. The confirmation is kept: settings never change the script.");
    else setActionError(result.message);
  }

  async function confirm() {
    if (!script) return;
    setConfirming(true);
    const result = await userScriptClient.confirmScript(script.id, script.sha256);
    setConfirming(false);
    setAskConfirm(false);
    if (result.ok) applied(result.script, "Confirmed. The script can run until its content changes.");
    else setActionError(result.message);
  }

  async function saveDraft() {
    if (!script || draft === null) return;
    setBusy(true);
    const result = await userScriptClient.saveContent(script.id, draft, script.sha256);
    setBusy(false);
    if (!result.ok) {
      // FR-011: a refused save stores nothing; the unsaved text stays in the editor.
      setDraftProblems(result.problems ?? []);
      setActionError(result.problems ? null : result.message);
      return;
    }
    setDraft(null);
    setDraftProblems([]);
    setContent(draft);
    applied(result.script, "Saved as a new version. Confirm it before the next run.");
  }

  async function replace(file: File) {
    if (!script) return;
    setBusy(true);
    const result = await userScriptClient.replaceWithUpload(script.id, file, script.sha256);
    setBusy(false);
    if (!result.ok) {
      setDraftProblems(result.problems ?? []);
      setActionError(result.problems ? "The new file was refused. The stored script is unchanged." : result.message);
      return;
    }
    setDraftProblems([]);
    applied(result.script, "Replaced with the uploaded file. Confirm it before the next run.");
    void load();
  }

  async function rename(name: string) {
    if (!script) return;
    setAskRename(false);
    const result = await userScriptClient.renameScript(script.id, name);
    if (result.ok) applied(result.script, "Renamed. The confirmation is kept.");
    else setActionError(result.message);
  }

  async function remove() {
    if (!script) return;
    setAskDelete(false);
    const result = await userScriptClient.deleteScript(script.id);
    if (result.ok) onDeleted();
    else setActionError(result.message);
  }

  async function start() {
    if (!script || !environmentId) return;
    const started = await runs.start({ environmentId, scriptSha256: script.sha256 });
    if (started) {
      setTab("runs");
      onChanged();
    }
  }

  function changeTab(next: WorkspaceTab) {
    if (dirty && next !== "script") setPendingTab(next);
    else setTab(next);
  }

  if (loadError) return <ErrorState message="The script could not be loaded." detail={loadError} testId="user-script-load-error" />;
  if (!script) return <Skeleton className="h-64 w-full rounded bg-surface-strong" />;

  const environment = environments.find((candidate) => candidate.id === environmentId) ?? null;
  const check = script.check;
  const lastResult = runs.latestFinished?.result;
  const requestNames = lastResult ? lastResult.requestGroups.map((group) => group.displayName) : [];

  return (
    <section aria-labelledby="user-script-title" className="space-y-4" data-testid="user-script-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="user-script-title" className="text-lg font-semibold">
            {script.name}
          </h2>
          <span className="font-mono text-xs text-muted">{formatSize(script.sizeBytes)}</span>
          <span className="break-all font-mono text-xs text-muted" title="SHA-256 of the stored bytes">
            sha256 {script.sha256}
          </span>
          <StatusBadge label={script.confirmed ? "Confirmed" : "Needs confirmation"} tone={script.confirmed ? "success" : "warning"} />
        </div>
        {!script.confirmed && check.accepted && (
          <button type="button" className={BUTTON_STYLES.warning} onClick={() => setAskConfirm(true)}>
            Review and confirm
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-success-700 dark:text-success-200">
          {message}
        </p>
      )}
      {actionError && <ErrorState message={actionError} testId="user-script-action-error" />}

      <Tabs tabs={TABS} activeTab={tab} onChange={changeTab} label="Script views" />

      {tab === "script" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {draft === null ? (
              <button type="button" className={BUTTON_STYLES.secondary} disabled={content === null} onClick={() => setDraft(content ?? "")}>
                Edit
              </button>
            ) : (
              <>
                <button type="button" className={BUTTON_STYLES.primary} disabled={busy || !dirty} onClick={() => void saveDraft()}>
                  Save
                </button>
                <button
                  type="button"
                  className={BUTTON_STYLES.secondary}
                  onClick={() => {
                    setDraft(null);
                    setDraftProblems([]);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
            <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setAskRename(true)}>
              Rename
            </button>
            <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => replaceInput.current?.click()}>
              Replace with upload
            </button>
            <input
              ref={replaceInput}
              type="file"
              accept=".js,text/javascript,application/javascript"
              aria-label="Choose a file to replace this script"
              className="sr-only"
              tabIndex={-1}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) setPendingReplacement(file);
              }}
            />
            <a className={BUTTON_STYLES.secondary} href={userScriptClient.downloadUrl(script.id)} download>
              Download
            </a>
            <button type="button" className={BUTTON_STYLES.danger} onClick={() => setAskDelete(true)}>
              Delete
            </button>
          </div>

          {draft !== null ? (
            <ScriptEditor value={draft} onChange={setDraft} problems={draftProblems} label={`Script ${script.name}`} />
          ) : (
            <>
              {draftProblems.length > 0 && <ScriptProblems problems={draftProblems} title="The uploaded file was refused" />}
              {content !== null ? <CodeBlock label="Stored script (read only; the editor never runs it)" content={content} /> : <ErrorState message="The script's content could not be loaded." />}
            </>
          )}

          {check.accepted ? (
            <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-muted">Hosts written in the script</dt>
                <dd className="mt-1 text-sm">{check.hosts.length === 0 ? "None found in the script text." : <ul className="font-mono text-xs">{check.hosts.map((host) => <li key={host}>{host}</li>)}</ul>}</dd>
                <dd className="mt-1 text-xs text-muted">{RUN_TIME_NOTE}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted">Environment values the script reads</dt>
                <dd className="mt-1 text-sm">
                  {check.envNames.length === 0 ? (
                    "None found."
                  ) : (
                    <ul className="font-mono text-xs">
                      {check.envNames.map((entry) => (
                        <li key={entry.name}>
                          {entry.name}
                          {!entry.mappable && <span className="ml-2 font-sans text-danger-700 dark:text-danger-200">cannot be mapped</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
                <dd className="mt-1 text-xs text-muted">{RUN_TIME_NOTE}</dd>
              </div>
            </dl>
          ) : (
            <ScriptProblems problems={check.problems} title="ApiPilot's current check refuses this stored script" />
          )}
        </div>
      )}

      {tab === "setup" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="space-y-4">
            <section aria-labelledby="user-script-environment-title" className="space-y-2 rounded-lg border border-border bg-surface p-4">
              <h3 id="user-script-environment-title" className="text-base font-semibold">
                Target environment
              </h3>
              {environmentsError ? (
                <ErrorState message="The environments could not be loaded." detail={environmentsError} testId="user-script-environments-error" />
              ) : (
                <EnvironmentPicker
                  environments={environments}
                  selectedId={environmentId}
                  suggestedNames={script.settings.mapping.flatMap((entry) => (entry.source.kind === "environment-value" ? [entry.source.valueName] : []))}
                  onSelect={setEnvironmentId}
                  onSaved={(saved) => {
                    setEnvironmentId(saved.id);
                    void loadEnvironments();
                  }}
                />
              )}
            </section>
            <section aria-labelledby="user-script-mapping-title" className="space-y-2 rounded-lg border border-border bg-surface p-4">
              <h3 id="user-script-mapping-title" className="text-base font-semibold">
                Environment values the script receives
              </h3>
              <ValueMappingEditor
                mapping={script.settings.mapping}
                removedNames={script.settings.removedNames}
                statuses={statuses}
                environmentValueNames={environment ? Object.keys(environment.variableValues) : []}
                busy={busy}
                onSave={(mapping, removedNames) => void saveSettings({ mapping, removedNames })}
              />
            </section>
            <section aria-labelledby="user-script-load-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <h3 id="user-script-load-title" className="text-base font-semibold">
                Load
              </h3>
              <fieldset className="space-y-2" disabled={busy}>
                <legend className="sr-only">Load choice</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="user-script-load" checked={script.settings.load.kind === "script"} onChange={() => void saveSettings({ load: { kind: "script" } })} />
                  The script&apos;s own load settings
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="user-script-load"
                    checked={script.settings.load.kind === "profile"}
                    disabled={check.accepted && !check.hasDefaultFunction}
                    onChange={() => void saveSettings({ load: { kind: "profile", profile: { kind: "smoke", stages: LOAD_PROFILE_STARTING_STAGES.smoke.map((stage) => ({ ...stage })), plannedDurationMs: LOAD_PROFILE_STARTING_STAGES.smoke.reduce((total, stage) => total + stage.durationMs, 0) } } })}
                  />
                  A load profile, passed to k6 as --stage options
                </label>
                {check.accepted && !check.hasDefaultFunction && (
                  <p className="text-xs text-warning-800 dark:text-warning-100">This script has no default function, so a load profile cannot replace its scenarios. It runs with its own load settings.</p>
                )}
              </fieldset>
              {script.settings.load.kind === "profile" && (
                <LoadProfileEditor
                  profile={script.settings.load.profile}
                  startingStages={(kind) => LOAD_PROFILE_STARTING_STAGES[kind].map((stage) => ({ ...stage }))}
                  busy={busy}
                  onSave={(profile) => void saveSettings({ load: { kind: "profile", profile: { ...profile, plannedDurationMs: profile.stages.reduce((total, stage) => total + stage.durationMs, 0) } } })}
                />
              )}
            </section>
            <section aria-labelledby="user-script-thresholds-title" className="space-y-2 rounded-lg border border-border bg-surface p-4">
              <h3 id="user-script-thresholds-title" className="text-base font-semibold">
                Thresholds set in ApiPilot (optional)
              </h3>
              <p className="text-xs text-muted">Evaluated by ApiPilot from the measurements and never added to the script. Thresholds the script defines are reported separately.</p>
              <ThresholdEditor<UserScriptThresholdScope>
                thresholds={script.settings.thresholds}
                scopeOptions={[{ key: "run", label: "Whole run", scope: { kind: "run" } }]}
                scopeLabel={(scope) => (scope.kind === "run" ? "Run" : scope.name)}
                customScope={{ optionLabel: "A request name…", inputLabel: "Request name", suggestions: requestNames, toScope: (name) => ({ kind: "request-name", name }) }}
                busy={busy}
                onSave={(thresholds) => void saveSettings({ thresholds })}
              />
            </section>
          </div>
          <div className="space-y-3">
            {!script.confirmed && check.accepted && (
              <button type="button" className={BUTTON_STYLES.warning} onClick={() => setAskConfirm(true)}>
                Review and confirm the script
              </button>
            )}
            <UserScriptRunTrigger script={script} environment={environment} readiness={runs.readiness} inProgress={runs.inProgress} starting={runs.starting} error={runs.error} onStart={() => void start()} />
          </div>
        </div>
      )}

      {tab === "runs" && <UserScriptRunActivity runs={runs} client={runsClient} />}

      {askConfirm && check.accepted && (
        <ScriptConfirmDialog scriptName={script.name} sha256={script.sha256} hosts={check.hosts} confirming={confirming} onCancel={() => setAskConfirm(false)} onConfirm={() => void confirm()} />
      )}
      {askDelete && (
        <ConfirmDialog
          message={`Delete ${script.name}? Its confirmation and settings are deleted with it. Its past runs and reports are kept.`}
          affectedCount={1}
          confirmLabel="Delete script"
          onCancel={() => setAskDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
      {askRename && <PromptDialog title="Rename script" label="Name" initialValue={script.name} confirmLabel="Rename" onCancel={() => setAskRename(false)} onConfirm={(name) => void rename(name)} />}
      {pendingReplacement && (
        <ConfirmDialog
          message={`Replace ${script.name} with ${pendingReplacement.name}? The new content is checked first, and it needs a new confirmation before the next run.`}
          affectedCount={1}
          confirmLabel="Replace"
          onCancel={() => setPendingReplacement(null)}
          onConfirm={() => {
            const file = pendingReplacement;
            setPendingReplacement(null);
            void replace(file);
          }}
        />
      )}
      {pendingTab && (
        <ConfirmDialog
          message="Discard your unsaved changes to the script?"
          affectedCount={1}
          confirmLabel="Discard changes"
          onCancel={() => setPendingTab(null)}
          onConfirm={() => {
            setDraft(null);
            setDraftProblems([]);
            setTab(pendingTab);
            setPendingTab(null);
          }}
        />
      )}
    </section>
  );
}
