import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProfileView, RunPlanProblem, RunPreview, RunRequestInput, SecurityRunView, TargetEnvironment } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchCategories, listAllScenarios, listEnvironments, listProfiles, listRuns, previewRun, type FindingFilterQuery } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { ApprovedScenarioSelection } from "./ApprovedScenarioSelection";
import { FindingsPanel } from "./FindingsPanel";
import { ResultLinks } from "./ResultLinks";
import type { SecurityLabIntent } from "./navigationIntent";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileList } from "./ProfileList";
import { approvedFilter } from "./profileViewModel";
import { RunPlanDialog } from "./RunPlanDialog";
import { RunProgress } from "./RunProgress";
import { RUN_STATUS, checkLimits, limitInputsFrom, parsePlanProblems, problemText, type LimitInputs } from "./runViewModel";
import { formatTimestamp } from "./scenarioViewModel";

type EditorState = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

interface PreviewState {
  readonly preview: RunPreview;
  readonly request: RunRequestInput;
}

const LIMIT_FIELDS: ReadonlyArray<{ field: keyof LimitInputs; label: string }> = [
  { field: "maxRequests", label: "Most requests" },
  { field: "maxConcurrency", label: "Most requests at once" },
  { field: "timeoutMs", label: "Timeout per request (milliseconds)" },
];

/**
 * The Execution and Findings area (specs/057 FR-034 to FR-059). The execution half: choose or create a profile, choose
 * approved scenarios, set limits that can only be lowered, preview, confirm and run, then follow the run and read its
 * results, each linked to its scenario and, when it failed, to its finding. The findings half follows the run section:
 * the finding list and the open finding, whose links lead back to the scenario and the run.
 *
 * Nothing is sent to a target from here except by the confirmed start of a run.
 */
export function ExecutionArea({
  intent = null,
  onNavigate,
  specificationLoaded = true,
}: Readonly<{ intent?: SecurityLabIntent | null; onNavigate?: (intent: SecurityLabIntent) => void; specificationLoaded?: boolean | null }> = {}) {
  const profiles = useSecurityResource((signal) => listProfiles({ signal }));
  const environments = useSecurityResource((signal) => listEnvironments({ signal }));
  const categories = useSecurityResource((signal) => fetchCategories({ signal }));
  const runs = useSecurityResource((signal) => listRuns({ signal }));

  const [editor, setEditor] = useState<EditorState>({ kind: "closed" });
  const [profileId, setProfileId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<LimitInputs>({ maxRequests: "", maxConcurrency: "", timeoutMs: "" });
  const [previewing, setPreviewing] = useState(false);
  const [previewProblems, setPreviewProblems] = useState<RunPlanProblem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [planState, setPlanState] = useState<PreviewState | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runInProgress, setRunInProgress] = useState(false);
  const [runTitles, setRunTitles] = useState<Readonly<Record<string, string>>>({});
  const resumed = useRef(false);
  const [findingFilters, setFindingFilters] = useState<FindingFilterQuery>(intent?.kind === "findings" ? intent.filters : {});
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [findingsRefresh, setFindingsRefresh] = useState(0);
  const findingsRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLDivElement>(null);
  const focusRun = useRef(false);
  const settingsId = useId();

  const profileViews: readonly ProfileView[] = profiles.data?.profiles ?? [];
  const environmentList: readonly TargetEnvironment[] = environments.data?.environments ?? [];
  const chosen = profileViews.find((view) => view.profile.id === profileId && view.valid);
  const profile = chosen?.profile;
  const editing = editor.kind === "edit" ? profileViews.find((view) => view.profile.id === editor.id) : undefined;

  // A profile that stops being valid, or is deleted, can no longer be the one a run is built with.
  useEffect(() => {
    if (profileId !== null && profiles.data && !profileViews.some((view) => view.profile.id === profileId && view.valid)) setProfileId(null);
  }, [profileId, profiles.data, profileViews]);

  // The run limits start from the chosen profile's own and can only go down; they start again if the profile's own change.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const chosenId = profile?.id;
  const limitsKey = profile ? `${profile.maxRequests}/${profile.maxConcurrency}/${profile.timeoutMs}` : "";
  useEffect(() => {
    const current = profileRef.current;
    if (current) setLimits(limitInputsFrom(current));
  }, [chosenId, limitsKey]);

  // A different profile judges the scenarios differently, so a choice made against the earlier one is dropped.
  useEffect(() => {
    setSelected(new Set());
  }, [chosenId]);

  const scenarios = useSecurityResource(
    (signal) => listAllScenarios(approvedFilter(profile?.id), { signal }),
    [profile?.id],
  );
  const items = scenarios.data ?? [];

  // After a reload, a run still in progress on the server is picked up again rather than lost from view.
  useEffect(() => {
    if (resumed.current || !runs.data) return;
    resumed.current = true;
    const live = runs.data.runs.find((run) => run.status === "in-progress");
    if (live) {
      setActiveRunId(live.id);
      setRunInProgress(true);
    }
  }, [runs.data]);

  const categoryNames = useMemo(() => Object.fromEntries((categories.data?.categories ?? []).map((category) => [category.id, category.name])), [categories.data]);
  const titles = useMemo(() => ({ ...Object.fromEntries(items.map((item) => [item.id, item.title])), ...runTitles }), [items, runTitles]);
  const limitCheck = profile ? checkLimits(limits, profile) : undefined;

  let previewBlocked: string | undefined;
  if (specificationLoaded === false) previewBlocked = "No specification is loaded, so a run cannot be checked against it. Upload one in the Guided Workflow to preview a run.";
  else if (runInProgress) previewBlocked = "A run is in progress. Wait for it to finish or cancel it first.";
  else if (!profile) previewBlocked = "Choose a valid profile first.";
  else if (selected.size === 0) previewBlocked = "Choose at least one scenario.";
  else if (limitCheck && limitCheck.errors.length > 0) previewBlocked = "Fix the run limits first.";

  const buildRequest = useCallback((): RunRequestInput | undefined => {
    if (!profile || !limitCheck) return undefined;
    const chosenItems = items.filter((item) => selected.has(item.id)).map((item) => ({ id: item.id, version: item.currentVersion }));
    const overrides = limitCheck.overrides;
    return { profileId: profile.id, items: chosenItems, ...(Object.keys(overrides).length > 0 ? { limits: overrides } : {}) };
  }, [profile, limitCheck, items, selected]);

  const preview = useCallback(async () => {
    const request = buildRequest();
    if (!request) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreviewProblems(null);
    const result = await previewRun(request);
    setPreviewing(false);
    if (!result.ok) {
      if (result.error === "run_plan_invalid") setPreviewProblems(parsePlanProblems(result.details));
      setPreviewError(result.message);
      return;
    }
    setPlanState({ preview: result.data, request });
  }, [buildRequest]);

  const started = (run: SecurityRunView, runTitle: Readonly<Record<string, string>>) => {
    setPlanState(null);
    setRunTitles(runTitle);
    setActiveRunId(run.id);
    setRunInProgress(true);
    runs.refresh();
  };

  const finished = useCallback(() => {
    setRunInProgress(false);
    runs.refresh();
    scenarios.refresh();
    setFindingsRefresh((current) => current + 1);
  }, [runs, scenarios]);

  // Arriving from the Overview with a findings filter puts focus on the findings, so a keyboard user lands on the list.
  useEffect(() => {
    if (intent?.kind === "findings") findingsRef.current?.focus();
  }, [intent]);

  // A link from a finding to its run opens that run and moves focus to it.
  useEffect(() => {
    if (activeRunId && focusRun.current) {
      focusRun.current = false;
      runRef.current?.focus();
    }
  }, [activeRunId]);

  const openRun = (id: string) => {
    focusRun.current = true;
    setActiveRunId(id);
  };
  const openScenario = (scenarioId: string) => {
    onNavigate?.({ kind: "scenarios", filters: { q: scenarioId }, selectScenarioId: scenarioId });
  };
  const openFinding = (id: string) => {
    setSelectedFindingId(id);
  };

  const profilesFailed = profiles.problem?.kind === "error" && !profiles.data;

  return (
    <div data-testid="security-execution" className="space-y-4">
      <Banner tone="warning" title="Running sends real requests" testId="execution-note">
        A run sends real requests to the target of the profile you choose, and only after you confirm the plan. Every run is previewed first, and nothing is sent by previewing.
        Only approved scenarios can run, and only with a profile that is valid.
      </Banner>

      <Card as="section" aria-labelledby="profiles-heading">
        <CardHeader
          title="Profiles"
          titleId="profiles-heading"
          subtitle="A profile names the target, the hosts a request may reach, identities, limits and permissions."
          actions={
            <button type="button" onClick={() => setEditor({ kind: "new" })} className={BUTTON_STYLES.secondary}>
              New profile
            </button>
          }
        />
        <div className="space-y-4">
          {profilesFailed ? (
            <ErrorState testId="profiles-error" message="The profiles could not be loaded" detail={`${profiles.problem?.message ?? ""} This is not an empty list.`}>
              <button type="button" onClick={profiles.refresh} className={BUTTON_STYLES.secondary}>
                Retry
              </button>
            </ErrorState>
          ) : !profiles.data ? (
            <div role="status" aria-label="Loading profiles">
              <Skeleton className="h-24 w-full rounded bg-surface-strong" />
            </div>
          ) : (
            <ProfileList
              profiles={profileViews}
              selectedId={profile?.id ?? null}
              onSelect={setProfileId}
              onEdit={(id) => setEditor({ kind: "edit", id })}
              onDeleted={(id) => {
                if (profileId === id) setProfileId(null);
                if (editor.kind === "edit" && editor.id === id) setEditor({ kind: "closed" });
                profiles.refresh();
              }}
            />
          )}
          {editor.kind !== "closed" && (
            <div className="rounded-xl border border-border-strong p-4">
              <h3 className="mb-3 text-base font-semibold text-text-primary">{editor.kind === "new" ? "New profile" : "Edit profile"}</h3>
              <ProfileEditor
                key={editor.kind === "edit" ? editor.id : "new"}
                initial={editing}
                environments={environmentList}
                categories={categories.data?.categories ?? []}
                onEnvironmentCreated={() => environments.refresh()}
                onChanged={() => profiles.refresh()}
                onClose={() => setEditor({ kind: "closed" })}
              />
            </div>
          )}
        </div>
      </Card>

      <Card as="section" aria-labelledby="run-setup-heading">
        <CardHeader title="Choose what to run" titleId="run-setup-heading" subtitle={profile ? `Judged against the profile "${profile.name}".` : "Choose a valid profile above to judge scenarios against it."} />
        <div className="space-y-4">
          {scenarios.problem?.kind === "error" && !scenarios.data ? (
            <ErrorState testId="approved-error" message="The approved scenarios could not be loaded" detail={`${scenarios.problem.message} This is not an empty list.`}>
              <button type="button" onClick={scenarios.refresh} className={BUTTON_STYLES.secondary}>
                Retry
              </button>
            </ErrorState>
          ) : !scenarios.data ? (
            <div role="status" aria-label="Loading approved scenarios">
              <Skeleton className="h-24 w-full rounded bg-surface-strong" />
            </div>
          ) : (
            <ApprovedScenarioSelection items={items} profile={profile} selected={selected} onChange={setSelected} categoryNames={categoryNames} />
          )}

          <fieldset className="space-y-2" disabled={!profile}>
            <legend className="text-sm font-semibold text-text-primary">Run limits</legend>
            <p className="text-xs text-text-secondary">A run can lower the profile&apos;s limits for itself and can never raise them.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {LIMIT_FIELDS.map(({ field, label }) => (
                <div key={field} className="flex flex-col gap-1">
                  <label htmlFor={`${settingsId}-${field}`} className="text-xs font-medium text-text-secondary">
                    {label}
                    {profile ? ` (at most ${profile[field]})` : ""}
                  </label>
                  <input
                    id={`${settingsId}-${field}`}
                    type="number"
                    min={1}
                    max={profile ? profile[field] : undefined}
                    inputMode="numeric"
                    value={limits[field]}
                    onChange={(event) => setLimits({ ...limits, [field]: event.target.value })}
                    className={FIELD_STYLES}
                  />
                </div>
              ))}
            </div>
            {limitCheck && limitCheck.errors.length > 0 && (
              <ul className="list-disc pl-5 text-xs font-medium text-danger-700 dark:text-danger-100" aria-label="Run limit problems" data-testid="limit-problems">
                {limitCheck.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
          </fieldset>

          {previewError && (
            <ErrorState testId="preview-error" message="The run cannot be previewed" detail={previewError}>
              {previewProblems && previewProblems.length > 0 && (
                <ul className="list-disc pl-5" aria-label="Plan problems">
                  {previewProblems.map((problem, index) => (
                    <li key={`${problem.code}-${index}`}>{problemText(problem)}</li>
                  ))}
                </ul>
              )}
            </ErrorState>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void preview()}
              disabled={previewBlocked !== undefined || previewing}
              aria-describedby={previewBlocked ? `${settingsId}-blocked` : undefined}
              className={BUTTON_STYLES.primary}
            >
              {previewing ? "Previewing..." : "Preview run"}
            </button>
            <span className="text-xs text-text-secondary">Previewing sends nothing to the target.</span>
            {previewBlocked && (
              <span id={`${settingsId}-blocked`} className="text-xs text-text-secondary" data-testid="preview-blocked">
                {previewBlocked}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card as="section" aria-labelledby="run-heading">
        <CardHeader title="Run" titleId="run-heading" />
        <div ref={runRef} tabIndex={-1} className="focus:outline-none" data-testid="run-panel">
          {activeRunId ? (
            <RunProgress
              key={activeRunId}
              runId={activeRunId}
              titles={titles}
              onFinished={finished}
              onDismiss={() => setActiveRunId(null)}
              renderResultExtra={(result) => <ResultLinks result={result} refreshToken={findingsRefresh} onOpenScenario={openScenario} onOpenFinding={openFinding} />}
            />
          ) : (
            <p className="text-sm text-text-secondary">No run is open. Preview and start one above, or open an earlier run below.</p>
          )}
        </div>
        {runs.data && runs.data.runs.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-text-primary">Earlier runs</h3>
            <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Earlier runs">
              <table className={TABLE_STYLES.table}>
                <caption className="sr-only">Runs in this session and retained earlier</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TABLE_STYLES.th}>Started</th>
                    <th scope="col" className={TABLE_STYLES.th}>Target</th>
                    <th scope="col" className={TABLE_STYLES.th}>Status</th>
                    <th scope="col" className={TABLE_STYLES.th}>Scenarios</th>
                    <th scope="col" className={TABLE_STYLES.th}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.runs.map((run) => {
                    const status = RUN_STATUS[run.status];
                    return (
                      <tr key={run.id} data-testid="run-history-row">
                        <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>{formatTimestamp(run.startedAt)}</th>
                        <td className={TABLE_STYLES.td}>{run.profileSummary.environmentName} ({run.profileSummary.tier})</td>
                        <td className={TABLE_STYLES.td}><StatusBadge label={status.label} tone={status.tone} /></td>
                        <td className={TABLE_STYLES.td}>{run.plan.length}</td>
                        <td className={TABLE_STYLES.td}>
                          <button type="button" onClick={() => setActiveRunId(run.id)} aria-label={`Open the run started ${formatTimestamp(run.startedAt)}`} className={BUTTON_STYLES.secondary}>
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
      <div ref={findingsRef} tabIndex={-1} className="focus:outline-none" data-testid="findings-section">
        <FindingsPanel
          filters={findingFilters}
          onFiltersChange={setFindingFilters}
          categories={categories.data?.categories ?? []}
          selectedId={selectedFindingId}
          onSelect={setSelectedFindingId}
          refreshToken={findingsRefresh}
          onOpenScenario={openScenario}
          onOpenRun={openRun}
        />
      </div>

      {planState && (
        <RunPlanDialog
          preview={planState.preview}
          request={planState.request}
          onStarted={started}
          onPreviewAgain={() => {
            setPlanState(null);
            void preview();
          }}
          onClose={() => setPlanState(null)}
        />
      )}
    </div>
  );
}
