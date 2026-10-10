import {
  COVERAGE_GAP_KINDS,
  COVERAGE_PRIORITIES,
  COVERAGE_SORT_KEYS,
  COVERAGE_STATES,
  type CoverageFilter,
  type CoveragePriority,
  type CoverageSortKey,
  type CoverageState,
} from "@apipilot/shared-domain";
import { CategoryUnavailableError, InvalidCoverageFilterError } from "./errors";

export const MAX_PATH_QUERY_LENGTH = 200;
const METHODS = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"];
const CATEGORIES = ["positive", "negative", "boundary"] as const;

export interface CoverageQuery {
  filter: CoverageFilter;
  runId?: string;
  format?: "html" | "json";
  scope: "filtered" | "all";
}

/** Repeated (`a=1&a=2`) and comma-separated (`a=1,2`) values both yield a list. */
function list(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw.flatMap((v) => (typeof v === "string" ? v.split(",") : [String(v)])).map((v) => v.trim()).filter((v) => v.length > 0);
}

function oneOf<T extends string>(name: string, values: string[], allowed: readonly T[]): T[] {
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new InvalidCoverageFilterError(`"${value}" is not a valid ${name}. Allowed values: ${allowed.join(", ")}.`);
    }
  }
  return values as T[];
}

function single(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InvalidCoverageFilterError(`${name} must be a single value.`);
  return value;
}

/** Validates the query string of the coverage routes against closed vocabularies (contracts/coverage-routes.md). */
export function parseCoverageQuery(query: Record<string, unknown>): CoverageQuery {
  const filter: CoverageFilter = {};

  const methods = oneOf("method", list(query.method).map((m) => m.toUpperCase()), METHODS);
  if (methods.length) filter.methods = methods;

  const q = single("q", query.q);
  if (q !== undefined) {
    if (q.length > MAX_PATH_QUERY_LENGTH) throw new InvalidCoverageFilterError(`q must be at most ${MAX_PATH_QUERY_LENGTH} characters.`);
    if (q.trim().length > 0) filter.q = q;
  }

  const states = oneOf<CoverageState>("state", list(query.state), COVERAGE_STATES);
  if (states.length) filter.states = states;

  const category = single("category", query.category);
  if (category === "security") {
    throw new CategoryUnavailableError("security", "no scenario category identifies authorization intent, so it is not measured.");
  }
  if (category !== undefined && category !== "") filter.category = oneOf("category", [category], CATEGORIES)[0];

  const priorities = oneOf<CoveragePriority>("priority", list(query.priority), COVERAGE_PRIORITIES);
  if (priorities.length) filter.priorities = priorities;

  const gapKind = single("gapKind", query.gapKind);
  if (gapKind !== undefined && gapKind !== "") filter.gapKind = oneOf("gapKind", [gapKind], COVERAGE_GAP_KINDS)[0];

  const sort = single("sort", query.sort);
  if (sort !== undefined && sort !== "") filter.sort = oneOf<CoverageSortKey>("sort", [sort], COVERAGE_SORT_KEYS)[0];

  const order = single("order", query.order);
  if (order !== undefined && order !== "") filter.order = oneOf("order", [order], ["asc", "desc"] as const)[0];

  const runId = single("runId", query.runId);
  const format = single("format", query.format);
  const scope = single("scope", query.scope);

  return {
    filter,
    ...(runId !== undefined && runId !== "" ? { runId } : {}),
    ...(format !== undefined && format !== "" ? { format: oneOf("format", [format], ["html", "json"] as const)[0] } : {}),
    scope: scope === undefined || scope === "" ? "filtered" : oneOf("scope", [scope], ["filtered", "all"] as const)[0],
  };
}

/** A readable description of a filter, shown in exports so a reader knows which view they hold. */
export function describeFilter(filter: CoverageFilter, scope: "filtered" | "all"): string {
  if (scope === "all") return "All operations (no filter applied)";
  const parts: string[] = [];
  if (filter.methods?.length) parts.push(`method ${filter.methods.join(", ")}`);
  if (filter.q) parts.push(`path contains "${filter.q}"`);
  if (filter.states?.length) parts.push(`state ${filter.states.join(", ")}`);
  if (filter.category) parts.push(`category ${filter.category}`);
  if (filter.priorities?.length) parts.push(`priority ${filter.priorities.join(", ")}`);
  if (filter.gapKind) parts.push(`gap type ${filter.gapKind}`);
  return parts.length ? `Filtered: ${parts.join("; ")}` : "All operations (no filter applied)";
}
