import type {
  AnalysisIssue,
  ApiModel,
  ApiOperation,
  ExclusionGroup,
  ExclusionReason,
  ImportAnalysisReport,
  MalformedEntry,
} from "@apipilot/shared-domain";
import { InputLayerInvariantError, InputLimitExceededError, NoOperationsDerivedError } from "../errors";
import { yieldToEventLoop } from "../jsonSafe";
import {
  MAX_CREDENTIAL_URL_ENTRIES,
  MAX_DERIVED_OPERATIONS,
  MAX_EXCLUSION_SAMPLES,
  MAX_ISSUES_PER_KIND,
  type InputLimits,
} from "../limits";
import { logInputEvent } from "../logging";
import { buildOperation } from "./buildOperation";
import { classifyEntry } from "./classifyEntry";
import { detectDependencies, type EntryOperation } from "./detectDependencies";
import { extractEntry } from "./extractEntry";
import { inferPathPatterns, pathKey, type InferredPath } from "./inferPathParameters";
import { OperationAccumulator, type OperationGroup } from "./mergeObservations";
import { computeOriginScope, isRelatedOrigin } from "./originScope";
import type { ExtractedEntry } from "./types";
import { validateHar } from "./validateHar";

/**
 * Builds the normalized `ApiModel` and the import report from a HAR document (specs/056 FR-009 to
 * FR-022, FR-028). The result is a pure function of the document and the limits: ordering, examples,
 * issues and identifiers do not depend on the clock, randomness or the machine (FR-022). The
 * reconciliation invariant `imported + excluded + malformed = total` is checked here and a violation
 * is an internal error, never silently corrected (FR-020).
 */

const EXCLUSION_ORDER: readonly ExclusionReason[] = [
  "non-http-scheme", "cors-preflight", "streaming", "failed-request", "redirect", "not-modified",
  "analytics-telemetry", "static-asset", "html-document", "third-party-origin", "duplicate-method-path-other-origin",
];

const ISSUE_KIND_ORDER: readonly AnalysisIssue["kind"][] = [
  "duplicate-operation", "ambiguous-path", "conflicting-types", "unsupported-content", "incomplete-observation", "credential-detected",
];

const METHOD_RANK: Record<string, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, HEAD: 5, OPTIONS: 6, TRACE: 7 };

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function methodRank(method: string): number {
  return METHOD_RANK[method] ?? 8;
}

/** Entries in chronological order: by start time when every entry has one, otherwise by position. */
function chronological(entries: readonly ExtractedEntry[]): ExtractedEntry[] {
  const allTimed = entries.every((entry) => entry.startedAt !== undefined);
  return [...entries].sort((a, b) =>
    allTimed ? (a.startedAt as number) - (b.startedAt as number) || a.index - b.index : a.index - b.index,
  );
}

class ExclusionLedger {
  private readonly groups = new Map<ExclusionReason, ExclusionGroup>();

  add(entry: ExtractedEntry, reason: ExclusionReason): void {
    const group = this.groups.get(reason) ?? { reason, count: 0, samples: [] };
    group.count += 1;
    if (group.samples.length < MAX_EXCLUSION_SAMPLES) {
      group.samples.push({ entryIndex: entry.index, method: entry.method, host: entry.host, path: entry.path });
    }
    this.groups.set(reason, group);
  }

  countOf(reason: ExclusionReason): number {
    return this.groups.get(reason)?.count ?? 0;
  }

  get total(): number {
    return [...this.groups.values()].reduce((sum, group) => sum + group.count, 0);
  }

  list(): ExclusionGroup[] {
    return EXCLUSION_ORDER.flatMap((reason) => {
      const group = this.groups.get(reason);
      if (!group) return [];
      return [{ ...group, samples: [...group.samples].sort((a, b) => a.entryIndex - b.entryIndex) }];
    });
  }
}

interface PendingGroup {
  origin: string;
  method: string;
  pattern: string;
  entries: ExtractedEntry[];
}

/** Applies the per-kind cap, replacing the overflow with one summary issue. Order is by kind, location, message. */
function capIssues(issues: AnalysisIssue[]): AnalysisIssue[] {
  const sorted = [...issues].sort(
    (a, b) =>
      ISSUE_KIND_ORDER.indexOf(a.kind) - ISSUE_KIND_ORDER.indexOf(b.kind) ||
      compare(a.location, b.location) ||
      compare(a.message, b.message),
  );
  const seen = new Map<AnalysisIssue["kind"], number>();
  const kept: AnalysisIssue[] = [];
  for (const issue of sorted) {
    const count = (seen.get(issue.kind) ?? 0) + 1;
    seen.set(issue.kind, count);
    if (count <= MAX_ISSUES_PER_KIND) kept.push(issue);
  }
  for (const kind of ISSUE_KIND_ORDER) {
    const count = seen.get(kind) ?? 0;
    if (count > MAX_ISSUES_PER_KIND) {
      kept.push({ kind, location: "capture", message: `${count - MAX_ISSUES_PER_KIND} more ${kind} findings were suppressed to keep the report readable.` });
    }
  }
  return kept.sort(
    (a, b) =>
      ISSUE_KIND_ORDER.indexOf(a.kind) - ISSUE_KIND_ORDER.indexOf(b.kind) ||
      Number(a.location === "capture") - Number(b.location === "capture") ||
      compare(a.location, b.location) ||
      compare(a.message, b.message),
  );
}

export async function buildHarModel(harDocument: Record<string, unknown>, limits: InputLimits): Promise<ApiModel> {
  const startedAt = Date.now();
  const meta = validateHar(harDocument, limits);
  const total = meta.entries.length;

  // 1. Extract and redact each entry; malformed entries are listed and skipped (FR-011).
  const malformedEntries: MalformedEntry[] = [];
  const extracted: ExtractedEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    const result = extractEntry(meta.entries[index], index, limits);
    if (result.kind === "malformed") malformedEntries.push({ entryIndex: index, reason: result.reason });
    else extracted.push(result.entry);
    if (index % 100 === 99) await yieldToEventLoop();
  }

  // 2. Classify: ordered exclusion rules 2 to 9, then the first-party scope (rule 10).
  const ledger = new ExclusionLedger();
  const candidates: ExtractedEntry[] = [];
  for (const entry of extracted) {
    const classification = classifyEntry(entry);
    if (classification.outcome === "exclude") ledger.add(entry, classification.reason);
    else candidates.push(entry);
  }
  const scope = computeOriginScope(candidates, meta.pageTitles);
  const included: ExtractedEntry[] = [];
  for (const entry of candidates) {
    if (isRelatedOrigin(entry.host, scope)) included.push(entry);
    else ledger.add(entry, "third-party-origin");
  }
  await yieldToEventLoop();

  // 3. Path patterns, then groups of entries per origin, method and pattern.
  const ordered = chronological(included);
  const patterns = inferPathPatterns(ordered.map((entry) => ({ origin: entry.origin, method: entry.method, path: entry.path })));
  const pending = new Map<string, PendingGroup>();
  for (const entry of ordered) {
    const inferred = patterns.get(pathKey(entry.origin, entry.method, entry.path)) as InferredPath;
    const key = `${entry.origin}\u0000${entry.method}\u0000${inferred.pattern}`;
    const group = pending.get(key) ?? { origin: entry.origin, method: entry.method, pattern: inferred.pattern, entries: [] };
    group.entries.push(entry);
    pending.set(key, group);
  }

  // 4. A method and path is one operation everywhere in the product, so when two origins show the same
  //    one, the origin with more observations wins (ties: the smaller origin) and the other is excluded.
  const issues: AnalysisIssue[] = [];
  const byMethodPath = new Map<string, PendingGroup[]>();
  for (const group of pending.values()) {
    const key = `${group.method}\u0000${group.pattern}`;
    byMethodPath.set(key, [...(byMethodPath.get(key) ?? []), group]);
  }
  const survivors: PendingGroup[] = [];
  for (const candidatesForPath of byMethodPath.values()) {
    const ranked = [...candidatesForPath].sort((a, b) => b.entries.length - a.entries.length || compare(a.origin, b.origin));
    const [winner, ...losers] = ranked;
    survivors.push(winner);
    for (const loser of losers) {
      for (const entry of loser.entries) ledger.add(entry, "duplicate-method-path-other-origin");
      issues.push({
        kind: "duplicate-operation",
        location: `${winner.method} ${winner.pattern}`,
        message: `${winner.method} ${winner.pattern} was observed on two origins (${winner.origin} and ${loser.origin}). An operation is identified by method and path, so only the one from ${winner.origin}, which had more observations, was imported.`,
      });
    }
  }
  if (survivors.length > MAX_DERIVED_OPERATIONS) {
    throw new InputLimitExceededError(
      "derived-operations",
      MAX_DERIVED_OPERATIONS,
      `The capture would produce ${survivors.length} distinct operations. Capture a narrower session, or filter the requests before saving the HAR.`,
    );
  }

  // 5. Dependency evidence: values one response returned and a later request of another operation sent.
  const position = new Map(ordered.map((entry, index) => [entry.index, index]));
  const entryOperations: EntryOperation[] = survivors
    .flatMap((group) => group.entries.map((entry) => ({ entry, operation: { method: group.method, path: group.pattern } })))
    .sort((a, b) => (position.get(a.entry.index) as number) - (position.get(b.entry.index) as number));
  const dependencyHints = detectDependencies(entryOperations);

  // 6. Build one operation per surviving group.
  const groups: OperationGroup[] = survivors.map((pendingGroup) => {
    const first = pendingGroup.entries[0];
    const accumulator = new OperationAccumulator(
      pendingGroup.origin,
      pendingGroup.method,
      patterns.get(pathKey(first.origin, first.method, first.path)) as InferredPath,
    );
    for (const entry of pendingGroup.entries) {
      accumulator.add(entry, patterns.get(pathKey(entry.origin, entry.method, entry.path)) as InferredPath);
    }
    return accumulator.build();
  });
  const originRank = (origin: string): number => (origin === scope.primaryOrigin ? 0 : 1);
  groups.sort(
    (a, b) =>
      originRank(a.origin) - originRank(b.origin) ||
      compare(a.origin, b.origin) ||
      compare(a.path, b.path) ||
      methodRank(a.method) - methodRank(b.method) ||
      compare(a.method, b.method),
  );
  const operations: ApiOperation[] = [];
  let schemaCount = 0;
  for (const group of groups) {
    const built = buildOperation(group);
    operations.push(built.operation);
    issues.push(...built.issues);
    schemaCount += built.schemaCount;
  }

  // 7. Capture-wide findings and the report.
  const streamed = ledger.countOf("streaming") + extracted.filter((e) => e.scheme === "ws" || e.scheme === "wss").length;
  if (streamed > 0) {
    issues.push({
      kind: "unsupported-content",
      location: "capture",
      message: `${streamed} WebSocket or streaming ${streamed === 1 ? "entry was" : "entries were"} excluded: this transport is not supported.`,
    });
  }

  const importedEntries = groups.reduce((sum, group) => sum + group.observationCount, 0);
  const malformedCount = malformedEntries.length;
  const excludedCount = ledger.total;
  if (importedEntries + excludedCount + malformedCount !== total) {
    throw new InputLayerInvariantError("HAR entry counts do not reconcile.");
  }

  const credentialUrlEntries = extracted.filter((entry) => entry.userinfoRemoved);
  const bodiesSkipped = (reason: "oversized" | "too-deep"): number =>
    extracted.reduce(
      (sum, entry) =>
        sum +
        [entry.requestBody, entry.responseBody].filter((body) => body.kind === "unavailable" && body.reason === reason).length,
      0,
    );
  const limitsApplied: ImportAnalysisReport["limitsApplied"] = [];
  const oversized = bodiesSkipped("oversized");
  if (oversized > 0) limitsApplied.push({ limit: "INPUT_MAX_BODY_BYTES", effect: "body skipped and reported", count: oversized });
  const tooDeep = bodiesSkipped("too-deep");
  if (tooDeep > 0) limitsApplied.push({ limit: "embedded body nesting depth (32)", effect: "body skipped and reported", count: tooDeep });

  const originCounts = new Map<string, { importedEntries: number; operations: number }>();
  for (const group of groups) {
    const current = originCounts.get(group.origin) ?? { importedEntries: 0, operations: 0 };
    current.importedEntries += group.observationCount;
    current.operations += 1;
    originCounts.set(group.origin, current);
  }
  const origins = [...originCounts.entries()]
    .map(([origin, counts]) => ({ origin, ...counts }))
    .sort((a, b) => originRank(a.origin) - originRank(b.origin) || compare(a.origin, b.origin));

  const report: ImportAnalysisReport = {
    counts: { total, imported: importedEntries, excluded: excludedCount, malformed: malformedCount, operations: operations.length },
    ...(meta.harVersion ? { harVersion: meta.harVersion } : {}),
    ...(meta.creator ? { creator: meta.creator } : {}),
    exclusions: ledger.list(),
    malformedEntries,
    origins,
    normalization: {
      trailingSlashesFolded: extracted.filter((e) => e.normalization.trailingSlashFolded).length,
      duplicateSlashesCollapsed: extracted.filter((e) => e.normalization.duplicateSlashesCollapsed).length,
      dotSegmentsRemoved: extracted.reduce((sum, e) => sum + e.normalization.dotSegmentsRemoved, 0),
    },
    credentialUrlCount: credentialUrlEntries.length,
    credentialUrlEntries: credentialUrlEntries
      .slice(0, MAX_CREDENTIAL_URL_ENTRIES)
      .map((entry) => ({ entryIndex: entry.index, host: entry.host })),
    limitsApplied,
  };

  logInputEvent("har_analyzed", {
    format: "har",
    total,
    imported: importedEntries,
    excluded: excludedCount,
    malformed: malformedCount,
    operations: operations.length,
    durationMs: Date.now() - startedAt,
  });

  if (operations.length === 0) {
    throw new NoOperationsDerivedError(
      `No API operations could be derived from this capture: ${excludedCount} ${excludedCount === 1 ? "entry was" : "entries were"} excluded and ${malformedCount} ${malformedCount === 1 ? "was" : "were"} malformed.`,
      { counts: report.counts, exclusions: report.exclusions, malformedEntries: report.malformedEntries },
    );
  }

  const cappedIssues = capIssues(issues);
  return {
    operations,
    securitySchemes: {},
    summary: {
      operationCount: operations.length,
      schemaCount,
      securitySchemeCount: 0,
      issues: cappedIssues,
    },
    importReport: report,
    ...(dependencyHints.length > 0 ? { dependencyHints } : {}),
  };
}
