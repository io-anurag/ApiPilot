import type { ScriptProblem } from "@apipilot/shared-domain";

/** Every reason ApiPilot's check refused a script, by line (AP-034 FR-004, FR-011). */
export function ScriptProblems({ problems, title = "ApiPilot's check refused this script" }: Readonly<{ problems: readonly ScriptProblem[]; title?: string }>) {
  return (
    <section role="alert" aria-labelledby="script-problems-title" data-testid="script-problems" className="space-y-2 rounded-lg border border-danger-300 bg-danger-50 p-4 dark:border-danger-500/50 dark:bg-danger-500/10">
      <h3 id="script-problems-title" className="text-sm font-semibold text-danger-800 dark:text-danger-100">
        {title} ({problems.length} {problems.length === 1 ? "reason" : "reasons"})
      </h3>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-danger-800 dark:text-danger-100">
        {problems.map((problem) => (
          <li key={`${problem.line}:${problem.column}:${problem.rule}`}>
            <span className="font-mono text-xs">
              Line {problem.line}, column {problem.column}:
            </span>{" "}
            {problem.message}
          </li>
        ))}
      </ol>
    </section>
  );
}
