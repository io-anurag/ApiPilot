import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BUTTON_STYLES } from "../components/controlStyles";
import { SeedFromSource } from "../components/requestChain/SeededPlans";
import {
  EntryFeatureIcon,
  type EntryFeatureIconName,
} from "../components/EntryFeatureIcon";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";
import { WorkflowPathPreview } from "../components/WorkflowPathPreview";
import { fetchQuickTest, uploadQuickTest } from "../services/quickPerformanceClient";

/**
 * The quick performance test (AP-032, specs/032-quick-performance-test US1): upload a specification,
 * with no API review, scenario review, AI enhancement, workflow review or Postman generation stage.
 * Since AP-037 phase two (specs/037-request-chain-performance US5) it seeds request-chain plans; the
 * quick plan is retired. It keeps its own session state and never touches the guided workflow
 * (FR-021). "Back to start" keeps it (FR-025).
 */
type PageState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; quickTest: QuickPerformanceTestView };

const ACCEPT = ".yaml,.yml";

const QUICK_PATH_STEPS = [
  { label: "OpenAPI", icon: "upload" },
  { label: "Analysis", icon: "analyze" },
  { label: "Performance Plan", icon: "performance" },
  { label: "Run", icon: "run" },
] as const;

const QUICK_FEATURES: ReadonlyArray<{
  label: string;
  description: string;
  icon: EntryFeatureIconName;
}> = [
  { label: "DIRECT", description: "Plan every testable operation", icon: "direct" },
  { label: "VISIBLE", description: "Review writes before a run", icon: "visible" },
  { label: "LOCAL", description: "No cloud AI or automatic traffic", icon: "local" },
];

function UploadIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 14.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-4.5"
      />
    </svg>
  );
}

/**
 * AP-037 FR-020 (specs/037-request-chain-performance US2): `onOpenChainPlan` opens a request-chain
 * plan seeded from this specification; the quick plan below is unchanged until phase two.
 */
export function QuickPerformancePage({ onExit, onOpenChainPlan }: Readonly<{ onExit?: () => void; onOpenChainPlan?: (planId: string) => void }>) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<File | null>(null);
  // Remounts the plan screen for each new quick test, so it re-reads the new plan.
  const replaceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchQuickTest().then((result) => {
      if (cancelled) return;
      if (result.ok && result.quickTest)
        setState({ kind: "ready", quickTest: result.quickTest });
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

  const backButton = onExit && (
    <button
      type="button"
      aria-label="Exit the quick performance test and return to the start screen"
      onClick={onExit}
      className={BUTTON_STYLES.ghost}
    >
      ← Back to start
    </button>
  );

  return (
    <div className="space-y-4" data-testid="quick-performance-page">
      {/* Once a plan exists, "Back to start" joins the specification bar instead of its own row. */}
      {state.kind !== "ready" && backButton && (
        <div className="flex justify-start">{backButton}</div>
      )}
      {state.kind === "loading" && (
        <Skeleton className="h-40 w-full rounded bg-slate-200 dark:bg-slate-600" />
      )}

      {state.kind === "none" && (
        <section
          aria-labelledby="quick-upload-title"
          className="relative isolate overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[32rem] -translate-x-1/3 -translate-y-1/4 rounded-full bg-brand-100/70 blur-3xl dark:bg-brand-500/10"
          />
          <div className="grid min-h-[calc(100vh-9rem)] content-center items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-x-16">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                  <span
                    aria-hidden="true"
                    className="h-3 w-1 rounded-full bg-brand-500"
                  />
                  <span>Specification to k6 performance testing</span>
                </p>
                <h2
                  id="quick-upload-title"
                  className="max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight text-slate-950 sm:text-5xl dark:text-white"
                >
                  Turn an OpenAPI specification into a load test
                </h2>
                <p className="max-w-2xl text-base leading-7 text-muted">
                  Generate a performance plan for every operation with a positive
                  scenario. Inspect the generated requests, set your load profile, and run
                  only when you are ready. No scenario review, AI enhancement, or
                  collection generation.
                </p>
              </div>
              <dl className="flex max-w-2xl flex-wrap gap-x-6 gap-y-4">
                {QUICK_FEATURES.map(({ label, description, icon }, index) => (
                  <div
                    key={label}
                    className={`flex min-w-[130px] flex-1 flex-col gap-1.5 ${index > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""}`}
                  >
                    <EntryFeatureIcon name={icon} />
                    <dt className="font-mono text-xs text-brand-700 dark:text-brand-300">
                      {label}
                    </dt>
                    <dd className="text-xs text-muted">{description}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-surface shadow-[6px_6px_0_0_var(--color-border)] dark:border-slate-700">
              <div className="h-1 bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800" />
              <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-3 dark:bg-white/5">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    New quick performance test
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    OpenAPI 3.x · YAML · up to 10 MB
                  </p>
                </div>
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                <div className="space-y-1">
                  <h3 className="font-display text-lg font-semibold text-slate-950 dark:text-white">
                    Upload specification
                  </h3>
                  <p className="text-sm leading-6 text-muted">
                    The document stays in your local workflow until you explicitly trigger
                    a run.
                  </p>
                </div>
                <label
                  htmlFor="quick-performance-specification-upload"
                  className={`relative flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 ${uploading ? "cursor-not-allowed border-border bg-slate-50 opacity-60 dark:bg-white/5" : "cursor-pointer border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-700 dark:bg-white/5 dark:hover:bg-brand-500/10"}`}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 dark:border-brand-500 dark:bg-white/5 dark:text-brand-300">
                    <UploadIcon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Drag and drop your specification here
                  </span>
                  <span className="text-xs text-muted">
                    or click to browse your files
                  </span>
                  <input
                    id="quick-performance-specification-upload"
                    type="file"
                    accept={ACCEPT}
                    aria-label="Upload OpenAPI specification for a quick performance test"
                    disabled={uploading}
                    onChange={(event) => handleFile(event, false)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                </label>
                {uploading && (
                  <p className="text-sm text-muted">Analyzing the specification...</p>
                )}
                {uploadError && (
                  <ErrorState message={uploadError} testId="quick-upload-error" />
                )}
              </div>
            </div>
            <WorkflowPathPreview steps={QUICK_PATH_STEPS} />
          </div>
        </section>
      )}

      {state.kind === "ready" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {backButton && (
                <>
                  {backButton}
                  <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
                </>
              )}
              <span className="font-semibold">
                {state.quickTest.specification.info?.title ??
                  state.quickTest.specification.filename}
              </span>
              {state.quickTest.specification.info && (
                <span className="font-mono text-xs text-muted">
                  {state.quickTest.specification.filename}
                </span>
              )}
              <StatusBadge
                label={`${state.quickTest.specification.operationCount} operations analyzed`}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={BUTTON_STYLES.secondary}
                disabled={uploading}
                onClick={() => replaceInput.current?.click()}
              >
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
          {uploadError && (
            <ErrorState message={uploadError} testId="quick-upload-error" />
          )}
          <SeedFromSource
            source={{ kind: "specification" }}
            seedKind="specification"
            title="Quick performance test"
            lead={
              <p>
                Create a request-chain plan from this specification: one step for each operation, from its generated positive scenario, with
                credential requests run once before the load. You then edit every request yourself. Nothing is sent to any system until you
                trigger a run.
              </p>
            }
            defaultName={state.quickTest.specification.info?.title ?? state.quickTest.specification.filename}
            onOpenChainPlan={onOpenChainPlan ?? (() => undefined)}
            testId="quick-performance-plan"
          />
        </>
      )}

      {pendingReplacement && (
        <ConfirmDialog
          message="Replace the current quick test with the new specification? Request-chain plans already created from it are kept, and so are runs and reports."
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
