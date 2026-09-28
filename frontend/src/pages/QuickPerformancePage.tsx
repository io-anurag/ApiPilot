import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BUTTON_STYLES } from "../components/controlStyles";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PerformancePlanScreen } from "../components/performance/PerformancePlanScreen";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";
import { fetchQuickTest, quickPerformanceClient, uploadQuickTest } from "../services/quickPerformanceClient";

/**
 * The quick performance test (AP-032, specs/032-quick-performance-test US1 to US3): upload a
 * specification and go straight to the shared performance plan screen, with no API review,
 * scenario review, AI enhancement, workflow review or Postman generation stage. It keeps its own
 * session state and never touches the guided workflow (FR-021). "Back to start" keeps it (FR-025).
 */
type PageState = { kind: "loading" } | { kind: "none" } | { kind: "ready"; quickTest: QuickPerformanceTestView };

const ACCEPT = ".yaml,.yml";

export function QuickPerformancePage({ onExit }: Readonly<{ onExit?: () => void }>) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<File | null>(null);
  // Remounts the plan screen for each new quick test, so it re-reads the new plan.
  const [generation, setGeneration] = useState(0);
  const replaceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchQuickTest().then((result) => {
      if (cancelled) return;
      if (result.ok && result.quickTest) setState({ kind: "ready", quickTest: result.quickTest });
      else setState({ kind: "none" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function upload(file: File, replaceExisting: boolean) {
    setUploading(true);
    setUploadError(null);
    const result = await uploadQuickTest(file, replaceExisting);
    setUploading(false);
    if (!result.ok) {
      if (result.error === "quick_test_exists") setPendingReplacement(file);
      else setUploadError(result.message);
      return;
    }
    if (result.quickTest) {
      setState({ kind: "ready", quickTest: result.quickTest });
      setGeneration((current) => current + 1);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>, existing: boolean) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // Replacing asks first; nothing is sent until the user confirms (FR-021).
    if (existing) setPendingReplacement(file);
    else void upload(file, false);
  }

  const backToStart = onExit && (
    <div className="flex justify-start">
      <button type="button" aria-label="Exit the quick performance test and return to the start screen" onClick={onExit} className={BUTTON_STYLES.ghost}>
        ← Back to start
      </button>
    </div>
  );

  return (
    <div className="space-y-5" data-testid="quick-performance-page">
      {backToStart}
      {state.kind === "loading" && <Skeleton className="h-40 w-full rounded bg-slate-200 dark:bg-slate-600" />}

      {state.kind === "none" && (
        <section aria-labelledby="quick-upload-title" className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h2 id="quick-upload-title" className="text-xl font-semibold">
            Quick performance test
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            Upload an OpenAPI 3.x specification. Every operation becomes a k6 load-test step with a generated request that no one reviews: there is no scenario
            review, AI enhancement or Postman collection. Nothing is sent to any system until you trigger a run.
          </p>
          <label className="flex flex-col items-start gap-2 text-sm font-medium">
            Specification file
            <input
              type="file"
              accept={ACCEPT}
              aria-label="Upload OpenAPI specification for a quick performance test"
              disabled={uploading}
              onChange={(event) => handleFile(event, false)}
              className="text-sm"
            />
          </label>
          {uploading && <p className="text-sm text-muted">Analyzing the specification…</p>}
          {uploadError && <ErrorState message={uploadError} testId="quick-upload-error" />}
        </section>
      )}

      {state.kind === "ready" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{state.quickTest.specification.info?.title ?? state.quickTest.specification.filename}</span>
              {state.quickTest.specification.info && <span className="font-mono text-xs text-muted">{state.quickTest.specification.filename}</span>}
              <StatusBadge label={`${state.quickTest.specification.operationCount} operations analyzed`} />
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={BUTTON_STYLES.secondary} disabled={uploading} onClick={() => replaceInput.current?.click()}>
                New specification
              </button>
              <input
                ref={replaceInput}
                type="file"
                accept={ACCEPT}
                aria-label="Upload a new specification for the quick performance test"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => handleFile(event, true)}
              />
            </div>
          </div>
          {uploadError && <ErrorState message={uploadError} testId="quick-upload-error" />}
          <PerformancePlanScreen
            key={generation}
            client={quickPerformanceClient}
            title="Quick performance test"
            lead={<p>Every operation of the specification, with generated requests that no one reviewed. Nothing is sent to any system until you trigger a run.</p>}
            scopeNote={() => (
              <p className="text-sm">
                Every analyzed operation is in scope, each as its own single-step journey. Requests are not chained: a value such as a path parameter
                comes from the target environment. To chain requests, use the guided workflow.
              </p>
            )}
            emptyState={
              <div className="space-y-3">
                <EmptyState
                  message="Nothing can be load-tested"
                  description="No operation of this specification has a positive scenario. The operations and their reasons are listed above."
                  testId="quick-plan-empty"
                />
                {onExit && (
                  <button type="button" aria-label="Back to start from an empty plan" onClick={onExit} className={BUTTON_STYLES.secondary}>
                    Back to start
                  </button>
                )}
              </div>
            }
            testId="quick-performance-plan"
          />
        </>
      )}

      {pendingReplacement && (
        <ConfirmDialog
          message="Replace the current quick test with the new specification? Runs and reports are kept."
          affectedCount={1}
          confirmLabel="Replace"
          onCancel={() => setPendingReplacement(null)}
          onConfirm={() => {
            const file = pendingReplacement;
            setPendingReplacement(null);
            void upload(file, true);
          }}
        />
      )}
    </div>
  );
}
