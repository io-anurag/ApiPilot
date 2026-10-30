/**
 * The one-time terminal notice for a protected dev server (specs/060-per-device-dev-access FR-011).
 * Pure: the interface table is an argument so tests do not depend on the machine. It contains no
 * secret, but the caller still writes it to the terminal directly rather than through Vite's logger.
 */

import type { NetworkInterfaceInfo } from "node:os";

export type InterfaceTable = Record<string, readonly NetworkInterfaceInfo[] | undefined>;

const IPV6_LINK_LOCAL = /^fe[89ab]/i;

/**
 * The addresses to print a URL for. A specific listen address is printed as is; a wildcard lists
 * every non-internal IPv4 address and every non-link-local IPv6 address of the machine, since the
 * engineer must pick the one the other device can reach. Loopback is never listed.
 */
export function listNoticeAddresses(
  host: string,
  wildcard: boolean,
  interfaces: InterfaceTable,
): string[] {
  if (!wildcard) return [host];
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family === "IPv6" && IPV6_LINK_LOCAL.test(entry.address)) continue;
      addresses.push(entry.address);
    }
  }
  return addresses;
}

function authority(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

export interface NoticeInput {
  addresses: readonly string[];
  port: number;
}

/** The notice text. Contains no secret: every user obtains a token for their own device. */
export function buildNotice({ addresses, port }: NoticeInput): string {
  const lines = [
    "ApiPilot dev server is listening on a network address; each device needs its own access token.",
  ];
  if (addresses.length === 0) {
    lines.push(
      "No network address was found on this machine, so there is no address to open from another device.",
    );
  } else {
    lines.push(
      "Users just open one of these addresses; their browser is given its own token automatically:",
      "",
      ...addresses.map((address) => `  http://${authority(address, port)}/`),
      "",
      "Scripts and other non-browser clients request a token, then send it on every request in an X-ApiPilot-Token header:",
      `  curl -X POST -H "Accept: application/json" http://${authority(addresses[0], port)}/__apipilot/access`,
    );
  }
  lines.push(
    "",
    "A token works only from the network address it was issued to, and stops working when the server restarts.",
    "Only private-network addresses can request one. Anyone on that network can, so use a trusted network.",
    "The connection is plain HTTP: put TLS in front, or use an SSH or VPN tunnel, for anything less. See docs/configuration.md.",
    "",
  );
  return lines.join("\n");
}
