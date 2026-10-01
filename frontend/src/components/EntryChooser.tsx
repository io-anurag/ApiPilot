export type EntryChoice = "guided-workflow" | "import-collection" | "quick-performance" | "user-script";

import { EntryFeatureIcon, type EntryFeatureIconName } from "./EntryFeatureIcon";

interface EntryPath {
  choice: EntryChoice;
  title: string;
  label: string;
  description: string;
  detail: string;
  icon: EntryFeatureIconName;
}

const DIRECT_PATHS: readonly EntryPath[] = [
  {
    choice: "import-collection",
    title: "Import & Run Collection",
    label: "Run an existing collection",
    description:
      "Upload a Postman collection and environment, inspect every request, then run it against your API.",
    detail: "Collection + environment",
    icon: "import",
  },
  {
    choice: "quick-performance",
    title: "Quick performance test",
    label: "Load test from a specification",
    description:
      "Load-tests every operation of an uploaded specification with generated requests that no one reviews.",
    detail: "OpenAPI to k6 plan",
    icon: "control",
  },
  {
    choice: "user-script",
    title: "Run k6 Script",
    label: "Run a script you supply",
    description:
      "Upload or write a k6 script, confirm its exact content, and run it with the k6 installed on this machine.",
    detail: "Your k6 script",
    icon: "visible",
  },
];

const GUIDED_STAGES: readonly (readonly [number: string, name: string])[] = [
  ["01", "OpenAPI"],
  ["02", "Analysis"],
  ["03", "Test design"],
  ["04", "Execution"],
];

/**
 * The very first thing a user sees: a choice between the guided workflow, the standalone
 * "Import & Run Collection" path, the quick performance test (AP-032 FR-001) and Run k6 Script
 * (AP-034 FR-001). Shown only until
 * a choice is made — after that the top tab menu takes over navigation between them (App.tsx).
 *
 * Layout: the guided workflow is a full-width featured row and the direct paths sit in their own
 * equal-height grid below it. Putting the two side by side made the guided tile stretch to the
 * height of every stacked direct path, which grew with each new path.
 */
export function EntryChooser({
  onSelect,
}: Readonly<{ onSelect: (choice: EntryChoice) => void }>) {
  return (
    <div
      data-testid="entry-chooser"
      className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-6xl flex-col justify-center gap-8 py-8 lg:py-12"
    >
      <section className="max-w-3xl space-y-4">
        <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
          <span aria-hidden="true" className="h-3 w-1 rounded-full bg-brand-500" />
          API test engineering workspace
        </p>
        <h2 className="font-display text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">
          Start with the artifact you have.
        </h2>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Build an explainable test suite from an OpenAPI specification, or go straight to running
          a Postman collection, a quick load test, or a k6 script of your own.
        </p>
      </section>

      <section aria-labelledby="entry-paths-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-6">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-muted">
              Choose a workflow
            </p>
            <h2
              id="entry-paths-heading"
              className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-950 dark:text-white"
            >
              Launch a test session
            </h2>
          </div>
          <p className="text-sm text-muted">
            Your work remains available for this browser session.
          </p>
        </div>

        <button
          type="button"
          aria-label="Guided Workflow"
          aria-describedby="entry-guided-workflow-description"
          onClick={() => onSelect("guided-workflow")}
          className="grid w-full gap-6 rounded-xl border-2 border-brand-600 bg-brand-50 p-6 text-left shadow-[6px_6px_0_0_var(--color-border)] transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10 dark:bg-brand-900/30 dark:hover:bg-brand-900/50"
        >
          <span className="flex items-start gap-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
              <EntryFeatureIcon name="review" tone="inverse" />
            </span>
            <span className="space-y-2">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-display text-2xl font-semibold text-slate-950 dark:text-white">
                  Guided Workflow
                </span>
                <span className="rounded-sm border border-brand-600 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase text-brand-800 dark:border-brand-400 dark:text-brand-200">
                  Recommended
                </span>
              </span>
              <span
                id="entry-guided-workflow-description"
                className="block max-w-xl text-sm leading-6 text-slate-700 dark:text-slate-200"
              >
                Upload an OpenAPI specification, inspect its analysis, review generated
                scenarios, and produce a runnable Postman collection with an optional k6
                performance test.
              </span>
            </span>
          </span>

          {/* The stages are a visual summary inside the button (whose name comes from aria-label),
            * so they use phrasing elements — a list is not valid button content. */}
          <span className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-lg">
            {GUIDED_STAGES.map(([number, name]) => (
              <span
                key={number}
                className="flex flex-col gap-0.5 rounded-md border border-brand-200 bg-surface px-3 py-2 dark:border-brand-800"
              >
                <span className="font-mono text-xs text-brand-700 dark:text-brand-300">
                  {number}
                </span>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {name}
                </span>
              </span>
            ))}
          </span>
        </button>

        <p className="pt-2 font-mono text-xs font-semibold uppercase text-muted">
          Or go direct
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DIRECT_PATHS.map((path) => (
            <button
              key={path.choice}
              type="button"
              aria-label={path.title}
              aria-describedby={`entry-${path.choice}-description`}
              onClick={() => onSelect(path.choice)}
              className="flex flex-col items-start rounded-xl border border-slate-300 bg-surface p-5 text-left shadow-[6px_6px_0_0_var(--color-border)] transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-slate-700"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-chrome">
                  <EntryFeatureIcon name={path.icon} />
                </span>
                <span className="font-mono text-[11px] font-semibold uppercase text-muted">
                  {path.label}
                </span>
              </span>
              <span className="mt-4 font-display text-lg font-semibold text-slate-950 dark:text-white">
                {path.title}
              </span>
              <span
                id={`entry-${path.choice}-description`}
                className="mt-2 text-sm leading-6 text-muted"
              >
                {path.description}
              </span>
              <span className="mt-auto pt-4 font-mono text-xs text-brand-700 dark:text-brand-300">
                {path.detail} →
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
