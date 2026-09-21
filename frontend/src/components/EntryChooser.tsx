export type EntryChoice = "guided-workflow" | "import-collection";

/**
 * The very first thing a user sees: a choice between the guided workflow and the standalone
 * "Import & Run Collection" path. Shown only until a choice is made — after that the top tab
 * menu takes over navigation between the two (App.tsx).
 */
export function EntryChooser({
  onSelect,
}: Readonly<{ onSelect: (choice: EntryChoice) => void }>) {
  return (
    <div
      data-testid="entry-chooser"
      className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-4xl flex-col items-center justify-center gap-8 py-10 text-center"
    >
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
          <span aria-hidden="true" className="h-3 w-1 rounded-full bg-brand-500" />
          <span>Specification to executable tests</span>
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">
          How do you want to start?
        </h1>
        <p className="mx-auto max-w-xl text-base leading-7 text-muted">
          Generate a test suite from an OpenAPI specification, or bring an existing
          Postman collection to run directly.
        </p>
      </div>
      <div className="grid w-full gap-5 sm:grid-cols-2">
        <button
          type="button"
          aria-label="Guided Workflow"
          onClick={() => onSelect("guided-workflow")}
          className="flex flex-col items-start gap-2 rounded-xl border border-slate-300 bg-surface p-6 text-left shadow-[6px_6px_0_0_var(--color-border)] transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-slate-700"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-10 rounded-full bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800"
          />
          <span className="font-display text-lg font-semibold text-slate-950 dark:text-white">
            Guided Workflow
          </span>
          <span className="text-sm leading-6 text-muted">
            Upload an OpenAPI specification, review the analysis, generate and approve
            test scenarios, then produce a runnable Postman collection.
          </span>
        </button>
        <button
          type="button"
          aria-label="Import & Run Collection"
          onClick={() => onSelect("import-collection")}
          className="flex flex-col items-start gap-2 rounded-xl border border-slate-300 bg-surface p-6 text-left shadow-[6px_6px_0_0_var(--color-border)] transition-colors hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-slate-700"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-10 rounded-full bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800"
          />
          <span className="font-display text-lg font-semibold text-slate-950 dark:text-white">
            Import &amp; Run Collection
          </span>
          <span className="text-sm leading-6 text-muted">
            Already have a Postman collection and environment? Upload them and run them
            against your API directly — no specification required.
          </span>
        </button>
      </div>
    </div>
  );
}
