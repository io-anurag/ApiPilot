import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { compareCodeUnits, compareRequestSortKeys, requestSortKey } from "./ordering";

/**
 * Grouping, naming, disambiguation, and ordering for the exported collection (FR-004, FR-005).
 * Every rule here is deterministic and independent of input order.
 */

const UNGROUPED = "Ungrouped";
const AWKWARD_LABEL_CHARACTERS = /[/\\:*?"<>|]+/g;

/** Makes a grouping label safe to use as a folder name without losing its meaning. */
export function sanitizeFolderName(raw: string): string {
  const collapsed = raw.trim().replace(AWKWARD_LABEL_CHARACTERS, "-").replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : UNGROUPED;
}

/**
 * The raw grouping label an operation carries, before it is made safe as a folder name:
 * its first declared tag, else its first path segment, else `Ungrouped`.
 */
function groupingLabel(operation: ApiOperation): string {
  const firstTag = operation.tags.find((tag) => tag.trim().length > 0);
  if (firstTag) return firstTag;
  const firstSegment = operation.path.split("/").find((segment) => segment.trim().length > 0);
  return firstSegment ?? UNGROUPED;
}

/**
 * The folder an operation belongs to: its first declared tag, else the first path segment,
 * else a single `Ungrouped` folder.
 */
export function folderNameForOperation(operation: ApiOperation): string {
  return sanitizeFolderName(groupingLabel(operation));
}

/** `METHOD /path — category`, so the operation and the scenario's purpose are visible. */
export function requestNameForScenario(scenario: TestScenario): string {
  return `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath} — ${scenario.category}`;
}

export interface ScenarioWithOperation {
  scenario: TestScenario;
  operation: ApiOperation;
}

export interface NamedEntry extends ScenarioWithOperation {
  requestName: string;
}

export interface GroupedFolder {
  name: string;
  entries: NamedEntry[];
}

/** Appends the lowest unused numeric suffix, deterministically. */
function disambiguate(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let suffix = 2;
  while (taken.has(`${name} (${suffix})`)) suffix += 1;
  const disambiguated = `${name} (${suffix})`;
  taken.add(disambiguated);
  return disambiguated;
}

function sortKeyFor(pair: ScenarioWithOperation) {
  return requestSortKey({
    path: pair.scenario.operationPath,
    method: pair.scenario.operationMethod,
    category: pair.scenario.category,
    scenarioId: pair.scenario.id,
  });
}

function nameEntries(pairs: ScenarioWithOperation[]): NamedEntry[] {
  const takenRequestNames = new Set<string>();
  return [...pairs]
    .sort((a, b) => compareRequestSortKeys(sortKeyFor(a), sortKeyFor(b)))
    .map((pair) => ({
      ...pair,
      requestName: disambiguate(requestNameForScenario(pair.scenario), takenRequestNames),
    }));
}

/**
 * Groups scenarios into ordered, uniquely named folders of ordered, uniquely named requests.
 * Grouping keys on the operation's raw label, so two labels that sanitize to the same folder
 * name stay distinct folders; ordering and suffixing are driven by the sort keys, never by the
 * order the scenarios arrived in.
 */
export function groupAndName(pairs: ScenarioWithOperation[]): GroupedFolder[] {
  const groups = new Map<string, { label: string; pairs: ScenarioWithOperation[] }>();
  for (const pair of pairs) {
    const key = groupingLabel(pair.operation);
    const group = groups.get(key) ?? { label: sanitizeFolderName(key), pairs: [] };
    group.pairs.push(pair);
    groups.set(key, group);
  }

  const takenFolderNames = new Set<string>();
  return [...groups.entries()]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([, group]) => ({
      name: disambiguate(group.label, takenFolderNames),
      entries: nameEntries(group.pairs),
    }))
    .filter((folder) => folder.entries.length > 0)
    .sort((a, b) => compareCodeUnits(a.name, b.name));
}