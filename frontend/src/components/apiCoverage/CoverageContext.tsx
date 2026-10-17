import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { Card, CardHeader } from "../patterns/Card";
import { evidenceLabel, formatTimestamp } from "./coverageViewModel";

const GROUP = "rounded-xl bg-surface-subtle p-3";
const GROUP_TITLE = "mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted";

function Group({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div className={GROUP}>
      <h4 className={GROUP_TITLE}>{title}</h4>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

function Item({ label, testId, children }: Readonly<{ label: string; testId?: string; children: React.ReactNode }>) {
  return (
    <div data-testid={testId}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="break-words text-sm text-text-primary">{children}</dd>
    </div>
  );
}

/**
 * What the figures below are computed from, in four groups: the specification, the execution
 * evidence, the scenarios that count, and the scope of the current view. Evidence is stated once.
 * Everything comes from the snapshot; nothing is inferred here.
 */
export function CoverageContext({
  snapshot,
  scope,
  filtered,
  onReset,
}: Readonly<{
  snapshot: CoverageSnapshot;
  scope: string;
  filtered: boolean;
  onReset: () => void;
}>) {
  const { specification: spec, execution: exec, context } = snapshot;
  const counts = context.scenarioCounts;
  return (
    <Card as="section" aria-labelledby="coverage-context-title" data-testid="coverage-context">
      <CardHeader title="Evaluation context" titleId="coverage-context-title" level={3} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Group title="Specification">
          <Item label="Name">
            {spec.name}
            {spec.version ? ` v${spec.version}` : ""}
          </Item>
          <Item label="Revision">
            <span className="font-mono">{spec.revision.slice(0, 10)}</span>
          </Item>
        </Group>
        <Group title="Execution evidence">
          <Item label="Evidence" testId="coverage-evidence">
            {evidenceLabel(snapshot)}
          </Item>
          <Item label={exec.environments.length > 0 ? "Run context" : "Environment"}>
            {exec.environments.length > 0 ? exec.environments.map((e) => `${e.name} (${e.tier})`).join(", ") : "No execution yet"}
          </Item>
          <Item label="Last qualifying execution">{formatTimestamp(exec.lastQualifyingExecutionAt)}</Item>
          {exec.excludedRuns.length > 0 && (
            <Item label="Excluded runs" testId="coverage-excluded-runs">
              {exec.excludedRuns.map((r) => `${r.runId} (${r.reason}: ${r.environment.name}, ${r.environment.tier})`).join(", ")}
            </Item>
          )}
        </Group>
        <Group title="Scenarios">
          <Item label="Counted in coverage">
            {counts.accepted} accepted, {counts.pending} pending ({counts.rejected} rejected, not counted)
          </Item>
        </Group>
        {/* Spans the whole row: the scope reads as one line, with the reset action at the far end. */}
        <div
          data-testid="coverage-scope"
          aria-live="polite"
          className={`${GROUP} flex flex-wrap items-center justify-between gap-3 sm:col-span-2 xl:col-span-4`}
        >
          <div className="min-w-0">
            <h4 className={GROUP_TITLE}>Scope of this view</h4>
            <p className="text-sm text-text-primary">
              <span className="text-xs text-muted">Showing </span>
              {scope}
            </p>
          </div>
          {filtered && (
            <button
              type="button"
              onClick={onReset}
              className={`${BUTTON_STYLES.secondary} shrink-0`}
            >
              Reset filters
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
