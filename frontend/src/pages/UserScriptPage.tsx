import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { ScriptProblem, UserScriptSummary } from "@apipilot/shared-domain";
import { userScriptClient } from "../services/userScriptClient";
import { BUTTON_STYLES } from "../components/controlStyles";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { EntryFeatureIcon, type EntryFeatureIconName } from "../components/EntryFeatureIcon";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { CREDENTIALS_NOTE, ScriptEditor } from "../components/userScript/ScriptEditor";
import { ScriptList } from "../components/userScript/ScriptList";
import { ScriptProblems } from "../components/userScript/ScriptProblems";
import { DocumentGlyph, PlusGlyph, SCRIPT_INPUT, UploadGlyph, WITH_ICON } from "../components/userScript/ScriptPanel";
import { ScriptWorkspace } from "../components/userScript/ScriptWorkspace";
import { Banner } from "../components/patterns/Banner";
import { DropZone } from "../components/patterns/DropZone";
import { FramedPanel } from "../components/patterns/FramedPanel";
import { Pill } from "../components/patterns/Pill";
import { StepTrail, type StepTrailItem } from "../components/patterns/StepTrail";

/**
 * AP-034 Run k6 Script (specs/034-run-user-k6-script). Upload a k6 script or write one, see what
 * ApiPilot's check found, confirm its exact content, and run it with your own k6. Needs no
 * specification, guided workflow or plan. Nothing runs until the engineer presses the trigger.
 */
type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; scripts: UserScriptSummary[] };

/** An action that would leave unsaved editor changes; it waits for the engineer's answer (FR-011). */
type LeaveAction = { kind: "select"; scriptId: string } | { kind: "new" };

const ACCEPT = ".js,text/javascript,application/javascript";

/**
 * The path a script takes, shown on the empty screen as the pattern set's stepper (AP-054 FR-016): the
 * first step is current and the rest are locked until a script exists, with the reason in words.
 */
const USER_SCRIPT_STEPS: readonly StepTrailItem[] = [
  { id: "script", label: "k6 Script", hint: "Upload or write one" },
  { id: "check", label: "Check", hint: "Allowed modules only", lockReason: "Allowed modules only, once a script is added" },
  { id: "confirm", label: "Confirm", hint: "You approve the content", lockReason: "You approve the content, once a script is added" },
  { id: "run", label: "Run", hint: "Runs with your own k6", lockReason: "Runs with your own k6, once a script is confirmed" },
];

const USER_SCRIPT_FEATURES: ReadonlyArray<{ label: string; value: string; icon: EntryFeatureIconName }> = [
  { label: "Checked", value: "Only allowed k6 modules", icon: "direct" },
  { label: "Confirmed", value: "You approve its exact content", icon: "review" },
  { label: "Local", value: "Runs with your own k6", icon: "local" },
];

export function UserScriptPage({ openRunRequest }: Readonly<{ openRunRequest?: Readonly<{ scriptId: string; runId: string; token: number }> }> = {}) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProblems, setUploadProblems] = useState<ScriptProblem[]>([]);
  const [newScript, setNewScript] = useState<{ name: string; content: string; problems: ScriptProblem[] } | null>(null);
  const [newSaving, setNewSaving] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<LeaveAction | null>(null);
  const [dragging, setDragging] = useState(false);

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

  // Home's Recent runs asks for one run: open the script that owns it (asking first if there are
  // unsaved changes, as choosing another script does); the workspace then opens the run's report.
  const handledOpenRun = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!openRunRequest || handledOpenRun.current === openRunRequest.token) return;
    handledOpenRun.current = openRunRequest.token;
    if (selectedId !== openRunRequest.scriptId) request({ kind: "select", scriptId: openRunRequest.scriptId });
  });

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await uploadFile(file);
  }

  /** A file dropped on the drop zone is checked exactly as one chosen through the file picker. */
  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !uploading) await uploadFile(file);
  }

  async function uploadFile(file: File) {
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
  let dropTitle = "Upload a k6 script";
  if (uploading) dropTitle = "Checking…";
  else if (dragging) dropTitle = "Drop the script to check it";

  return (
    <div className="space-y-5" data-testid="user-script-page">
      {list.kind === "loading" && <Skeleton className="h-40 w-full rounded bg-surface-strong" />}

      {list.kind !== "loading" && !working && (
        <section aria-labelledby="user-script-title" className="relative isolate overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[32rem] -translate-x-1/3 -translate-y-1/4 rounded-full bg-brand-500/10 blur-3xl"
          />
          <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 content-center items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_30rem] lg:gap-x-16">
            <div className="flex min-w-0 flex-col gap-8">
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
                {USER_SCRIPT_FEATURES.map(({ label, value, icon }, index) => (
                  <div key={label} className={`flex min-w-[130px] flex-1 flex-col gap-1.5 ${index > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""}`}>
                    <EntryFeatureIcon name={icon} />
                    <dt className="font-mono text-xs uppercase text-brand-700 dark:text-brand-300">{label}</dt>
                    <dd className="text-xs text-muted">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <FramedPanel title="Add a k6 script" subtitle="JavaScript · checked before it is stored">
              <div className="space-y-4">
                <DropZone
                  active={dragging}
                  disabled={uploading}
                  icon={<UploadGlyph className="h-5 w-5" />}
                  title={dropTitle}
                  hint="Click to browse your files"
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!uploading) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => void handleDrop(event)}
                >
                  <input id="user-script-upload" type="file" accept={ACCEPT} aria-label="Upload a k6 script" disabled={uploading} onChange={(event) => void handleUpload(event)} className="sr-only" />
                </DropZone>
                <button type="button" className={`${BUTTON_STYLES.secondary} w-full`} onClick={() => request({ kind: "new" })}>
                  Write a new script
                </button>
                {uploadError && <ErrorState message={uploadError} testId="user-script-upload-error" />}
                {uploadProblems.length > 0 && <ScriptProblems problems={uploadProblems} />}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted">Scripts in this session</h3>
                  {list.kind === "error" && <ErrorState message="The scripts could not be loaded." detail={list.message} testId="user-script-list-error" />}
                  {list.kind === "ready" && scripts.length === 0 && (
                    <EmptyState message="No scripts yet." description="Nothing runs until you confirm a script and press its trigger." icon={<DocumentGlyph className="h-5 w-5" />} testId="user-script-empty" />
                  )}
                </div>
              </div>
            </FramedPanel>
            <div className="col-span-full border-t border-border pt-4">
              <StepTrail ariaLabel="Run k6 Script progress" columns={4} items={USER_SCRIPT_STEPS} currentId="script" onSelect={() => undefined} />
            </div>
          </div>
        </section>
      )}

      {working && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <h2 className="font-display text-xl font-bold text-text-primary">Run k6 Script</h2>
            <Pill tone="mint">{scripts.length === 1 ? "1 script in this session" : `${scripts.length} scripts in this session`}</Pill>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className={`${BUTTON_STYLES.secondary} ${WITH_ICON} cursor-pointer focus-within:ring-2 focus-within:ring-brand-500`}>
                <UploadGlyph className="h-3.5 w-3.5" />
                {uploading ? "Checking…" : "Upload script"}
                <input type="file" accept={ACCEPT} aria-label="Upload a k6 script" disabled={uploading} onChange={(event) => void handleUpload(event)} className="sr-only" />
              </label>
              <button type="button" className={`${BUTTON_STYLES.secondary} ${WITH_ICON}`} onClick={() => request({ kind: "new" })}>
                <PlusGlyph className="h-3.5 w-3.5" />
                Write a new script
              </button>
            </div>
          </div>
          {selectedId === null && !newScript && (
            <Banner tone="neutral" title="Keep credentials out of the script">
              {CREDENTIALS_NOTE}
            </Banner>
          )}
          {uploadError && <ErrorState message={uploadError} testId="user-script-upload-error" />}
          {uploadProblems.length > 0 && <ScriptProblems problems={uploadProblems} />}
          {scripts.length > 0 && <ScriptList scripts={scripts} selectedId={selectedId} onSelect={(scriptId) => request({ kind: "select", scriptId })} />}
        </>
      )}

      {newScript && (
        <section aria-labelledby="new-script-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id="new-script-title" className="text-base font-semibold">
              New script
            </h2>
            <span className="text-sm text-muted">It is checked when you save, and nothing is stored if the check refuses it.</span>
          </div>
          <ScriptEditor
            value={newScript.content}
            onChange={(content) => setNewScript({ ...newScript, content })}
            problems={newScript.problems}
            label="New script"
            fileName={
              <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
                Name
                <input value={newScript.name} maxLength={100} onChange={(event) => setNewScript({ ...newScript, name: event.target.value })} className={`${SCRIPT_INPUT} w-64 max-w-full`} />
              </label>
            }
            footer={
              <>
                <button type="button" className={BUTTON_STYLES.primary} disabled={newSaving || newScript.content.trim() === ""} onClick={() => void saveNew()}>
                  {newSaving ? "Saving…" : "Save"}
                </button>
                <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setPendingLeave({ kind: "select", scriptId: selectedId ?? "" })}>
                  Cancel
                </button>
              </>
            }
          />
        </section>
      )}

      {selectedId && !newScript && (
        <ScriptWorkspace
          key={selectedId}
          scriptId={selectedId}
          openRun={openRunRequest && openRunRequest.scriptId === selectedId ? openRunRequest : undefined}
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
