/**
 * Client-address handling for per-device access (specs/060-per-device-dev-access FR-003, FR-004).
 * The address always comes from the socket: a forwarding header is client-controlled and is never
 * consulted.
 */

import { BlockList, isIP } from "node:net";

const INTRANET = new BlockList();
INTRANET.addSubnet("127.0.0.0", 8, "ipv4");
INTRANET.addSubnet("10.0.0.0", 8, "ipv4");
INTRANET.addSubnet("172.16.0.0", 12, "ipv4");
INTRANET.addSubnet("192.168.0.0", 16, "ipv4");
INTRANET.addSubnet("169.254.0.0", 16, "ipv4");
// Shared address space (RFC 6598), used by carrier NAT and several VPN products.
INTRANET.addSubnet("100.64.0.0", 10, "ipv4");
INTRANET.addAddress("::1", "ipv6");
INTRANET.addSubnet("fc00::", 7, "ipv6");
INTRANET.addSubnet("fe80::", 10, "ipv6");

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

/** The canonical form used as a binding key, or undefined when the value is not an IP address. */
export function normalizeClientAddress(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let address = raw.split("%")[0].toLowerCase();
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped) address = mapped[1];
  return isIP(address) === 0 ? undefined : address;
}

/** True for loopback, private, link-local, shared-address-space and IPv6 unique-local addresses. */
export function isIntranetAddress(address: string): boolean {
  const family = isIP(address);
  return family === 0 ? false : INTRANET.check(address, family === 4 ? "ipv4" : "ipv6");
}
