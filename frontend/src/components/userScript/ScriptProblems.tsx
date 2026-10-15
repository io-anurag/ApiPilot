import type { ScriptProblem } from "@apipilot/shared-domain";

/**
 * Every reason ApiPilot's check refused a script, by line (AP-034 FR-004, FR-011). Each reason is a
 * row with its position first, so the list can be scanned down the left edge; the header counts them
 * in words (specs/051-user-script-page-redesign FR-007).
 */
export function ScriptProblems({ problems, title = "ApiPilot's check refused this script" }: Readonly<{ problems: readonly ScriptProblem[]; title?: string }>) {
  return (
    <section role="alert" aria-labelledby="script-problems-title" data-testid="script-problems" className="overflow-hidden rounded-lg border border-danger-300 bg-danger-50 dark:border-danger-500/50 dark:bg-danger-500/10">
      <div className="flex items-center gap-2 border-b border-danger-300 px-4 py-2.5 dark:border-danger-500/50">
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger-600 font-mono text-xs font-bold text-white">
          !
        </span>
        <h3 id="script-problems-title" className="text-sm font-semibold text-danger-800 dark:text-danger-100">
          {title} ({problems.length} {problems.length === 1 ? "reason" : "reasons"})
        </h3>
      </div>
      <ol className="divide-y divide-danger-300/60 text-sm text-danger-800 dark:divide-danger-500/30 dark:text-danger-100">
        {problems.map((problem) => (
          <li key={`${problem.line}:${problem.column}:${problem.rule}`} className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:gap-3">
            <span className="shrink-0 font-mono text-xs sm:w-40 sm:pt-0.5">
              Line {problem.line}, column {problem.column}:
            </span>
            <span className="min-w-0">{problem.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
