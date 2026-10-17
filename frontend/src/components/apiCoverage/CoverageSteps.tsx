import { BUTTON_STYLES } from "../controlStyles";
import { Card } from "../patterns/Card";
import { Pill } from "../patterns/Pill";

/** What coverage is waiting for, in order: scenarios from a specification, then a real run. */
export type CoverageNeed = "specification" | "scenarios" | "run";

/** The step that can be acted on carries a brand edge as well as its words ("needed now", "next"). */
const CURRENT = "ring-2 ring-brand-500";

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
      <Card className={`space-y-2 ${firstDone ? "" : CURRENT}`}>
        <Pill tone={firstDone ? "ok" : "accent"} icon={firstDone ? <span aria-hidden="true">✓</span> : undefined}>
          {firstDone ? "Step 1 · done" : "Step 1 · needed now"}
        </Pill>
        <h3 className="text-base font-semibold text-text-primary">
          {firstDone ? "Specification and scenarios" : "Load a specification and generate scenarios"}
        </h3>
        <p className="text-sm text-text-secondary">
          {firstDone
            ? (scenarioSummary ?? "Scenarios are generated for the active specification.")
            : "Specification coverage is calculated from an OpenAPI specification and its generated scenarios."}
        </p>
        {!firstDone && (
          <button type="button" onClick={() => onOpenWorkflow("guided-workflow")} className={BUTTON_STYLES.primary}>
            {need === "specification" ? "Start the Guided Workflow" : "Go to scenario generation"}
          </button>
        )}
      </Card>
      <Card variant={firstDone ? "default" : "flat"} className={`space-y-2 ${firstDone ? CURRENT : "border-dashed"}`}>
        <Pill tone={firstDone ? "accent" : "line"}>{firstDone ? "Step 2 · next" : "Step 2 · adds verification"}</Pill>
        <h3 className="text-base font-semibold text-text-primary">
          {firstDone ? "Run the tests to verify them" : "Run the tests"}
        </h3>
        <p className="text-sm text-text-secondary">
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
      </Card>
    </section>
  );
}
