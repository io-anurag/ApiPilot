import type {
  CleanupStrategy,
  CredentialStatus,
  EnvironmentTier,
  ProfileViolation,
  SecurityProfile,
  SecurityProfileInput,
  TestDataEntry,
  TestIdentity,
  TlsPolicy,
} from "@apipilot/shared-domain";
import type { ScenarioFilterQuery } from "../../services/securityLabClient";
import type { Variant } from "./securityViewModel";

/**
 * Pure view logic for profiles (specs/057 FR-034 to FR-040, data-model.md section 5): the tier rules the form
 * offers, the draft the form edits as text and its conversion to the request body, and the wording of validity and
 * violations. The tier rules mirror `backend/src/securityLab/profiles/tierPolicy.ts` and are pinned to it by a test;
 * the server still enforces every one of them. Nothing here holds a credential value.
 */

/** The tiers a target can be created with. Production is refused by the server, so it is not offered. */
export const TARGET_TIERS: readonly EnvironmentTier[] = ["local", "dev", "qa", "staging"];

export const TIER_LABEL: Readonly<Record<EnvironmentTier, string>> = {
  local: "Local",
  dev: "Dev",
  qa: "QA",
  staging: "Staging",
  production: "Production",
};

/** Only a local profile may name loopback, private or other non-public addresses. Mirrors `allowsRestrictedAddresses`. */
export const allowsAddressRanges = (tier: EnvironmentTier | undefined): boolean => tier === "local";

/** Only a local profile may relax certificate verification. Mirrors `allowsRelaxedTls`. */
export const allowsRelaxedTls = (tier: EnvironmentTier | undefined): boolean => tier === "local";

/** A run against any tier but local is confirmed by typing the exact target name and base URL. Mirrors `requiresTargetRetype`. */
export const requiresTargetRetype = (tier: string): boolean => tier !== "local" && tier !== "production";

export function isTier(value: string): value is EnvironmentTier {
  return value === "local" || value === "dev" || value === "qa" || value === "staging" || value === "production";
}

// ---------------------------------------------------------------------------------------------
// Text fields
// ---------------------------------------------------------------------------------------------

/** One entry per line or comma-separated. Blank entries are dropped. */
export function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Ports from text. An entry that is not a whole number is returned in `invalid`, so the form can name it instead of dropping it. */
export function parsePorts(text: string): { ports: number[]; invalid: string[] } {
  const ports: number[] = [];
  const invalid: string[] = [];
  for (const entry of parseList(text)) {
    if (/^\d+$/.test(entry)) ports.push(Number(entry));
    else invalid.push(entry);
  }
  return { ports, invalid };
}

/** A whole, positive number from a number field, or undefined when it is blank or not one. */
export function parsePositiveInteger(text: string): number | undefined {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? Number(trimmed) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------------------------

export interface IdentityDraft {
  /** Stable across edits, so a row keeps its credential entry state while its name is typed. */
  key: string;
  name: string;
  role: string;
  credentialSchemes: string;
  expiredCredentialSchemes: string;
}

export interface TestDataDraft {
  key: string;
  ownerIdentity: string;
  operationKey: string;
  parameter: string;
  value: string;
}

export interface ProfileDraft {
  name: string;
  environmentId: string;
  allowedHosts: string;
  allowedPorts: string;
  allowedAddressRanges: string;
  tlsPolicy: TlsPolicy;
  identities: IdentityDraft[];
  testData: TestDataDraft[];
  timeoutMs: string;
  maxRequests: string;
  maxConcurrency: string;
  permittedCategories: string[];
  destructivePermitted: boolean;
  cleanupStrategy: CleanupStrategy["strategy"];
  cleanupIdField: string;
}

let keyCounter = 0;
export const nextKey = (prefix: string): string => `${prefix}-${++keyCounter}`;

export const emptyIdentity = (): IdentityDraft => ({ key: nextKey("identity"), name: "", role: "", credentialSchemes: "", expiredCredentialSchemes: "" });
export const emptyTestData = (): TestDataDraft => ({ key: nextKey("data"), ownerIdentity: "", operationKey: "", parameter: "", value: "" });

/** Defaults match the server's own (`PROFILE_DEFAULTS`), so a new profile starts with the documented limits. */
export function draftFromProfile(profile?: SecurityProfile): ProfileDraft {
  if (!profile) {
    return {
      name: "",
      environmentId: "",
      allowedHosts: "",
      allowedPorts: "",
      allowedAddressRanges: "",
      tlsPolicy: "verify",
      identities: [],
      testData: [],
      timeoutMs: "10000",
      maxRequests: "100",
      maxConcurrency: "1",
      permittedCategories: [],
      destructivePermitted: false,
      cleanupStrategy: "none",
      cleanupIdField: "",
    };
  }
  return {
    name: profile.name,
    environmentId: profile.environmentId,
    allowedHosts: profile.allowedHosts.join("\n"),
    allowedPorts: profile.allowedPorts.join(", "),
    allowedAddressRanges: profile.allowedAddressRanges.join("\n"),
    tlsPolicy: profile.tlsPolicy,
    identities: profile.identities.map((identity) => ({
      key: nextKey("identity"),
      name: identity.name,
      role: identity.role,
      credentialSchemes: identity.credentialSchemes.join("\n"),
      expiredCredentialSchemes: (identity.expiredCredentialSchemes ?? []).join("\n"),
    })),
    testData: profile.testData.map((entry) => ({
      key: nextKey("data"),
      ownerIdentity: entry.ownerIdentity,
      operationKey: entry.operationKey ?? "",
      parameter: entry.parameter,
      value: entry.value,
    })),
    timeoutMs: String(profile.timeoutMs),
    maxRequests: String(profile.maxRequests),
    maxConcurrency: String(profile.maxConcurrency),
    permittedCategories: [...profile.permittedCategories],
    destructivePermitted: profile.destructivePermitted,
    cleanupStrategy: profile.cleanup.strategy,
    cleanupIdField: profile.cleanup.strategy === "delete-created-via-spec" ? profile.cleanup.idField : "",
  };
}

export interface DraftInput {
  /** The request body, when every field could be read. */
  readonly input?: SecurityProfileInput;
  /** Fields that could not be read as typed (a port that is not a number, a limit that is not a whole number). */
  readonly errors: ReadonlyArray<{ field: string; message: string }>;
}

function identityOf(draft: IdentityDraft): TestIdentity {
  const expired = parseList(draft.expiredCredentialSchemes);
  return {
    name: draft.name.trim(),
    role: draft.role.trim(),
    credentialSchemes: parseList(draft.credentialSchemes),
    ...(expired.length > 0 ? { expiredCredentialSchemes: expired } : {}),
  };
}

/**
 * The request body for a draft. Address ranges are sent only for a local target and relaxed TLS only for a local
 * target, so a tier change never leaves a value behind that the server would refuse. Everything the form could not
 * read is returned as an error that names the field; nothing is clamped or guessed.
 */
export function inputFromDraft(draft: ProfileDraft, tier: EnvironmentTier | undefined): DraftInput {
  const errors: Array<{ field: string; message: string }> = [];
  const ports = parsePorts(draft.allowedPorts);
  if (ports.invalid.length > 0) errors.push({ field: "allowedPorts", message: `These are not port numbers: ${ports.invalid.join(", ")}.` });

  const limit = (field: "timeoutMs" | "maxRequests" | "maxConcurrency", label: string): number => {
    const value = parsePositiveInteger(draft[field]);
    if (value === undefined) {
      errors.push({ field, message: `${label} must be a whole number of at least 1.` });
      return 0;
    }
    return value;
  };
  const timeoutMs = limit("timeoutMs", "The timeout");
  const maxRequests = limit("maxRequests", "The request limit");
  const maxConcurrency = limit("maxConcurrency", "The concurrency limit");

  if (draft.cleanupStrategy === "delete-created-via-spec" && draft.cleanupIdField.trim() === "") {
    errors.push({ field: "cleanup.idField", message: "Name the response field that holds the id of what a scenario creates." });
  }
  if (errors.length > 0) return { errors };

  const cleanup: CleanupStrategy = draft.cleanupStrategy === "none" ? { strategy: "none" } : { strategy: "delete-created-via-spec", idField: draft.cleanupIdField.trim() };
  const testData: TestDataEntry[] = draft.testData.map((entry) => ({
    ownerIdentity: entry.ownerIdentity,
    ...(entry.operationKey.trim() !== "" ? { operationKey: entry.operationKey.trim() } : {}),
    parameter: entry.parameter.trim(),
    value: entry.value,
  }));
  return {
    errors,
    input: {
      name: draft.name.trim(),
      environmentId: draft.environmentId,
      allowedHosts: parseList(draft.allowedHosts),
      allowedPorts: ports.ports,
      allowedAddressRanges: allowsAddressRanges(tier) ? parseList(draft.allowedAddressRanges) : [],
      tlsPolicy: allowsRelaxedTls(tier) ? draft.tlsPolicy : "verify",
      identities: draft.identities.map(identityOf),
      testData,
      timeoutMs,
      maxRequests,
      maxConcurrency,
      permittedCategories: draft.permittedCategories,
      destructivePermitted: draft.destructivePermitted,
      cleanup,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Violations and validity
// ---------------------------------------------------------------------------------------------

/** A violation as one line of text: the code, the field it is about and the sentence. Never colour alone. */
export const violationText = (violation: ProfileViolation): string => `${violation.code} (${violation.field}): ${violation.message}`;

/** The `violations` of a `profile_invalid` reply, read defensively from the error details. */
export function parseProfileViolations(details: Record<string, unknown>): ProfileViolation[] {
  const raw = details.violations;
  if (!Array.isArray(raw)) return [];
  const violations: ProfileViolation[] = [];
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      if (typeof record.field === "string" && typeof record.code === "string" && typeof record.message === "string") {
        violations.push({ field: record.field, code: record.code as ProfileViolation["code"], message: record.message });
      }
    }
  }
  return violations;
}

export const VALIDITY: Readonly<{ valid: Variant; invalid: Variant }> = {
  valid: { label: "Valid", tone: "success" },
  invalid: { label: "Not valid", tone: "danger" },
};

export function credentialSummary(status: readonly CredentialStatus[]): string {
  if (status.length === 0) return "No credentials declared";
  const set = status.filter((entry) => entry.set).length;
  return `${set} of ${status.length} credentials set`;
}

/** The status entries for one identity. */
export const statusForIdentity = (status: readonly CredentialStatus[], identity: string): CredentialStatus[] => status.filter((entry) => entry.identity === identity);

/** The filter the approved-scenario list uses: only approved scenarios, judged against the chosen profile. */
export const approvedFilter = (profileId: string | undefined): ScenarioFilterQuery => ({ reviewState: "approved", ...(profileId ? { profileId } : {}) });
