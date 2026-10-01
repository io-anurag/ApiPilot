import type {
  PerformanceThresholdMetric,
  ScriptCheckResult,
  UserScriptLoad,
  UserScriptRunSettings,
  UserScriptThreshold,
  UserScriptThresholdScope,
  UserScriptValueSource,
} from "@apipilot/shared-domain";
import { USER_SCRIPT_MAX_MAPPINGS, USER_SCRIPT_MAX_THRESHOLDS } from "@apipilot/shared-domain";
import type { StoredUserScriptSettings } from "../../persistence/userScriptRepository";
import { compareCodeUnits } from "../../postman/ordering";
import { InvalidLoadProfileError, InvalidMappingNameError, InvalidUserScriptSettingsError } from "../errors";
import { canonicalJson, thresholdIdFor } from "../plan/identifiers";
import { validateLoadProfile } from "../plan/loadProfiles";
import { mappingNameRefusalText, validateMappingName } from "./mappingNames";

/**
 * A user script's run settings: the mapping of environment variable names to environment values,
 * the load choice and the ApiPilot thresholds (specs/034-run-user-k6-script FR-025 to FR-028;
 * research R12, R15). Pure. Settings hold names and sources only, never a value, and changing them
 * never changes the script's bytes or its confirmation.
 */

function sortMapping(mapping: StoredUserScriptSettings["mapping"]): StoredUserScriptSettings["mapping"] {
  return [...mapping].sort((a, b) => compareCodeUnits(a.name, b.name));
}

function defaultSource(name: string, suggested: UserScriptValueSource | undefined): UserScriptValueSource {
  if (suggested) return suggested;
  return name === "BASE_URL" ? { kind: "base-url" } : { kind: "environment-value", valueName: name };
}

function foundNames(check: ScriptCheckResult) {
  return check.accepted ? check.envNames.filter((entry) => entry.mappable) : [];
}

/** Research R12: one entry per mappable name found, the script's own load, no thresholds. */
export function initialSettings(check: ScriptCheckResult): StoredUserScriptSettings {
  return {
    mapping: sortMapping(foundNames(check).map((entry) => ({ name: entry.name, source: defaultSource(entry.name, entry.suggestedSource) }))),
    removedNames: [],
    load: { kind: "script" },
    thresholds: [],
  };
}

/** After a content change: add names now found that are neither mapped nor removed; keep every other entry. */
export function mergeSettingsAfterContentChange(settings: StoredUserScriptSettings, check: ScriptCheckResult): StoredUserScriptSettings {
  const mapped = new Set(settings.mapping.map((entry) => entry.name));
  const removed = new Set(settings.removedNames);
  const added = foundNames(check)
    .filter((entry) => !mapped.has(entry.name) && !removed.has(entry.name))
    .map((entry) => ({ name: entry.name, source: defaultSource(entry.name, entry.suggestedSource) }));
  return { ...settings, mapping: sortMapping([...settings.mapping, ...added]) };
}

export function withFoundFlags(settings: StoredUserScriptSettings, check: ScriptCheckResult): UserScriptRunSettings {
  const found = new Set(check.accepted ? check.envNames.map((entry) => entry.name) : []);
  return { ...settings, mapping: settings.mapping.map((entry) => ({ ...entry, foundInScript: found.has(entry.name) })) };
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidUserScriptSettingsError(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function parseSource(raw: unknown): UserScriptValueSource {
  const source = record(raw, "A mapping's source");
  if (source.kind === "base-url") return { kind: "base-url" };
  if (source.kind === "environment-value" && typeof source.valueName === "string" && source.valueName.trim() !== "" && source.valueName.length <= 256) {
    return { kind: "environment-value", valueName: source.valueName };
  }
  throw new InvalidUserScriptSettingsError("A mapping's source is the environment's base URL or an environment value named by its name.");
}

const METRICS: ReadonlySet<string> = new Set(["p50", "p90", "p95", "p99", "error-rate"]);

function parseThreshold(raw: unknown): UserScriptThreshold {
  const threshold = record(raw, "A threshold");
  const scopeRecord = record(threshold.scope ?? {}, "A threshold's scope");
  let scope: UserScriptThresholdScope;
  if (scopeRecord.kind === "run") scope = { kind: "run" };
  else if (scopeRecord.kind === "request-name" && typeof scopeRecord.name === "string" && scopeRecord.name.trim() !== "" && scopeRecord.name.length <= 512) {
    scope = { kind: "request-name", name: scopeRecord.name };
  } else throw new InvalidUserScriptSettingsError("A threshold applies to the whole run or to one request name.");
  if (typeof threshold.metric !== "string" || !METRICS.has(threshold.metric)) throw new InvalidUserScriptSettingsError("A threshold's metric must be p50, p90, p95, p99 or error-rate.");
  const metric = threshold.metric as PerformanceThresholdMetric;
  if (threshold.comparator !== "<=") throw new InvalidUserScriptSettingsError("A threshold's comparator must be <=.");
  const limit = threshold.limit;
  if (typeof limit !== "number" || !Number.isFinite(limit)) throw new InvalidUserScriptSettingsError("A threshold needs a numeric limit.");
  if (metric === "error-rate" ? limit < 0 || limit > 100 : limit <= 0) {
    throw new InvalidUserScriptSettingsError(metric === "error-rate" ? "An error-rate limit is a percentage from 0 to 100." : "A latency limit must be over 0 ms.");
  }
  return { id: thresholdIdFor(canonicalJson({ scope, metric, limit })), scope, metric, comparator: "<=", limit };
}

function parseLoad(raw: unknown): UserScriptLoad {
  const load = record(raw, "The load choice");
  if (load.kind === "script") return { kind: "script" };
  if (load.kind !== "profile") throw new InvalidUserScriptSettingsError("The load is the script's own settings or a load profile.");
  try {
    return { kind: "profile", profile: validateLoadProfile(load.profile) };
  } catch (error) {
    if (error instanceof InvalidLoadProfileError) throw new InvalidUserScriptSettingsError(error.message);
    throw error;
  }
}

/** Validates a `PUT /settings` body (FR-025 to FR-028). Throws `InvalidMappingNameError` or `InvalidUserScriptSettingsError`. */
export function parseSettings(input: unknown): StoredUserScriptSettings {
  const body = record(input, "The settings");
  if (!Array.isArray(body.mapping)) throw new InvalidUserScriptSettingsError("mapping must be a list.");
  if (body.mapping.length > USER_SCRIPT_MAX_MAPPINGS) throw new InvalidUserScriptSettingsError(`At most ${USER_SCRIPT_MAX_MAPPINGS} names can be mapped.`);
  const seen = new Set<string>();
  const mapping = body.mapping.map((raw) => {
    const entry = record(raw, "A mapping");
    if (typeof entry.name !== "string") throw new InvalidUserScriptSettingsError("A mapping needs a name.");
    const reason = validateMappingName(entry.name);
    if (reason) throw new InvalidMappingNameError(entry.name, reason, mappingNameRefusalText(reason));
    if (seen.has(entry.name)) throw new InvalidUserScriptSettingsError("Each name can be mapped once.");
    seen.add(entry.name);
    return { name: entry.name, source: parseSource(entry.source) };
  });
  const removedRaw = body.removedNames ?? [];
  if (!Array.isArray(removedRaw) || removedRaw.some((name) => typeof name !== "string")) throw new InvalidUserScriptSettingsError("removedNames must be a list of names.");
  const thresholdsRaw = body.thresholds ?? [];
  if (!Array.isArray(thresholdsRaw)) throw new InvalidUserScriptSettingsError("thresholds must be a list.");
  if (thresholdsRaw.length > USER_SCRIPT_MAX_THRESHOLDS) throw new InvalidUserScriptSettingsError(`At most ${USER_SCRIPT_MAX_THRESHOLDS} thresholds can be set.`);
  const thresholds = thresholdsRaw.map(parseThreshold);
  return {
    mapping: sortMapping(mapping),
    removedNames: [...new Set(removedRaw as string[])].sort(compareCodeUnits),
    load: parseLoad(body.load ?? { kind: "script" }),
    thresholds,
  };
}
