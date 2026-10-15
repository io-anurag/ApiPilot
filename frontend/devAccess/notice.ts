/**
 * The one-time terminal notice for a protected dev server (specs/049-lan-dev-access-token FR-004,
 * FR-014; contracts/dev-server-access.md section 3). Pure: the interface table is an argument so
 * tests do not depend on the machine. The caller writes the result to the terminal directly, never
 * through Vite's logger, which also feeds `logs/frontend.log`.
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
  token: string;
}

/** The notice text. Contains the token, so it must go to the terminal and nowhere else. */
export function buildNotice({ addresses, port, token }: NoticeInput): string {
  const lines = [
    "ApiPilot dev server is listening on a network address and is protected by an access token.",
  ];
  if (addresses.length === 0) {
    lines.push("No network address was found on this machine, so there is no address to open from another device.");
  } else {
    lines.push(
      "Open one of these addresses on the device you want to use. Keep them secret; they stop working when the server restarts:",
      "",
      ...addresses.map((address) => `  http://${authority(address, port)}/?token=${token}`),
      "",
      "Scripts and other non-browser clients: send the token on every request in an X-ApiPilot-Token header, for example:",
      `  curl -H "X-ApiPilot-Token: ${token}" http://${authority(addresses[0], port)}/api/health`,
    );
  }
  lines.push(
    "",
    "The connection is plain HTTP: anyone who can read traffic on this network can read the token.",
    "Use a trusted network, put TLS in front, or use an SSH or VPN tunnel. See docs/configuration.md.",
    "",
  );
  return lines.join("\n");
}
