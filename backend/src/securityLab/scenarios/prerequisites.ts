import type { Prerequisite, PrerequisiteKind, SecurityProfile } from "@apipilot/shared-domain";

/**
 * Prerequisites of a scenario and how they are judged (specs/057 FR-016, data-model.md section 4). A scenario
 * stores what it *needs*; whether each need is met is **derived at read time** from the selected profile and its
 * credential status, never stored, so a profile edit is reflected at once and nothing stale is approved.
 *
 * A scenario names identities by **role label**: the profile's identities each carry a free `role` label, and a
 * prerequisite is met when an identity with that role has the credential the operation needs. The labels the
 * generator uses are fixed and documented: `owner` and `other-user` (object-level authorization), `privileged` and
 * `restricted` (authorization), `any` (one identity with a valid or expired credential).
 */

export const ROLE_OWNER = "owner";
export const ROLE_OTHER_USER = "other-user";
export const ROLE_PRIVILEGED = "privileged";
export const ROLE_RESTRICTED = "restricted";
export const ROLE_ANY = "any";

/** The role labels offered when configuring an identity. Free text is also accepted. */
export const SUGGESTED_ROLES: readonly string[] = [ROLE_OWNER, ROLE_OTHER_USER, ROLE_PRIVILEGED, ROLE_RESTRICTED];

/** The reserved test-data parameter a profile uses to state a documented-elsewhere rate-limit threshold. */
export const RATE_LIMIT_THRESHOLD_PARAMETER = "rate-limit-threshold";

export function identityPrerequisite(role: string, scheme: string): Prerequisite {
  return {
    id: `identity:${role}:${scheme}`,
    kind: "identity",
    description:
      role === ROLE_ANY
        ? `One identity with a valid credential for the "${scheme}" scheme.`
        : `An identity with the role "${role}" and a valid credential for the "${scheme}" scheme.`,
  };
}

export function expiredCredentialPrerequisite(scheme: string): Prerequisite {
  return {
    id: `expired-credential:${scheme}`,
    kind: "expired-credential",
    description: `A known-expired credential for the "${scheme}" scheme, supplied by you. ApiPilot never makes one up.`,
  };
}

export function ownershipPrerequisite(operationKey: string, parameter: string, ownerRole: string): Prerequisite {
  return {
    id: `ownership:${operationKey}:${parameter}:${ownerRole}`,
    kind: "ownership",
    description: `The value of "${parameter}" for a resource owned by the identity with the role "${ownerRole}", as test data.`,
  };
}

export function thresholdPrerequisite(operationKey: string): Prerequisite {
  return {
    id: `threshold:${operationKey}`,
    kind: "threshold",
    description: `The number of requests the service allows per window for this operation, as test data named "${RATE_LIMIT_THRESHOLD_PARAMETER}". Without it the repetition count is only a minimum.`,
  };
}

/** What a profile can answer about credentials without ever revealing one. */
export interface PrerequisiteContext {
  readonly profile?: SecurityProfile;
  /** Whether a credential is set for an identity (by its profile name), scheme and kind. */
  readonly hasCredential: (identityName: string, scheme: string, kind: "active" | "expired") => boolean;
}

function identityWithRole(profile: SecurityProfile, role: string) {
  return profile.identities.filter((identity) => identity.role.toLowerCase() === role.toLowerCase());
}

/** Returns each prerequisite with its derived `state` and a `detail` saying exactly what is missing. */
export function evaluatePrerequisites(prerequisites: readonly Prerequisite[], context: PrerequisiteContext): Prerequisite[] {
  return prerequisites.map((prerequisite) => {
    const { state, detail } = judge(prerequisite, context);
    return { ...prerequisite, state, ...(detail ? { detail } : {}) };
  });
}

function judge(prerequisite: Prerequisite, context: PrerequisiteContext): { state: "met" | "missing" | "unsupported"; detail?: string } {
  const { profile } = context;
  if (prerequisite.id.startsWith("unsupported:")) {
    return { state: "unsupported", detail: prerequisite.description };
  }
  if (!profile) return { state: "missing", detail: "No profile is selected, so this cannot be checked." };

  const [kind, ...rest] = prerequisite.id.split(":") as [PrerequisiteKind, ...string[]];
  switch (kind) {
    case "identity": {
      const [role, scheme] = rest;
      const candidates = role === ROLE_ANY ? profile.identities : identityWithRole(profile, role);
      if (candidates.length === 0) return { state: "missing", detail: `The profile has no identity${role === ROLE_ANY ? "" : ` with the role "${role}"`}.` };
      const ready = candidates.some((identity) => identity.credentialSchemes.includes(scheme) && context.hasCredential(identity.name, scheme, "active"));
      return ready ? { state: "met" } : { state: "missing", detail: `No identity${role === ROLE_ANY ? "" : ` with the role "${role}"`} has a credential set for the "${scheme}" scheme.` };
    }
    case "expired-credential": {
      const [scheme] = rest;
      const ready = profile.identities.some(
        (identity) => (identity.expiredCredentialSchemes ?? []).includes(scheme) && context.hasCredential(identity.name, scheme, "expired"),
      );
      return ready ? { state: "met" } : { state: "missing", detail: `No identity has a known-expired credential set for the "${scheme}" scheme.` };
    }
    case "ownership": {
      // The operation key may itself contain colons, so the last two segments are the parameter and the owner role.
      const parts = rest.join(":").split(":");
      const ownerRole = parts.pop() as string;
      const parameter = parts.pop() as string;
      const operationKey = parts.join(":");
      const owners = identityWithRole(profile, ownerRole).map((identity) => identity.name);
      const hasData = profile.testData.some(
        (entry) => entry.parameter === parameter && owners.includes(entry.ownerIdentity) && (entry.operationKey === undefined || entry.operationKey === operationKey),
      );
      return hasData ? { state: "met" } : { state: "missing", detail: `The profile has no test data giving "${parameter}" for a resource owned by the "${ownerRole}" identity.` };
    }
    case "threshold": {
      const operationKey = rest.join(":");
      const configured = profile.testData.some(
        (entry) => entry.parameter === RATE_LIMIT_THRESHOLD_PARAMETER && (entry.operationKey === undefined || entry.operationKey === operationKey),
      );
      return configured ? { state: "met" } : { state: "missing", detail: `The profile has no "${RATE_LIMIT_THRESHOLD_PARAMETER}" test data for this operation.` };
    }
    default:
      return { state: "missing", detail: "This kind of prerequisite is not available yet." };
  }
}

/** Every prerequisite is met (an empty list is met). */
export function allMet(prerequisites: readonly Prerequisite[]): boolean {
  return prerequisites.every((prerequisite) => prerequisite.state === "met");
}
