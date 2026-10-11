import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeChainPlan,
  namesAvailableAt,
  SUPPORTED_DYNAMIC_VARIABLES,
  type ChainPlan,
  type ChainPlanAnalysis,
  type ChainPlanView,
  type ChainRun,
  type ChainRunSummary,
  type Environment,
  type MovedCredential,
  type ScriptStatus,
} from "@apipilot/shared-domain";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";
import { fetchEnvironments } from "../../services/environmentsClient";
import { chainRunsClient, fetchPlan, generateScript, restoreRun, savePlan } from "../../services/requestChainClient";
import { usePerformanceRuns, type PerformanceRuns } from "../performance/usePerformanceRuns";
import * as edit from "./chainEditing";
import type { ReferenceSuggestion } from "./ReferenceField";

export type ChainRuns = PerformanceRuns<ChainRun, ChainRunSummary, string>;

function movedText(moved: readonly MovedCredential[]): string {
  return moved
    .map((entry) => `The ${entry.location.kind === "header" ? `${entry.location.name} header` : `${entry.location.path} field`} value was moved into the secret value ${entry.valueName} of ${entry.environmentName}.`)
    .join(" ");
}

/** The value names an environment provides, with the base URL first; `null` when no environment is chosen. */
export function environmentNames(environment: Environment | null): string[] | null {
  if (!environment) return null;
  const names = Object.entries(environment.variableValues)
    .filter(([, value]) => value !== "")
    .map(([name]) => name);
  return environment.baseUrl ? ["baseUrl", ...names] : names;
}

/** What a reference field can offer at a step: earlier extractions, data set columns, environment values and dynamic variables. */
export function referenceSuggestions(plan: ChainPlan, selectedStepId: string | null, environment: Environment | null): ReferenceSuggestion[] {
  if (!selectedStepId) return [];
  const producers = new Map<string, string>();
  for (const step of plan.chains.flatMap((chain) => chain.steps)) for (const extractor of step.extractors) producers.set(extractor.name, step.name);
  const extracted = namesAvailableAt(plan, selectedStepId).map((name) => ({ name, detail: `Extracted by ${producers.get(name) ?? "an earlier step"}` }));
  const columns = plan.dataSets.flatMap((dataSet) => dataSet.columns.map((column) => ({ name: column.name, detail: `Column of ${dataSet.name}` })));
  const values = (environmentNames(environment) ?? ["baseUrl"]).map((name) => ({ name, detail: name === "baseUrl" ? "The environment's base URL" : "Environment value" }));
  const dynamic = [...SUPPORTED_DYNAMIC_VARIABLES].map((name) => ({ name, detail: "Generated for each request" }));
  const seen = new Set<string>();
  return [...extracted, ...columns, ...values, ...dynamic].filter((entry) => !seen.has(entry.name) && seen.add(entry.name));
}

/**
 * A request-chain plan that is open for editing, shared by every screen that shows part of it: the plan
 * editor's tabs and the Performance path's steps (specs/047-unified-performance-tab research R1). The
 * plan is kept as a local draft and saved, whole, when a field loses focus or a structural action
 * completes; the server's answer is authoritative (specs/037 research R2). The plan check runs locally
 * on every edit with the shared analysis, so a use before an extraction shows as the engineer types
 * (specs/037 FR-014).
 */
export interface ChainPlanSession {
  planId: string;
  view: ChainPlanView;
  plan: ChainPlan;
  analysis: ChainPlanAnalysis;
  /** The saved script, marked out of date while the plan has changes it does not cover. */
  script: ScriptStatus | null;
  environments: Environment[];
  environment: Environment | null;
  runs: ChainRuns;
  runsClient: PerformanceRunsClient<ChainRun, ChainRunSummary, string>;
  dirty: boolean;
  /** The last save was refused: the editor holds changes the server does not, so it must not say Saved. */
  saveFailed: boolean;
  saveError: string | null;
  announcement: string;
  /** A plain confirmation the page already shows elsewhere is announced to screen readers only. */
  announcementQuiet: boolean;
  busy: boolean;
  /** Why the script cannot be generated now, or `null`. */
  generateBlocked: string | null;
  selectedStepId: string | null;
  setSelectedStepId: (stepId: string | null) => void;
  change: (next: ChainPlan, persist?: boolean) => void;
  save: () => Promise<void>;
  /** Adopt a plan the server returned (data sets, restore, reselect). */
  applyView: (next: ChainPlanView) => void;
  reloadEnvironments: () => void;
  generate: () => Promise<void>;
  restore: (runId: string, into: "plan" | "new-plan") => Promise<void>;
  setSaveError: (message: string | null) => void;
}

export type ChainPlanSessionState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; session: ChainPlanSession };

export function useChainPlanSession(planId: string, onOpenPlan?: (planId: string) => void): ChainPlanSessionState {
  const [view, setView] = useState<ChainPlanView | null>(null);
  const [draft, setDraftState] = useState<ChainPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [announcementQuiet, setAnnouncementQuiet] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftRef = useRef<ChainPlan | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const runsClient = useMemo(() => chainRunsClient(planId), [planId]);
  const runs = usePerformanceRuns(runsClient);

  const setDraft = useCallback((plan: ChainPlan) => {
    draftRef.current = plan;
    setDraftState(plan);
  }, []);

  const load = useCallback(async () => {
    const [planResult, environmentResult] = await Promise.all([fetchPlan(planId), fetchEnvironments()]);
    if (!planResult.ok) {
      setLoadError(planResult.message);
      return;
    }
    setView(planResult);
    setDraft(planResult.plan);
    setSelectedStepId((current) => current ?? planResult.plan.chains.flatMap((chain) => chain.steps)[0]?.id ?? null);
    if (environmentResult.ok) setEnvironments(environmentResult.environments);
  }, [planId, setDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (saving.current) {
      queued.current = true;
      return;
    }
    const sent = draftRef.current;
    if (!sent) return;
    saving.current = true;
    const result = await savePlan(sent.id, sent.revision, edit.inputOf(sent));
    saving.current = false;
    // A conflict reloads the server's plan, so the editor and the server agree again.
    setSaveFailed(!result.ok && !(result.error === "plan_revision_conflict" && result.current));
    if (result.ok) {
      setView(result);
      setSaveError(null);
      if (draftRef.current === sent || result.movedCredentials.length > 0) setDraft(result.plan);
      else if (draftRef.current) setDraft({ ...draftRef.current, revision: result.plan.revision, fingerprint: result.plan.fingerprint });
      if (result.movedCredentials.length > 0) {
        setAnnouncement(movedText(result.movedCredentials));
        setAnnouncementQuiet(false);
      }
    } else if (result.error === "plan_revision_conflict" && result.current) {
      setView(result.current);
      setDraft(result.current.plan);
      setAnnouncement("The plan was changed elsewhere and has been reloaded. Make your change again.");
      setAnnouncementQuiet(false);
    } else if (result.error === "credential_needs_environment") {
      setSaveError(`${result.message} Choose one under Run setup.`);
    } else {
      setSaveError(result.message);
    }
    if (queued.current) {
      queued.current = false;
      void save();
      return;
    }
    setDirty(false);
  }, [setDraft]);

  const change = useCallback(
    (next: ChainPlan, persist = false) => {
      setDraft(next);
      setDirty(true);
      if (persist) void save();
    },
    [save, setDraft],
  );

  const applyView = useCallback(
    (next: ChainPlanView) => {
      setView(next);
      setDraft(next.plan);
    },
    [setDraft],
  );

  const reloadEnvironments = useCallback(() => {
    void fetchEnvironments().then((result) => result.ok && setEnvironments(result.environments));
  }, []);

  const environment = useMemo(() => environments.find((candidate) => candidate.id === draft?.targetEnvironmentId) ?? null, [environments, draft?.targetEnvironmentId]);
  const analysis = useMemo(() => (draft ? analyzeChainPlan(draft, { environmentValueNames: environmentNames(environment) }) : null), [draft, environment]);

  const generate = useCallback(async () => {
    setBusy(true);
    const result = await generateScript(planId);
    setBusy(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setView((current) => (current ? { ...current, script: result.script } : current));
    setAnnouncement("Script generated.");
    setAnnouncementQuiet(true);
  }, [planId]);

  const restore = useCallback(
    async (runId: string, into: "plan" | "new-plan") => {
      const current = draftRef.current;
      if (!current) return;
      setBusy(true);
      const result = await restoreRun(runId, into === "plan" ? { into: "plan", planId, revision: current.revision } : { into: "new-plan" });
      setBusy(false);
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      const missing = result.dataSetsNotRestored.map((entry) => `${entry.name} (${entry.reason === "deleted" ? "deleted" : "content changed"})`).join(", ");
      if (into === "new-plan") {
        onOpenPlan?.(result.plan.id);
        return;
      }
      applyView(result);
      setAnnouncementQuiet(false);
      setAnnouncement(`The run's plan was restored and its script generated. No run was started.${missing ? ` Data sets not restored: ${missing}.` : ""}`);
    },
    [applyView, onOpenPlan, planId],
  );

  if (loadError) return { status: "error", message: loadError };
  if (!draft || !analysis || !view) return { status: "loading" };

  const script: ScriptStatus | null = view.script && view.script.planFingerprint === draft.fingerprint && !dirty ? view.script : view.script ? { ...view.script, outOfDate: true } : null;
  const generateBlocked = dirty ? "Saving your latest change…" : saveFailed ? "Your latest change is not saved. Fix the error above first." : analysis.blockers.length > 0 ? "Fix the plan's problems first." : null;

  return {
    status: "ready",
    session: {
      planId,
      view,
      plan: draft,
      analysis,
      script,
      environments,
      environment,
      runs,
      runsClient,
      dirty,
      saveFailed,
      saveError,
      announcement,
      announcementQuiet,
      busy,
      generateBlocked,
      selectedStepId,
      setSelectedStepId,
      change,
      save,
      applyView,
      reloadEnvironments,
      generate,
      restore,
      setSaveError,
    },
  };
}
