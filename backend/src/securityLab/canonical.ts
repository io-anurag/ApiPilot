import { fragmentHash, sha256, stableStringify } from "../apiCoverage/specRevision";

/**
 * Canonical JSON and hashes for Security Lab identity (specs/057 contracts/security-scenario-contract.md
 * "Stable identifiers and hashes"). Keys are sorted and `undefined` members are dropped, so the same
 * content always serializes, and hashes, identically. Reuses the coverage module's helpers on purpose:
 * one canonical form across the product.
 */

/** JSON with keys sorted and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  return stableStringify(value);
}

/** Short stable fingerprint (16 hex characters) of any JSON-like fragment. */
export function hash16(value: unknown): string {
  return fragmentHash(value);
}

/** Full SHA-256 (64 hex characters) of the canonical form, for a version's `contentHash` and run plan digests. */
export function hash64(value: unknown): string {
  return sha256(stableStringify(value));
}
