import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { ScriptProblem, UserScriptSummary } from "@apipilot/shared-domain";
import { userScriptClient } from "../services/userScriptClient";
import { BUTTON_STYLES } from "../components/controlStyles";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { EntryFeatureIcon, type EntryFeatureIconName } from "../components/EntryFeatureIcon";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";
import { CREDENTIALS_NOTE, ScriptEditor } from "../components/userScript/ScriptEditor";
import { ScriptList } from "../components/userScript/ScriptList";
import { ScriptProblems } from "../components/userScript/ScriptProblems";
import { ScriptWorkspace } from "../components/userScript/ScriptWorkspace";
import { WorkflowPathPreview } from "../components/WorkflowPathPreview";

/**
 * AP-034 Run k6 Script (specs/034-run-user-k6-script). Upload a k6 script or write one, see what
 * ApiPilot's check found, confirm its exact content, and run it with your own k6. Needs no
 * specification, guided workflow or plan. Nothing runs until the engineer presses the trigger.
 */
type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; scripts: UserScriptSummary[] };

/** An action that would leave unsaved editor changes; it waits for the engineer's answer (FR-011). */
type LeaveAction = { kind: "select"; scriptId: string } | { kind: "new" } | { kind: "exit" };

const ACCEPT = ".js,text/javascript,application/javascript";

const USER_SCRIPT_PATH_STEPS = [
  { label: "k6 Script", icon: "upload" },
  { label: "Check", icon: "analyze" },
  { label: "Confirm", icon: "design" },
  { label: "Run", icon: "run" },
] as const;

const USER_SCRIPT_FEATURES: ReadonlyArray<{ label: string; description: string; icon: EntryFeatureIconName }> = [
  { label: "CHECKED", description: "Only allowed k6 modules", icon: "review" },
  { label: "CONFIRMED", description: "You approve its exact content", icon: "visible" },
  { label: "LOCAL", description: "Runs with your own k6", icon: "local" },
];

function UploadIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 14.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-4.5" />
    </svg>
  );
}

export function UserScriptPage({ onExit }: Readonly<{ onExit?: () => void }>) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProblems, setUploadProblems] = useState<ScriptProblem[]>([]);
  const [newScript, setNewScript] = useState<{ name: string; content: string; problems: ScriptProblem[] } | null>(null);
  const [newSaving, setNewSaving] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<LeaveAction | null>(null);

  const refresh = useCallback(async () => {
    const result = await userScriptClient.fetchScripts();
    setList(result.ok ? { kind: "ready", scripts: result.scripts } : { kind: "error", message: result.message });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const newDirty = newScript !== null;
  const dirty = workspaceDirty || newDirty;

  async function startNew() {
    const example = await userScriptClient.fetchExample();
    setSelectedId(null);
    setNewScript({ name: "New script", content: example.ok ? example.content : "", problems: [] });
  }

  function perform(action: LeaveAction) {
    setWorkspaceDirty(false);
    if (action.kind === "exit") {
      setNewScript(null);
      onExit?.();
      return;
    }
    if (action.kind === "new") {
      void startNew();
      return;
    }
    setNewScript(null);
    setSelectedId(action.scriptId);
  }

  function request(action: LeaveAction) {
    if (dirty) setPendingLeave(action);
    else perform(action);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadProblems([]);
    const result = await userScriptClient.uploadScript(file);
    setUploading(false);
    if (!result.ok) {
      setUploadProblems(result.problems ?? []);
      setUploadError(result.problems ? "The script was refused, so nothing was stored." : result.message);
      return;
    }
    await refresh();
    setNewScript(null);
    setSelectedId(result.script.id);
  }

  async function saveNew() {
    if (!newScript) return;
    setNewSaving(true);
    const result = await userScriptClient.createFromText(newScript.name, newScript.content);
    setNewSaving(false);
    if (!result.ok) {
      // FR-011: nothing is stored; the text stays in the editor with the reasons.
      setNewScript({ ...newScript, problems: result.problems ?? [] });
      if (!result.problems) setUploadError(result.message);
      return;
    }
    setNewScript(null);
    await refresh();
    setSelectedId(result.script.id);
  }

  const scripts = list.kind === "ready" ? list.scripts : [];
  // Like the quick performance test: the full-height landing only while there is nothing to work
  // on; once a script or a draft exists, a compact bar keeps the list and workspace in view.
  const working = scripts.length > 0 || newScript !== null;

  const backButton = onExit && (
    <button type="button" aria-label="Exit Run k6 Script and return to the start screen" onClick={() => request({ kind: "exit" })} className={BUTTON_STYLES.ghost}>
      ← Back to start
    </button>
  );

  return (
    <div className="space-y-5" data-testid="user-script-page">
      {!working && backButton && <div className="flex justify-start">{backButton}</div>}
      {list.kind === "loading" && <Skeleton className="h-40 w-full rounded bg-surface-strong" />}

      {list.kind !== "loading" && !working && (
        <section aria-labelledby="user-script-title" className="relative isolate overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[32rem] -translate-x-1/3 -translate-y-1/4 rounded-full bg-brand-500/10 blur-3xl"
          />
          <div className="grid min-h-[calc(100vh-9rem)] content-center items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-x-16">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                  <span aria-hidden="true" className="h-3 w-1 rounded-full bg-brand-500" />
                  <span>Bring your own k6 script</span>
                </p>
                <h2 id="user-script-title" className="max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight text-text-primary sm:text-5xl">
                  Run k6 Script
                </h2>
                <p className="max-w-2xl text-base leading-7 text-muted">
                  Run a k6 script you supply with the k6 installed on this machine. ApiPilot checks that it uses only allowed k6 modules and nothing that reads local files, asks you to
                  confirm its exact content, and runs it only when you press the trigger.
                </p>
                <p className="max-w-2xl text-sm text-muted">{CREDENTIALS_NOTE}</p>
              </div>
              <dl className="flex max-w-2xl flex-wrap gap-x-6 gap-y-4">
                {USER_SCRIPT_FEATURES.map(({ label, description, icon }, index) => (
                  <div key={label} className={`flex min-w-[130px] flex-1 flex-col gap-1.5 ${index > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""}`}>
                    <EntryFeatureIcon name={icon} />
                    <dt className="font-mono text-xs text-brand-700 dark:text-brand-300">{label}</dt>
                    <dd className="text-xs text-muted">{description}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[6px_6px_0_0_var(--color-border)]">
              <div className="h-1 bg-brand-600" />
              <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Add a k6 script</p>
                  <p className="mt-0.5 text-xs text-muted">JavaScript · checked before it is stored</p>
                </div>
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                <label
                  htmlFor="user-script-upload"
                  className={`relative flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 ${uploading ? "cursor-not-allowed border-border bg-surface-subtle opacity-60" : "cursor-pointer border-border-strong bg-surface-subtle hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-500/10"}`}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-200 bg-surface text-brand-700 dark:border-brand-500 dark:text-brand-300">
                    <UploadIcon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium text-text-primary">{uploading ? "Checking…" : "Upload a k6 script"}</span>
                  <span className="text-xs text-muted">Click to browse your files</span>
                  <input
                    id="user-script-upload"
                    type="file"
                    accept={ACCEPT}
                    aria-label="Upload a k6 script"
                    disabled={uploading}
                    onChange={(event) => void handleUpload(event)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                </label>
                <button type="button" className={`${BUTTON_STYLES.secondary} w-full`} onClick={() => request({ kind: "new" })}>
                  Write a new script
                </button>
                {uploadError && <ErrorState message={uploadError} testId="user-script-upload-error" />}
                {uploadProblems.length > 0 && <ScriptProblems problems={uploadProblems} />}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase text-muted">Scripts in this session</h3>
                  {list.kind === "error" && <ErrorState message="The scripts could not be loaded." detail={list.message} testId="user-script-list-error" />}
                  {list.kind === "ready" && scripts.length === 0 && (
                    <EmptyState compact message="No scripts yet." description="Nothing runs until you confirm a script and press its trigger." testId="user-script-empty" />
                  )}
                </div>
              </div>
            </div>
            <WorkflowPathPreview steps={USER_SCRIPT_PATH_STEPS} />
          </div>
        </section>
      )}

      {working && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {backButton && (
                <>
                  {backButton}
                  <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
                </>
              )}
              <h2 className="font-semibold">Run k6 Script</h2>
              <StatusBadge label={scripts.length === 1 ? "1 script in this session" : `${scripts.length} scripts in this session`} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${BUTTON_STYLES.secondary} cursor-pointer focus-within:ring-2 focus-within:ring-brand-500`}>
                {uploading ? "Checking…" : "Upload script"}
                <input type="file" accept={ACCEPT} aria-label="Upload a k6 script" disabled={uploading} onChange={(event) => void handleUpload(event)} className="sr-only" />
              </label>
              <button type="button" className={BUTTON_STYLES.secondary} onClick={() => request({ kind: "new" })}>
                Write a new script
              </button>
            </div>
          </div>
          <p className="max-w-3xl text-sm text-muted">{CREDENTIALS_NOTE}</p>
          {uploadError && <ErrorState message={uploadError} testId="user-script-upload-error" />}
          {uploadProblems.length > 0 && <ScriptProblems problems={uploadProblems} />}
          {scripts.length > 0 && <ScriptList scripts={scripts} selectedId={selectedId} onSelect={(scriptId) => request({ kind: "select", scriptId })} />}
        </>
      )}

      {newScript && (
        <section aria-labelledby="new-script-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 id="new-script-title" className="text-lg font-semibold">
            New script
          </h2>
          <label className="flex max-w-md flex-col gap-1 text-xs text-muted">
            Name
            <input value={newScript.name} maxLength={100} onChange={(event) => setNewScript({ ...newScript, name: event.target.value })} className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary" />
          </label>
          <ScriptEditor value={newScript.content} onChange={(content) => setNewScript({ ...newScript, content })} problems={newScript.problems} label="New script" />
          <div className="flex gap-2">
            <button type="button" className={BUTTON_STYLES.primary} disabled={newSaving || newScript.content.trim() === ""} onClick={() => void saveNew()}>
              {newSaving ? "Saving…" : "Save"}
            </button>
            <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setPendingLeave({ kind: "select", scriptId: selectedId ?? "" })}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {selectedId && !newScript && (
        <ScriptWorkspace
          key={selectedId}
          scriptId={selectedId}
          onChanged={() => void refresh()}
          onDeleted={() => {
            setSelectedId(null);
            void refresh();
          }}
          onDirtyChange={setWorkspaceDirty}
        />
      )}

      {pendingLeave && (
        <ConfirmDialog
          message="Discard your unsaved changes to the script?"
          affectedCount={1}
          confirmLabel="Discard changes"
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const action = pendingLeave;
            setPendingLeave(null);
            if (action.kind === "select" && action.scriptId === "") {
              setNewScript(null);
              setWorkspaceDirty(false);
            } else perform(action);
          }}
        />
      )}
    </div>
  );
}
