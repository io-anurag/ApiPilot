export type EntryChoice = "guided-workflow" | "import-collection" | "quick-performance";

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
];

/**
 * The very first thing a user sees: a choice between the guided workflow, the standalone
 * "Import & Run Collection" path, and the quick performance test (AP-032 FR-001). Shown only until
 * a choice is made — after that the top tab menu takes over navigation between them (App.tsx).
 */
export function EntryChooser({
  onSelect,
}: Readonly<{ onSelect: (choice: EntryChoice) => void }>) {
  return (
    <div
      data-testid="entry-chooser"
      className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-6xl flex-col justify-center gap-8 py-8 lg:py-12"
    >
      <section className="grid gap-8 border-b border-border pb-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:items-end">
        <div className="max-w-2xl space-y-4">
          <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            <span aria-hidden="true" className="h-3 w-1 bg-brand-500" />
            API test engineering workspace
          </p>
          <h2 className="font-display text-4xl font-semibold text-slate-950 sm:text-5xl dark:text-white">
            Start with the artifact you have.
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Build an explainable test suite from an OpenAPI specification, run an existing
            collection, or create a focused k6 performance plan.
          </p>
        </div>
        <div aria-label="ApiPilot workflow" className="border-l-2 border-brand-500 pl-4">
          <p className="font-mono text-[11px] font-semibold uppercase text-muted">
            Workspace flow
          </p>
          <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:grid-cols-2">
            {[
              ["01", "OpenAPI"],
              ["02", "Analysis"],
              ["03", "Test design"],
              ["04", "Execution"],
            ].map(([number, name]) => (
              <li key={number} className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-brand-700 dark:text-brand-300">
                  {number}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {name}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="entry-paths-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-muted">
              Choose a workflow
            </p>
            <h2
              id="entry-paths-heading"
              className="mt-1 font-display text-2xl font-semibold text-slate-950 dark:text-white"
            >
              Launch a test session
            </h2>
          </div>
          <p className="text-sm text-muted">
            Your work remains available for this browser session.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <button
            type="button"
            aria-label="Guided Workflow"
            onClick={() => onSelect("guided-workflow")}
            className="group grid gap-5 border-2 border-brand-600 bg-brand-50 p-5 text-left transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:bg-brand-900/30 dark:hover:bg-brand-900/50"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-600 text-white">
                <EntryFeatureIcon name="review" />
              </span>
              <span className="font-mono text-xs font-semibold uppercase text-brand-800 dark:text-brand-200">
                Recommended
              </span>
            </div>
            <div className="space-y-2">
              <span className="block font-display text-2xl font-semibold text-slate-950 dark:text-white">
                Guided Workflow
              </span>
              <span className="block max-w-xl text-sm leading-6 text-slate-700 dark:text-slate-200">
                Upload an OpenAPI specification, inspect its analysis, review generated
                scenarios, and produce a runnable Postman collection with an optional k6
                performance test.
              </span>
            </div>
            <span className="font-mono text-xs font-semibold text-brand-800 dark:text-brand-200">
              OpenAPI → review → executable tests
            </span>
          </button>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {DIRECT_PATHS.map((path) => (
              <button
                key={path.choice}
                type="button"
                aria-label={path.title}
                onClick={() => onSelect(path.choice)}
                className="group flex min-h-48 flex-col items-start border border-border bg-surface p-5 text-left transition-colors hover:border-brand-500 hover:bg-chrome focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <span className="flex h-8 w-8 items-center justify-center border border-border bg-chrome">
                  <EntryFeatureIcon name={path.icon} />
                </span>
                <span className="mt-4 font-mono text-[11px] font-semibold uppercase text-muted">
                  {path.label}
                </span>
                <span className="mt-1 font-display text-lg font-semibold text-slate-950 dark:text-white">
                  {path.title}
                </span>
                <span className="mt-2 text-sm leading-6 text-muted">
                  {path.description}
                </span>
                <span className="mt-auto pt-4 font-mono text-xs text-brand-700 dark:text-brand-300">
                  {path.detail} →
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
