/**
 * In-memory registry of per-device access tokens (specs/060-per-device-dev-access FR-003, FR-006,
 * FR-008, FR-009). Only SHA-256 digests are kept, so the registry never holds a usable token, and a
 * lookup by digest does not take a time that depends on how many leading characters of a token match.
 */

import { createHash, randomBytes } from "node:crypto";

export const MAX_TOKENS_PER_ADDRESS = 10;
export const MAX_TOKENS_TOTAL = 1000;

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export function createAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AccessStore {
  /** digest -> the client address the token was issued to. A Map iterates in insertion order. */
  private readonly entries = new Map<string, string>();

  /**
   * Issues a token bound to `address`. At the per-address limit the oldest token of that address is
   * replaced; at the total limit nothing is issued and `undefined` is returned.
   */
  issue(address: string): string | undefined {
    const own = [...this.entries].filter(([, owner]) => owner === address);
    if (own.length >= MAX_TOKENS_PER_ADDRESS) this.entries.delete(own[0][0]);
    if (this.entries.size >= MAX_TOKENS_TOTAL) return undefined;
    const token = createAccessToken();
    this.entries.set(digest(token), address);
    return token;
  }

  /** True only when `token` was issued by this store to exactly `address`. */
  verify(token: string, address: string): boolean {
    return this.entries.get(digest(token)) === address;
  }
}
