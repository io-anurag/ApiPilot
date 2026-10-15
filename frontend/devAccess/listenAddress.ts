/**
 * Resolves `FRONTEND_DEV_HOST`, the address the Vite dev server listens on, and decides from it
 * whether access-token protection is mandatory (specs/049-lan-dev-access-token FR-001, FR-002,
 * FR-011). Protection is derived from the address, never from a separate switch, so the unsafe
 * combination (a network address with no protection) cannot be configured.
 */

import net from "node:net";

export interface ListenAddress {
  /** The value to give Vite's `server.host`. */
  host: string;
  /** True only for the three loopback names; everything else, including `127.0.0.2`, is not. */
  loopback: boolean;
  /** True for the "all interfaces" addresses, `0.0.0.0` and `::`. */
  wildcard: boolean;
  /** Always `!loopback`. When in doubt about an address, it is protected. */
  protected: boolean;
}

export const DEFAULT_DEV_HOST = "127.0.0.1";

// Duplicates `LOOPBACK_HOSTNAMES` in backend/src/security/localHostGuard.ts: Vite loads its config
// before any workspace is built, so the frontend cannot import backend source. A unit test pins the
// two lists together.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(["0.0.0.0", "::"]);
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

function isValidHostName(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  const labels = value.split(".");
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  // An all-numeric last label is never a host name: such a value is a malformed IP address
  // (for example 999.999.999.999) and must not be accepted as one.
  return !/^\d+$/.test(labels.at(-1) ?? "");
}

/**
 * Resolves the raw setting. Unset or empty means loopback. An invalid value throws, naming the
 * setting, so the dev server refuses to start instead of binding somewhere unintended.
 */
export function resolveListenAddress(raw: string | undefined): ListenAddress {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return describe(DEFAULT_DEV_HOST);

  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (net.isIP(unbracketed) === 0 && !isValidHostName(unbracketed)) {
    throw new Error(
      `FRONTEND_DEV_HOST must be an IP address or a host name, but was "${trimmed}". ` +
        "Unset it to listen on loopback only.",
    );
  }
  return describe(unbracketed);
}

function describe(host: string): ListenAddress {
  const loopback = LOOPBACK_HOSTS.has(host.toLowerCase());
  return {
    host,
    loopback,
    wildcard: WILDCARD_HOSTS.has(host),
    protected: !loopback,
  };
}
