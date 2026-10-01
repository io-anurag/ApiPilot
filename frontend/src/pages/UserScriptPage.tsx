import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { ScriptProblem, UserScriptSummary } from "@apipilot/shared-domain";
import { userScriptClient } from "../services/userScriptClient";
import { BUTTON_STYLES } from "../components/controlStyles";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { CREDENTIALS_NOTE, ScriptEditor } from "../components/userScript/ScriptEditor";
import { ScriptList } from "../components/userScript/ScriptList";
import { ScriptProblems } from "../components/userScript/ScriptProblems";
import { ScriptWorkspace } from "../components/userScript/ScriptWorkspace";

/**
 * AP-034 Run k6 Script (specs/034-run-user-k6-script). Upload a k6 script or write one, see what
 * ApiPilot's check found, confirm its exact content, and run it with your own k6. Needs no
 * specification, guided workflow or plan. Nothing runs until the engineer presses the trigger.
 */
type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; scripts: UserScriptSummary[] };

/** An action that would leave unsaved editor changes; it waits for the engineer's answer (FR-011). */
type LeaveAction = { kind: "select"; scriptId: string } | { kind: "new" } | { kind: "exit" };

const ACCEPT = ".js,text/javascript,application/javascript";

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

  return (
    <div className="space-y-5" data-testid="user-script-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {onExit && (
            <button type="button" aria-label="Exit Run k6 Script and return to the start screen" onClick={() => request({ kind: "exit" })} className={BUTTON_STYLES.ghost}>
              ← Back to start
            </button>
          )}
          <h2 className="font-display text-2xl font-semibold">Run k6 Script</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${BUTTON_STYLES.primary} cursor-pointer focus-within:ring-2 focus-within:ring-brand-500`}>
            {uploading ? "Checking…" : "Upload script"}
            <input type="file" accept={ACCEPT} aria-label="Upload a k6 script" disabled={uploading} onChange={(event) => void handleUpload(event)} className="sr-only" />
          </label>
          <button type="button" className={BUTTON_STYLES.secondary} onClick={() => request({ kind: "new" })}>
            Write a new script
          </button>
        </div>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Run a k6 script you supply with the k6 installed on this machine. ApiPilot checks that it uses only allowed k6 modules and nothing that reads local files, asks you to confirm its exact
        content, and runs it only when you press the trigger. {CREDENTIALS_NOTE}
      </p>
      {uploadError && <ErrorState message={uploadError} testId="user-script-upload-error" />}
      {uploadProblems.length > 0 && <ScriptProblems problems={uploadProblems} />}

      {list.kind === "loading" && <Skeleton className="h-32 w-full rounded bg-slate-200 dark:bg-slate-600" />}
      {list.kind === "error" && <ErrorState message="The scripts could not be loaded." detail={list.message} testId="user-script-list-error" />}
      {list.kind === "ready" && scripts.length === 0 && !newScript && (
        <EmptyState message="No scripts yet" description="Upload a k6 script, or write a new one from ApiPilot's example. Nothing runs until you confirm a script and press its trigger." testId="user-script-empty" />
      )}
      {scripts.length > 0 && <ScriptList scripts={scripts} selectedId={selectedId} onSelect={(scriptId) => request({ kind: "select", scriptId })} />}

      {newScript && (
        <section aria-labelledby="new-script-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 id="new-script-title" className="text-lg font-semibold">
            New script
          </h2>
          <label className="flex max-w-md flex-col gap-1 text-xs text-muted">
            Name
            <input value={newScript.name} maxLength={100} onChange={(event) => setNewScript({ ...newScript, name: event.target.value })} className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100" />
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
