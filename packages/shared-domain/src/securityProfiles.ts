import type { EnvironmentTier } from "./execution";
import type { AddressClass, CredentialStatus, SecurityProfile } from "./securityLab";

/**
 * Security Lab profile and target views (specs/057 contracts/security-lab-api.md "Profiles", data-model.md section 5).
 * The shapes the profile and environment routes return. None of them carries a credential value, a test data
 * value of a credential or a variable of the target environment: a credential is set through a write-only route and
 * only its `set` state is ever read back.
 */

export const PROFILE_VIOLATION_CODES = [
  "production_tier_refused",
  "base_url_blocked",
  "allowed_host_invalid",
  "address_ranges_local_only",
  "invalid_address_range",
  "relaxed_tls_local_only",
  "limit_above_ceiling",
  "limit_too_low",
  "unknown_category",
  "category_not_executable",
  "identity_name_duplicate",
  "identity_scheme_unknown",
  "test_data_identity_unknown",
  "test_data_operation_unknown",
  "test_data_credential_shaped",
  // Raised by the profile service rather than the pure rules: they need the store, the session or the network.
  "environment_not_found",
  "name_duplicate",
  "credential_identity_unknown",
  "credential_scheme_not_declared",
  "host_not_resolved",
  "destination_blocked",
] as const;
export type ProfileViolationCode = (typeof PROFILE_VIOLATION_CODES)[number];

export interface ProfileViolation {
  /** A path into the submitted profile, such as `identities[1].credentialSchemes[0]`. */
  field: string;
  code: ProfileViolationCode;
  message: string;
}

/** A target environment as the Security Lab routes expose it: name, tier and base URL only, never variables. */
export interface TargetEnvironment {
  id: string;
  name: string;
  tier: EnvironmentTier;
  baseUrl: string;
}

export interface TargetEnvironmentInput {
  name: string;
  tier: EnvironmentTier;
  baseUrl: string;
}

export interface ProfileView {
  profile: SecurityProfile;
  /** The target the profile points at, or undefined when that environment no longer exists. */
  environment?: { name: string; tier: string; baseUrl: string };
  credentialStatus: CredentialStatus[];
  valid: boolean;
  problems: ProfileViolation[];
}

/** `POST /profiles/:id/check`: the profile re-validated and its host resolved under the destination policy, with no request sent. */
export interface ProfileCheck {
  valid: boolean;
  problems: ProfileViolation[];
  destination?: {
    host: string;
    port: number;
    /** The class of the address a request would connect to, or of the first address when none is allowed. */
    resolvedClass?: AddressClass;
    addresses: Array<{ address: string; addressClass?: AddressClass; allowed: boolean; reason?: string; explanation?: string }>;
    /** The address a request would connect to, if any is allowed. */
    connectTo?: string;
    blockedReason?: string;
    explanation?: string;
  };
}
