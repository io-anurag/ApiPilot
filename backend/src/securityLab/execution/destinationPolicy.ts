import { BlockList, isIP } from "node:net";
import type { AddressClass, EnvironmentTier } from "@apipilot/shared-domain";

/**
 * The destination policy (specs/057 contracts/execution-safety-rules.md section 2, FR-036 to FR-040).
 *
 * One pure function decides whether a request may be sent to a destination. It is called when a profile is
 * saved, when a run is previewed, at the connect step of **every** request and for **every** redirect hop, so
 * the rules hold whatever route, scenario or model output asked for the request. Nothing here performs I/O:
 * name resolution belongs to the sender, which passes each candidate address in. The order of the checks is the
 * contract's, and the first failing check names the reason.
 */

export const BLOCK_REASONS = [
  "scheme_not_allowed",
  "userinfo_not_allowed",
  "host_not_allowed",
  "port_not_allowed",
  "metadata_address_blocked",
  "unspecified_address_blocked",
  "restricted_address_blocked",
  "literal_ip_not_allowed",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

/** The parts of a profile and its environment that the policy reads. */
export interface DestinationPolicy {
  readonly tier: EnvironmentTier;
  readonly allowedHosts: readonly string[];
  readonly allowedPorts: readonly number[];
  /** Addresses or CIDR ranges. Honoured only for the `local` tier. */
  readonly allowedAddressRanges: readonly string[];
}

export type DestinationVerdict =
  | { readonly allowed: true; readonly host: string; readonly port: number; readonly addressClass?: AddressClass }
  | { readonly allowed: false; readonly reason: BlockReason; readonly host?: string; readonly port?: number; readonly addressClass?: AddressClass };

// ---------------------------------------------------------------------------------------------
// Address classes
// ---------------------------------------------------------------------------------------------

function listOf(entries: ReadonlyArray<readonly [string, number, "ipv4" | "ipv6"]>): BlockList {
  const list = new BlockList();
  for (const [network, prefix, family] of entries) list.addSubnet(network, prefix, family);
  return list;
}

const LOOPBACK = listOf([["127.0.0.0", 8, "ipv4"], ["::1", 128, "ipv6"]]);
/** `0.0.0.0/8` and the IPv6 unspecified address, plus the deprecated IPv4-compatible block `::/96` (never routed). */
const UNSPECIFIED = listOf([["0.0.0.0", 8, "ipv4"], ["::", 96, "ipv6"]]);
const LINK_LOCAL = listOf([["169.254.0.0", 16, "ipv4"], ["fe80::", 10, "ipv6"]]);
const PRIVATE = listOf([
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  // Forms that embed an IPv4 address without being IPv4-mapped. Their embedded address is not unwrapped, so they are
  // treated as non-public: reaching one needs the same explicit local allowance as a private address.
  ["64:ff9b::", 96, "ipv6"],
  ["2002::", 16, "ipv6"],
]);
const CGNAT = listOf([["100.64.0.0", 10, "ipv4"]]);
const UNIQUE_LOCAL = listOf([["fc00::", 7, "ipv6"]]);
const MULTICAST = listOf([["224.0.0.0", 4, "ipv4"], ["ff00::", 8, "ipv6"]]);

/** Order matters only where ranges overlap: `::1` is loopback although it lies inside `::/96`. */
const CLASS_ORDER: ReadonlyArray<readonly [AddressClass, BlockList]> = [
  ["loopback", LOOPBACK],
  ["unspecified", UNSPECIFIED],
  ["link-local", LINK_LOCAL],
  ["private", PRIVATE],
  ["cgnat", CGNAT],
  ["unique-local", UNIQUE_LOCAL],
  ["multicast", MULTICAST],
];

const METADATA = (() => {
  const list = new BlockList();
  list.addAddress("169.254.169.254", "ipv4");
  list.addAddress("fd00:ec2::254", "ipv6");
  return list;
})();

/** Removes an IPv6 zone identifier (`fe80::1%eth0`) and brackets. */
function bareAddress(address: string): string {
  const withoutBrackets = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const zone = withoutBrackets.indexOf("%");
  return zone === -1 ? withoutBrackets : withoutBrackets.slice(0, zone);
}

/**
 * The class of an address, or `undefined` when the text is not an IP address. An IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1`, or the equivalent hex form) is judged by the IPv4 address it embeds, because that is where
 * the connection goes.
 */
export function classifyAddress(address: string): AddressClass | undefined {
  const bare = bareAddress(address);
  const version = isIP(bare);
  if (version === 0) return undefined;
  const family = version === 4 ? "ipv4" : "ipv6";
  for (const [addressClass, list] of CLASS_ORDER) {
    if (list.check(bare, family)) return addressClass;
  }
  return "public";
}

/** True for the addresses no profile may ever reach: the cloud metadata addresses. */
export function isMetadataAddress(address: string): boolean {
  const bare = bareAddress(address);
  const version = isIP(bare);
  return version !== 0 && METADATA.check(bare, version === 4 ? "ipv4" : "ipv6");
}

/** Whether `address` is named by, or inside, one of the allowed addresses or CIDR ranges. Unparseable entries match nothing. */
export function addressInRanges(address: string, ranges: readonly string[]): boolean {
  const bare = bareAddress(address);
  const version = isIP(bare);
  if (version === 0) return false;
  const list = new BlockList();
  for (const raw of ranges) {
    const entry = raw.trim();
    const slash = entry.indexOf("/");
    const network = bareAddress(slash === -1 ? entry : entry.slice(0, slash));
    const entryVersion = isIP(network);
    if (entryVersion === 0) continue;
    const family = entryVersion === 4 ? "ipv4" : "ipv6";
    if (slash === -1) {
      list.addAddress(network, family);
      continue;
    }
    const prefixText = entry.slice(slash + 1);
    const prefix = Number(prefixText);
    const maximum = entryVersion === 4 ? 32 : 128;
    if (!/^\d{1,3}$/.test(prefixText) || prefix > maximum) continue;
    list.addSubnet(network, prefix, family);
  }
  return list.check(bare, version === 4 ? "ipv4" : "ipv6");
}

/** True when `text` is a well-formed address or CIDR range, for profile validation. */
export function isAddressOrRange(text: string): boolean {
  const entry = text.trim();
  const slash = entry.indexOf("/");
  const network = bareAddress(slash === -1 ? entry : entry.slice(0, slash));
  const version = isIP(network);
  if (version === 0) return false;
  if (slash === -1) return true;
  const prefixText = entry.slice(slash + 1);
  return /^\d{1,3}$/.test(prefixText) && Number(prefixText) <= (version === 4 ? 32 : 128);
}

// ---------------------------------------------------------------------------------------------
// Host and URL normalisation
// ---------------------------------------------------------------------------------------------

/**
 * A host as the policy compares it: lowercase, no brackets, no trailing dot. A host that parses as a URL host is
 * canonicalised the way URL parsing does (IDNA to punycode, IPv6 compressed, IPv4 written in the dotted form), so
 * `Example.COM.`, `EXAMPLE.com` and `example.com` are one host and `0x7f.1` is `127.0.0.1`.
 */
export function normalizeHost(host: string): string {
  let text = host.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  if (text.endsWith(".")) text = text.slice(0, -1);
  if (text === "") return text;
  // Anything that is not a bare host (a port, path, query, userinfo or backslash) is left as typed, so it can never equal a real
  // request host. URL parsing would silently drop a default port or a path, and `a.test:443` must not match `a.test`.
  if (NOT_A_BARE_HOST.test(text) || (text.includes(":") && isIP(text) !== 6)) return text;
  try {
    const parsed = new URL(isIP(text) === 6 ? `http://[${text}]/` : `http://${text}/`).hostname;
    text = parsed.startsWith("[") && parsed.endsWith("]") ? parsed.slice(1, -1) : parsed;
    if (text.endsWith(".")) text = text.slice(0, -1);
  } catch {
    // Not a valid URL host: compare the cleaned text. It will not match any real request host.
  }
  return text;
}

/** A path, query, fragment, userinfo or backslash marker: the text is more than a host. */
const NOT_A_BARE_HOST = /[/?#@\\]/;

function defaultPort(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/** Steps 4 to 6 for one concrete address. */
export function evaluateAddress(policy: DestinationPolicy, address: string): { allowed: true; addressClass: AddressClass } | { allowed: false; reason: BlockReason; addressClass?: AddressClass } {
  const addressClass = classifyAddress(address);
  if (addressClass === undefined) return { allowed: false, reason: "restricted_address_blocked" };
  if (isMetadataAddress(address)) return { allowed: false, reason: "metadata_address_blocked", addressClass };
  if (addressClass === "unspecified") return { allowed: false, reason: "unspecified_address_blocked", addressClass };
  if (addressClass === "public") return { allowed: true, addressClass };
  if (policy.tier === "local" && addressInRanges(address, policy.allowedAddressRanges)) return { allowed: true, addressClass };
  return { allowed: false, reason: "restricted_address_blocked", addressClass };
}

/**
 * Whether a request to `url` may be sent. Steps 1 to 3 judge the URL itself. When `address` is given (the address
 * about to be connected to) steps 4 to 6 judge it too. A literal IP host is its own address and is always judged
 * by steps 4 to 6, and it must be named in `allowedHosts` (step 7), which is reported as `literal_ip_not_allowed`.
 */
export function evaluateDestination(policy: DestinationPolicy, url: string | URL, address?: string): DestinationVerdict {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    return { allowed: false, reason: "scheme_not_allowed" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { allowed: false, reason: "scheme_not_allowed" };
  if (parsed.username !== "" || parsed.password !== "") return { allowed: false, reason: "userinfo_not_allowed" };

  const host = normalizeHost(parsed.hostname);
  const port = parsed.port === "" ? defaultPort(parsed.protocol) : Number(parsed.port);
  const literal = isIP(host) !== 0;
  const allowedHosts = new Set(policy.allowedHosts.map(normalizeHost));

  if (!allowedHosts.has(host)) return { allowed: false, reason: literal ? "literal_ip_not_allowed" : "host_not_allowed", host, port };
  if (!policy.allowedPorts.includes(port)) return { allowed: false, reason: "port_not_allowed", host, port };

  const connected = literal ? host : address;
  if (connected === undefined) return { allowed: true, host, port };
  const verdict = evaluateAddress(policy, connected);
  if (!verdict.allowed) return { allowed: false, reason: verdict.reason, host, port, ...(verdict.addressClass ? { addressClass: verdict.addressClass } : {}) };
  return { allowed: true, host, port, addressClass: verdict.addressClass };
}

/**
 * Chooses the address to connect to from every address a name resolved to: the first allowed candidate, in the
 * resolver's order. When none is allowed, the first candidate's reason is returned. A name that resolves to both an
 * allowed and a restricted address therefore connects only to the allowed one.
 */
export function selectAllowedAddress(
  policy: DestinationPolicy,
  url: string | URL,
  candidates: readonly string[],
): { allowed: true; address: string; verdict: DestinationVerdict } | { allowed: false; verdict: DestinationVerdict } {
  let first: DestinationVerdict | undefined;
  for (const candidate of candidates) {
    const verdict = evaluateDestination(policy, url, candidate);
    if (verdict.allowed) return { allowed: true, address: candidate, verdict };
    first ??= verdict;
  }
  return { allowed: false, verdict: first ?? evaluateDestination(policy, url) };
}

/** The reader-facing sentence for a block reason, used in run results and profile checks. */
export function describeBlockReason(reason: BlockReason): string {
  switch (reason) {
    case "scheme_not_allowed":
      return "Only http and https destinations are allowed.";
    case "userinfo_not_allowed":
      return "A destination may not carry a user name or password in its address.";
    case "host_not_allowed":
      return "The host is not in the profile's allowed hosts.";
    case "port_not_allowed":
      return "The port is not in the profile's allowed ports.";
    case "metadata_address_blocked":
      return "Cloud metadata addresses are always blocked.";
    case "unspecified_address_blocked":
      return "The unspecified address is always blocked.";
    case "restricted_address_blocked":
      return "The address is loopback, private, link-local or otherwise non-public, and the profile does not allow it. Only a local profile can name such addresses.";
    case "literal_ip_not_allowed":
      return "A literal IP address must be listed in the profile's allowed hosts.";
  }
}
