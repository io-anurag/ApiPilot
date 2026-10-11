import { BUTTON_STYLES } from "../controlStyles";

/** What coverage is waiting for, in order: scenarios from a specification, then a real run. */
export type CoverageNeed = "specification" | "scenarios" | "run";

/**
 * The two-step path to coverage. Only the step that can be acted on carries a button, so the page
 * never offers two competing actions; the later step is shown as locked, in text, until it can do
 * something. Spec FR-020/FR-033: say why data is missing and what to do about it.
 */
export function CoverageSteps({
  need,
  scenarioSummary,
  onOpenWorkflow,
}: Readonly<{
  need: CoverageNeed;
  /** Shown on the finished first step, for example "141 scenarios (96 accepted, 45 pending)". */
  scenarioSummary?: string;
  onOpenWorkflow: (view: "guided-workflow" | "import-collection") => void;
}>) {
  const firstDone = need === "run";
  return (
    <section aria-label="What coverage needs" data-testid="coverage-steps" className="grid gap-4 md:grid-cols-2">
      <div className={`space-y-2 rounded-xl border p-5 ${firstDone ? "border-border bg-surface" : "border-brand-500 bg-surface"}`}>
        <p className="font-mono text-xs font-semibold uppercase text-muted">
          {firstDone ? "Step 1 · done" : "Step 1 · needed now"}
        </p>
        <h3 className="font-display text-base font-semibold text-text-primary">
          {firstDone ? "Specification and scenarios" : "Load a specification and generate scenarios"}
        </h3>
        <p className="text-sm text-muted">
          {firstDone
            ? (scenarioSummary ?? "Scenarios are generated for the active specification.")
            : "Specification coverage is calculated from an OpenAPI specification and its generated scenarios."}
        </p>
        {!firstDone && (
          <button type="button" onClick={() => onOpenWorkflow("guided-workflow")} className={BUTTON_STYLES.primary}>
            {need === "specification" ? "Start the Guided Workflow" : "Go to scenario generation"}
          </button>
        )}
      </div>
      <div
        className={`space-y-2 rounded-xl border p-5 ${firstDone ? "border-brand-500 bg-surface" : "border-dashed border-border bg-surface-subtle"}`}
      >
        <p className="font-mono text-xs font-semibold uppercase text-muted">
          {firstDone ? "Step 2 · next" : "Step 2 · adds verification"}
        </p>
        <h3 className="font-display text-base font-semibold text-text-primary">
          {firstDone ? "Run the tests to verify them" : "Run the tests"}
        </h3>
        <p className="text-sm text-muted">
          {firstDone
            ? "Nothing is runtime-verified yet. Generating a test never counts as verifying it."
            : "Runtime-verified coverage needs a real run from Import & Run Collection."}
        </p>
        {firstDone ? (
          <button type="button" onClick={() => onOpenWorkflow("import-collection")} className={BUTTON_STYLES.primary}>
            Go to Import &amp; Run
          </button>
        ) : (
          <p className="text-xs text-muted">Available after step 1.</p>
        )}
      </div>
    </section>
  );
}
