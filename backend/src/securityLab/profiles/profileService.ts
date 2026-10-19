import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import type {
  ApiModel,
  CredentialStatus,
  ProfileCheck,
  ProfileView,
  ProfileViolation,
  SecurityProfile,
  SecurityProfileInput,
  TargetEnvironment,
} from "@apipilot/shared-domain";
import type { CredentialKind, SecurityCredentialRepository } from "../../persistence/securityCredentialRepository";
import type { SecurityProfileRepository } from "../../persistence/securityProfileRepository";
import type { SecurityRunRepository } from "../../persistence/securityRunRepository";
import type { SecurityLabLimits } from "../config";
import { SecurityLabError, invalidRequest, profileNotFound } from "../errors";
import { classifyAddress, describeBlockReason, evaluateDestination, selectAllowedAddress } from "../execution/destinationPolicy";
import { ProfileInvalidError, parseProfileInput, validateProfile } from "./profileValidation";

/**
 * Profile CRUD and the write-only credential path (specs/057 FR-034 to FR-040, FR-048, research R8). A profile is
 * **session data** in the session-scoped repository: it names identities and the security schemes they hold
 * credentials for, and never a value. A credential value goes in through `setCredential` only, into the
 * encrypted, write-only store, and nothing in this module returns one. Validation runs on save and again on every
 * use, because the specification and the target can change in between.
 */

/** Resolves a host name to every address it maps to. Injected so tests never touch a network. */
export type NameResolver = (hostname: string) => Promise<string[]>;

export const systemNameResolver: NameResolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

export interface ProfileContext {
  readonly sessionId: string;
  readonly now: () => Date;
  readonly limits: SecurityLabLimits;
  readonly profiles: SecurityProfileRepository;
  readonly credentials: SecurityCredentialRepository;
  readonly runs: Pick<SecurityRunRepository, "getInProgress">;
  /** The session's target environment, or throws `environment_not_found`. Name, tier and base URL only. */
  readonly getEnvironment: (id: string) => TargetEnvironment;
  readonly resolveName: NameResolver;
  readonly newId?: () => string;
  /** The loaded specification, when there is one. */
  readonly apiModel?: ApiModel;
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

/** Every credential a profile's identities declare, with whether it is set. A value is never read. */
export function credentialStatusOf(context: Pick<ProfileContext, "sessionId" | "credentials">, profile: SecurityProfile): CredentialStatus[] {
  const status: CredentialStatus[] = [];
  const add = (identity: string, scheme: string, kind: CredentialKind) =>
    status.push({ identity, scheme, kind, set: context.credentials.isSet(context.sessionId, { profileId: profile.id, identity, scheme, kind }) });
  for (const identity of profile.identities) {
    for (const scheme of identity.credentialSchemes) add(identity.name, scheme, "active");
    for (const scheme of identity.expiredCredentialSchemes ?? []) add(identity.name, scheme, "expired");
  }
  return status;
}

function environmentOf(context: ProfileContext, id: string): TargetEnvironment | undefined {
  try {
    return context.getEnvironment(id);
  } catch (error) {
    if (error instanceof SecurityLabError && error.code === "environment_not_found") return undefined;
    throw error;
  }
}

/** The problems a stored profile has right now. A missing target is a problem of its own, never a thrown error. */
export function problemsOf(context: ProfileContext, profile: SecurityProfile): { environment?: TargetEnvironment; problems: ProfileViolation[] } {
  const environment = environmentOf(context, profile.environmentId);
  if (!environment) {
    return {
      problems: [{ field: "environmentId", code: "environment_not_found", message: "The target environment this profile points at no longer exists. Choose or create another target." }],
    };
  }
  return { environment, problems: validateProfile(profile, { environment, ceilings: context.limits.ceilings, apiModel: context.apiModel }) };
}

function toView(context: ProfileContext, profile: SecurityProfile): ProfileView {
  const { environment, problems } = problemsOf(context, profile);
  return {
    profile,
    ...(environment ? { environment: { name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl } } : {}),
    credentialStatus: credentialStatusOf(context, profile),
    valid: problems.length === 0,
    problems,
  };
}

export function listProfiles(context: ProfileContext): ProfileView[] {
  return context.profiles.list(context.sessionId).map((profile) => toView(context, profile));
}

function requireProfile(context: ProfileContext, id: string): SecurityProfile {
  const profile = context.profiles.get(context.sessionId, id);
  if (!profile) throw profileNotFound(id);
  return profile;
}

export function getProfile(context: ProfileContext, id: string): ProfileView {
  return toView(context, requireProfile(context, id));
}

/**
 * The profile for a run: stored, current and valid, or a typed refusal. Called on every use, so a profile saved
 * earlier that no longer satisfies the rules (the target became production, a ceiling was lowered, the specification
 * changed) cannot be used.
 */
export function loadProfileForUse(context: ProfileContext, id: string): { profile: SecurityProfile; environment: TargetEnvironment } {
  const profile = requireProfile(context, id);
  const { environment, problems } = problemsOf(context, profile);
  if (!environment || problems.length > 0) throw new ProfileInvalidError(problems);
  return { profile, environment };
}

// ---------------------------------------------------------------------------------------------
// Create, update, delete
// ---------------------------------------------------------------------------------------------

function checkAndBuild(context: ProfileContext, body: unknown, existing?: SecurityProfile): SecurityProfileInput {
  const input = parseProfileInput(body);
  const environment = context.getEnvironment(input.environmentId);
  const problems = validateProfile(input, { environment, ceilings: context.limits.ceilings, apiModel: context.apiModel });
  const sameName = context.profiles.findByName(context.sessionId, input.name);
  if (sameName && sameName.id !== existing?.id) {
    problems.push({ field: "name", code: "name_duplicate", message: `Another profile is already named '${input.name}'.` });
  }
  if (problems.length > 0) throw new ProfileInvalidError(problems);
  return input;
}

export function createProfile(context: ProfileContext, body: unknown): ProfileView {
  const input = checkAndBuild(context, body);
  const now = context.now().toISOString();
  const profile: SecurityProfile = { ...input, id: (context.newId ?? randomUUID)(), createdAt: now, updatedAt: now };
  context.profiles.create(context.sessionId, profile);
  return toView(context, profile);
}

/** The keys of every credential a profile declares, for working out which an edit removes. */
function declaredCredentials(profile: SecurityProfile): Set<string> {
  const keys = new Set<string>();
  for (const identity of profile.identities) {
    for (const scheme of identity.credentialSchemes) keys.add(JSON.stringify([identity.name, scheme, "active"]));
    for (const scheme of identity.expiredCredentialSchemes ?? []) keys.add(JSON.stringify([identity.name, scheme, "expired"]));
  }
  return keys;
}

function assertNotInUse(context: ProfileContext, id: string): void {
  const running = context.runs.getInProgress(context.sessionId);
  if (running?.profileSummary.profileId === id) {
    throw new SecurityLabError("profile_in_use", "A run is using this profile. Cancel it or wait for it to finish before changing or deleting the profile.");
  }
}

/** Replaces a profile. A credential the new version no longer declares is removed from the store with it. */
export function updateProfile(context: ProfileContext, id: string, body: unknown): ProfileView {
  const existing = requireProfile(context, id);
  assertNotInUse(context, id);
  const input = checkAndBuild(context, body, existing);
  const profile: SecurityProfile = { ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: context.now().toISOString() };

  const kept = declaredCredentials(profile);
  for (const key of declaredCredentials(existing)) {
    if (kept.has(key)) continue;
    const [identity, scheme, kind] = JSON.parse(key) as [string, string, CredentialKind];
    context.credentials.clear(context.sessionId, { profileId: id, identity, scheme, kind });
  }
  context.profiles.update(context.sessionId, profile);
  return toView(context, profile);
}

export function deleteProfile(context: ProfileContext, id: string): void {
  requireProfile(context, id);
  assertNotInUse(context, id);
  context.credentials.deleteByProfile(context.sessionId, id);
  context.profiles.delete(context.sessionId, id);
}

// ---------------------------------------------------------------------------------------------
// Credentials (write-only)
// ---------------------------------------------------------------------------------------------

const MAX_CREDENTIAL_LENGTH = 8192;

export interface CredentialInput {
  identity: string;
  scheme: string;
  kind: CredentialKind;
  value: string;
}

export function parseCredentialInput(body: unknown): CredentialInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalidRequest("The request body must be an object.");
  const record = body as Record<string, unknown>;
  const allowed = new Set(["identity", "scheme", "kind", "value"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw invalidRequest(`'${key}' is not a credential field. Send 'identity', 'scheme', 'kind' and 'value'.`);
  if (typeof record.identity !== "string" || record.identity === "") throw invalidRequest("'identity' must be the name of one of the profile's identities.");
  if (typeof record.scheme !== "string" || record.scheme === "") throw invalidRequest("'scheme' must be a security scheme the identity declares.");
  if (record.kind !== "active" && record.kind !== "expired") throw invalidRequest("'kind' must be \"active\" or \"expired\".");
  if (typeof record.value !== "string" || record.value.length > MAX_CREDENTIAL_LENGTH) {
    throw invalidRequest(`'value' must be a string of at most ${MAX_CREDENTIAL_LENGTH} characters. An empty string clears the credential.`);
  }
  return { identity: record.identity, scheme: record.scheme, kind: record.kind, value: record.value };
}

/**
 * Stores or clears one credential. The identity and scheme must be ones the profile declares for that kind, so the
 * store never holds a credential nothing can use. Returns nothing: there is no read path to a value.
 */
export function setCredential(context: ProfileContext, id: string, body: unknown): void {
  const profile = requireProfile(context, id);
  const input = parseCredentialInput(body);
  const identity = profile.identities.find((candidate) => candidate.name === input.identity);
  if (!identity) {
    throw new ProfileInvalidError([{ field: "identity", code: "credential_identity_unknown", message: `The profile has no identity named '${input.identity}'.` }]);
  }
  const declared = input.kind === "active" ? identity.credentialSchemes : (identity.expiredCredentialSchemes ?? []);
  if (!declared.includes(input.scheme)) {
    throw new ProfileInvalidError([
      {
        field: "scheme",
        code: "credential_scheme_not_declared",
        message: `The identity '${identity.name}' does not declare the '${input.scheme}' scheme for ${input.kind} credentials. Add it to the identity first.`,
      },
    ]);
  }
  context.credentials.set(
    context.sessionId,
    { profileId: id, identity: input.identity, scheme: input.scheme, kind: input.kind },
    input.value,
    context.now().toISOString(),
  );
}

export function getCredentialStatus(context: ProfileContext, id: string): { credentialStatus: CredentialStatus[] } {
  return { credentialStatus: credentialStatusOf(context, requireProfile(context, id)) };
}

// ---------------------------------------------------------------------------------------------
// Check (dry validation; resolves, never connects)
// ---------------------------------------------------------------------------------------------

/**
 * Re-validates the stored profile and resolves the base URL's host under the destination policy **without sending a
 * request**. A host is resolved only after it passes the URL-level checks, so this route cannot be used to resolve an
 * arbitrary name. A name that resolves to nothing, or fails to resolve, is reported as a problem and never as a pass.
 */
export async function checkProfile(context: ProfileContext, id: string): Promise<ProfileCheck> {
  const profile = requireProfile(context, id);
  const { environment, problems } = problemsOf(context, profile);
  if (!environment) return { valid: false, problems };

  const policy = {
    tier: environment.tier,
    allowedHosts: profile.allowedHosts,
    allowedPorts: profile.allowedPorts,
    allowedAddressRanges: profile.allowedAddressRanges,
  };
  const urlVerdict = evaluateDestination(policy, environment.baseUrl);
  if (!urlVerdict.allowed) {
    return {
      valid: false,
      problems,
      destination: { host: urlVerdict.host ?? "", port: urlVerdict.port ?? 0, addresses: [], blockedReason: urlVerdict.reason, explanation: describeBlockReason(urlVerdict.reason) },
    };
  }

  const { host, port } = urlVerdict;
  let candidates: string[];
  if (urlVerdict.addressClass !== undefined) {
    // A literal IP host is its own address; nothing to resolve.
    candidates = [host];
  } else {
    try {
      candidates = await context.resolveName(host);
    } catch {
      return {
        valid: false,
        problems: [...problems, { field: "environmentId", code: "host_not_resolved", message: `The host '${host}' could not be resolved. Check the target's base URL and your network.` }],
        destination: { host, port, addresses: [] },
      };
    }
    if (candidates.length === 0) {
      return {
        valid: false,
        problems: [...problems, { field: "environmentId", code: "host_not_resolved", message: `The host '${host}' resolved to no address.` }],
        destination: { host, port, addresses: [] },
      };
    }
  }

  const addresses = candidates.map((address) => {
    const verdict = evaluateDestination(policy, environment.baseUrl, address);
    return {
      address,
      addressClass: classifyAddress(address),
      allowed: verdict.allowed,
      ...(verdict.allowed ? {} : { reason: verdict.reason, explanation: describeBlockReason(verdict.reason) }),
    };
  });
  const chosen = selectAllowedAddress(policy, environment.baseUrl, candidates);
  const first = addresses[0];
  const destination: NonNullable<ProfileCheck["destination"]> = {
    host,
    port,
    ...(chosen.allowed ? { resolvedClass: classifyAddress(chosen.address), connectTo: chosen.address } : first?.addressClass ? { resolvedClass: first.addressClass } : {}),
    addresses,
    ...(chosen.allowed ? {} : { blockedReason: first?.reason, explanation: first?.explanation }),
  };
  const blockProblems: ProfileViolation[] = chosen.allowed
    ? []
    : [{ field: "environmentId", code: "destination_blocked", message: `A request to this target would be blocked (${first?.reason}): ${first?.explanation}` }];
  return { valid: problems.length === 0 && chosen.allowed, problems: [...problems, ...blockProblems], destination };
}
