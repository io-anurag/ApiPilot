import {
  parseReferences,
  type ChainPlan,
  type ChainPlanAnalysis,
  type ChainRunSnapshot,
  type ChainRunSnapshotStep,
  type ChainStep,
  type StepCheck,
} from "@apipilot/shared-domain";

/**
 * What a chain run records about its plan (specs/037-request-chain-performance FR-033; data-model
 * "Run snapshot and run"): the chains and steps by name, method and path template, their runs
 * setting, expected statuses, extractor names, check kinds and paths, each step's seed source and
 * `Changed` mark, and the data sets' structure. It holds no request content (no body, header value or
 * query value), no check's expected literal and no value, and states that step content is the
 * engineer's and not verified by ApiPilot (constitution XVII). Restore reads the separate encrypted
 * plan copy instead (FR-035).
 */
function checkEntry(check: StepCheck): ChainRunSnapshotStep["checks"][number] {
  if (check.kind === "time-at-most") return { id: check.id, kind: check.kind, path: null, maxMs: check.maxMs, reference: null };
  if (check.kind === "body-contains") return { id: check.id, kind: check.kind, path: null, maxMs: null, reference: null };
  let reference: string | null = null;
  if (check.kind === "field-equals" && check.expected.type === "text") {
    const references = parseReferences(check.expected.value);
    if (references.length === 1 && references[0].raw === check.expected.value && references[0].kind === "name") reference = references[0].name;
  }
  return { id: check.id, kind: check.kind, path: check.path, maxMs: null, reference };
}

function sourceOf(step: ChainStep): ChainRunSnapshotStep["source"] {
  return step.source.kind === "added" ? { kind: "added", label: null } : { kind: step.source.kind, label: step.source.label };
}

export function chainRunSnapshot(plan: ChainPlan, analysis: ChainPlanAnalysis): ChainRunSnapshot {
  return {
    planId: plan.id,
    planName: plan.name,
    fingerprint: plan.fingerprint,
    chains: plan.chains.map((chain) => ({
      id: chain.id,
      name: chain.name,
      steps: chain.steps.map((step) => ({
        id: step.id,
        name: step.name,
        method: step.method,
        pathTemplate: step.url,
        runs: step.runs,
        expectedStatuses: step.expectedStatuses,
        extractorNames: step.extractors.map((extractor) => extractor.name),
        checks: step.checks.map(checkEntry),
        source: sourceOf(step),
        changed: step.changed,
      })),
    })),
    loadProfile: plan.loadProfile,
    thinkTimeMs: plan.thinkTimeMs,
    thresholds: plan.thresholds,
    hosts: analysis.hosts,
    dataSets: plan.dataSets.map((dataSet) => ({ id: dataSet.id, name: dataSet.name, mode: dataSet.mode, columns: dataSet.columns, rowCount: dataSet.rowCount, sha256: dataSet.sha256 })),
    writeSummary: analysis.writeSummary,
    seedSource: plan.seedingReport?.source ?? null,
    contentNotice: "user-authored-unverified",
  };
}
