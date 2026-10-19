import { describe, expect, it } from "vitest";
import type { AddressClass, EnvironmentTier } from "@apipilot/shared-domain";
import {
  BLOCK_REASONS,
  addressInRanges,
  classifyAddress,
  describeBlockReason,
  evaluateAddress,
  evaluateDestination,
  isAddressOrRange,
  isMetadataAddress,
  normalizeHost,
  selectAllowedAddress,
  type DestinationPolicy,
} from "../../../src/securityLab/execution/destinationPolicy";

function policy(overrides: Partial<DestinationPolicy> = {}): DestinationPolicy {
  return { tier: "staging", allowedHosts: ["api.example.test"], allowedPorts: [443], allowedAddressRanges: [], ...overrides };
}

const local = (ranges: string[] = ["127.0.0.1"], extra: Partial<DestinationPolicy> = {}) =>
  policy({ tier: "local", allowedHosts: ["localhost", "127.0.0.1"], allowedPorts: [3000], allowedAddressRanges: ranges, ...extra });

describe("address classes", () => {
  it.each<[string, AddressClass]>([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["::1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "cgnat"],
    ["100.127.255.254", "cgnat"],
    ["169.254.1.1", "link-local"],
    ["fe80::1", "link-local"],
    ["fe80::1%eth0", "link-local"],
    ["fc00::1", "unique-local"],
    ["fd12:3456::1", "unique-local"],
    ["224.0.0.1", "multicast"],
    ["ff02::1", "multicast"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["::", "unspecified"],
    ["8.8.8.8", "public"],
    ["93.184.216.34", "public"],
    ["2606:4700:4700::1111", "public"],
    // The boundaries of the private blocks are public.
    ["172.15.255.255", "public"],
    ["172.32.0.0", "public"],
    ["100.63.255.255", "public"],
    ["100.128.0.0", "public"],
  ])("classifies %s as %s", (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it.each([
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:192.168.0.1", "private"],
    ["::ffff:169.254.169.254", "link-local"],
    ["::ffff:0.0.0.0", "unspecified"],
    ["::ffff:8.8.8.8", "public"],
  ] as Array<[string, AddressClass]>)("judges the IPv4-mapped %s by the IPv4 address it embeds: %s", (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it("treats the NAT64 and 6to4 forms, which embed an IPv4 address, as non-public", () => {
    expect(classifyAddress("64:ff9b::7f00:1")).toBe("private");
    expect(classifyAddress("2002:7f00:1::")).toBe("private");
  });

  it("answers undefined for text that is not an address", () => {
    for (const text of ["example.com", "", "999.1.1.1", "1.2.3", "::gggg"]) expect(classifyAddress(text)).toBeUndefined();
  });

  it("recognises both metadata addresses, including mapped, and nothing else", () => {
    expect(isMetadataAddress("169.254.169.254")).toBe(true);
    expect(isMetadataAddress("fd00:ec2::254")).toBe(true);
    expect(isMetadataAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isMetadataAddress("169.254.169.253")).toBe(false);
    expect(isMetadataAddress("8.8.8.8")).toBe(false);
  });
});

describe("allowed address ranges", () => {
  it("matches a single address, a CIDR range and an IPv6 range", () => {
    expect(addressInRanges("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(addressInRanges("127.0.0.2", ["127.0.0.1"])).toBe(false);
    expect(addressInRanges("10.5.6.7", ["10.0.0.0/8"])).toBe(true);
    expect(addressInRanges("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(addressInRanges("fd00::5", ["fd00::/8"])).toBe(true);
    expect(addressInRanges("::1", ["::1"])).toBe(true);
  });

  it("does not let an IPv4 entry allow the IPv6 loopback, nor the reverse (a profile names the loopback it means)", () => {
    expect(addressInRanges("::1", ["127.0.0.1"])).toBe(false);
    expect(addressInRanges("127.0.0.1", ["::1"])).toBe(false);
  });

  it("matches an IPv4 range against the IPv4-mapped form of an address in it", () => {
    expect(addressInRanges("::ffff:10.1.1.1", ["10.0.0.0/8"])).toBe(true);
  });

  it("ignores malformed entries, which match nothing", () => {
    for (const entry of ["", "not-an-ip", "10.0.0.0/33", "10.0.0.0/abc", "10.0.0.0/", "::1/129"]) {
      expect(addressInRanges("10.0.0.1", [entry]), entry).toBe(false);
    }
  });

  it("validates a range for profile save", () => {
    for (const ok of ["127.0.0.1", "10.0.0.0/8", "::1", "fd00::/8", "192.168.0.0/16", "[::1]"]) expect(isAddressOrRange(ok), ok).toBe(true);
    for (const bad of ["", "localhost", "10.0.0.0/33", "10.0.0.0/", "/8", "1.2.3", "::1/129", "10.0.0.0/-1"]) expect(isAddressOrRange(bad), bad).toBe(false);
  });
});

describe("host normalisation", () => {
  it("lowercases, drops one trailing dot and brackets, and canonicalises IPv6 and IPv4 spellings", () => {
    expect(normalizeHost("API.Example.TEST.")).toBe("api.example.test");
    expect(normalizeHost("[::1]")).toBe("::1");
    expect(normalizeHost("[0:0:0:0:0:0:0:1]")).toBe("::1");
    expect(normalizeHost("0x7f.1")).toBe("127.0.0.1");
    expect(normalizeHost("2130706433")).toBe("127.0.0.1");
    expect(normalizeHost("  Host.TEST  ")).toBe("host.test");
  });

  it("leaves text that is more than a bare host as typed, so a port, path or userinfo can never make an entry match a real host", () => {
    for (const entry of ["api.example.test:443", "api.example.test:80", "api.example.test/path", "u@api.example.test", "api.example.test?x"]) {
      expect(normalizeHost(entry), entry).not.toBe("api.example.test");
      expect(evaluateDestination(policy({ allowedHosts: [entry] }), "https://api.example.test/").allowed, entry).toBe(false);
    }
  });

  it("converts an internationalised name to punycode so allowed hosts compare equal", () => {
    expect(normalizeHost("bücher.example")).toBe("xn--bcher-kva.example");
  });
});

describe("evaluateDestination: steps 1 to 3 (the URL itself)", () => {
  it("allows an exact host and port over https and over http on a listed port", () => {
    expect(evaluateDestination(policy(), "https://api.example.test/orders")).toMatchObject({ allowed: true, host: "api.example.test", port: 443 });
    expect(evaluateDestination(policy({ allowedPorts: [80] }), "http://api.example.test/")).toMatchObject({ allowed: true, port: 80 });
  });

  it.each(["ftp://api.example.test/", "file:///etc/passwd", "ws://api.example.test/", "gopher://api.example.test/", "javascript:alert(1)"])(
    "refuses the scheme of %s",
    (url) => {
      expect(evaluateDestination(policy(), url)).toMatchObject({ allowed: false, reason: "scheme_not_allowed" });
    },
  );

  it("refuses text that is not a URL, as a scheme problem", () => {
    expect(evaluateDestination(policy(), "not a url")).toMatchObject({ allowed: false, reason: "scheme_not_allowed" });
    expect(evaluateDestination(policy(), "/relative/path")).toMatchObject({ allowed: false, reason: "scheme_not_allowed" });
  });

  it.each(["https://user@api.example.test/", "https://user:secret@api.example.test/", "https://:secret@api.example.test/"])("refuses userinfo in %s", (url) => {
    expect(evaluateDestination(policy(), url)).toMatchObject({ allowed: false, reason: "userinfo_not_allowed" });
  });

  it("refuses a host that is not listed, including a suffix, a prefix and a lookalike", () => {
    for (const host of ["other.example.test", "example.test", "evil-api.example.test", "api.example.test.evil.test", "sub.api.example.test"]) {
      expect(evaluateDestination(policy(), `https://${host}/`), host).toMatchObject({ allowed: false, reason: "host_not_allowed" });
    }
  });

  it("compares hosts ignoring case, a trailing dot and the spelling of an IDN", () => {
    expect(evaluateDestination(policy(), "https://API.EXAMPLE.TEST/").allowed).toBe(true);
    expect(evaluateDestination(policy(), "https://api.example.test./").allowed).toBe(true);
    expect(evaluateDestination(policy({ allowedHosts: ["API.Example.Test."] }), "https://api.example.test/").allowed).toBe(true);
    expect(evaluateDestination(policy({ allowedHosts: ["bücher.example"] }), "https://xn--bcher-kva.example/").allowed).toBe(true);
  });

  it("refuses a port that is not listed, including a default port that is not listed", () => {
    expect(evaluateDestination(policy(), "https://api.example.test:8443/")).toMatchObject({ allowed: false, reason: "port_not_allowed", port: 8443 });
    expect(evaluateDestination(policy({ allowedPorts: [8443] }), "https://api.example.test/")).toMatchObject({ allowed: false, reason: "port_not_allowed", port: 443 });
    expect(evaluateDestination(policy({ allowedPorts: [443] }), "http://api.example.test/")).toMatchObject({ allowed: false, reason: "port_not_allowed", port: 80 });
    expect(evaluateDestination(policy({ allowedPorts: [] }), "https://api.example.test/").allowed).toBe(false);
  });

  it("checks the scheme, then userinfo, then host, then port, naming the first failure", () => {
    expect(evaluateDestination(policy(), "ftp://u@other.test:1/").allowed).toBe(false);
    expect((evaluateDestination(policy(), "ftp://u@other.test:1/") as { reason: string }).reason).toBe("scheme_not_allowed");
    expect((evaluateDestination(policy(), "https://u@other.test:1/") as { reason: string }).reason).toBe("userinfo_not_allowed");
    expect((evaluateDestination(policy(), "https://other.test:1/") as { reason: string }).reason).toBe("host_not_allowed");
    expect((evaluateDestination(policy(), "https://api.example.test:1/") as { reason: string }).reason).toBe("port_not_allowed");
  });

  it("does not look at the path, query or fragment", () => {
    expect(evaluateDestination(policy(), "https://api.example.test/a/b?x=https://evil.test#frag").allowed).toBe(true);
  });
});

describe("evaluateDestination: steps 4 to 6 (the connected address)", () => {
  it("allows a public address on every tier that may reach the host", () => {
    for (const tier of ["local", "dev", "qa", "staging"] as EnvironmentTier[]) {
      expect(evaluateDestination(policy({ tier }), "https://api.example.test/", "93.184.216.34")).toMatchObject({ allowed: true, addressClass: "public" });
    }
  });

  it.each(["127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "172.20.0.1", "100.64.0.9", "169.254.1.1", "fe80::1", "fd00::9", "224.0.0.9", "::ffff:10.0.0.5"])(
    "blocks %s as restricted for a staging-like tier, whatever ranges the profile names",
    (address) => {
      for (const tier of ["dev", "qa", "staging"] as EnvironmentTier[]) {
        const verdict = evaluateDestination(policy({ tier, allowedAddressRanges: ["0.0.0.0/0", "::/0", address] }), "https://api.example.test/", address);
        expect(verdict, `${tier} ${address}`).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
      }
    },
  );

  it("allows a restricted address on a local profile only when the profile names it", () => {
    const url = "http://localhost:3000/";
    expect(evaluateDestination(local(["127.0.0.1"]), url, "127.0.0.1")).toMatchObject({ allowed: true, addressClass: "loopback" });
    expect(evaluateDestination(local(["127.0.0.0/8"]), url, "127.9.9.9").allowed).toBe(true);
    expect(evaluateDestination(local([]), url, "127.0.0.1")).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
    expect(evaluateDestination(local(["10.0.0.0/8"]), url, "127.0.0.1")).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
  });

  it("lets a local profile that names only one loopback reach only that one (localhost resolving to ::1 and 127.0.0.1)", () => {
    const url = "http://localhost:3000/";
    expect(evaluateDestination(local(["127.0.0.1"]), url, "::1")).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
    expect(evaluateDestination(local(["::1"]), url, "127.0.0.1")).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
    const both = selectAllowedAddress(local(["127.0.0.1"]), url, ["::1", "127.0.0.1"]);
    expect(both).toMatchObject({ allowed: true, address: "127.0.0.1" });
    expect(selectAllowedAddress(local(["::1"]), url, ["::1", "127.0.0.1"])).toMatchObject({ allowed: true, address: "::1" });
  });

  it("blocks the metadata addresses on every tier, even when a local profile names them or the whole address space", () => {
    for (const address of ["169.254.169.254", "fd00:ec2::254", "::ffff:169.254.169.254"]) {
      for (const tier of ["local", "dev", "qa", "staging"] as EnvironmentTier[]) {
        const verdict = evaluateDestination(policy({ tier, allowedAddressRanges: [address, "169.254.0.0/16", "fd00::/8", "0.0.0.0/0", "::/0"] }), "https://api.example.test/", address);
        expect(verdict, `${tier} ${address}`).toMatchObject({ allowed: false, reason: "metadata_address_blocked" });
      }
    }
  });

  it("blocks the unspecified addresses on every tier, even when named", () => {
    for (const address of ["0.0.0.0", "0.1.2.3", "::", "::ffff:0.0.0.0"]) {
      for (const tier of ["local", "staging"] as EnvironmentTier[]) {
        const verdict = evaluateDestination(policy({ tier, allowedAddressRanges: ["0.0.0.0/0", "::/0", address] }), "https://api.example.test/", address);
        expect(verdict, `${tier} ${address}`).toMatchObject({ allowed: false, reason: "unspecified_address_blocked" });
      }
    }
  });

  it("blocks an address that is not an address at all", () => {
    expect(evaluateDestination(policy(), "https://api.example.test/", "not-an-address")).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
    expect(evaluateAddress(policy(), "")).toMatchObject({ allowed: false });
  });

  it("returns the address class on a block, so the evidence can record it", () => {
    expect(evaluateDestination(policy(), "https://api.example.test/", "10.0.0.5")).toMatchObject({ allowed: false, addressClass: "private" });
  });

  it("judges an IPv4-mapped IPv6 address by the IPv4 inside it, for the profile ranges too", () => {
    const url = "http://localhost:3000/";
    expect(evaluateDestination(local(["127.0.0.1"]), url, "::ffff:127.0.0.1")).toMatchObject({ allowed: true, addressClass: "loopback" });
    expect(evaluateDestination(local([]), url, "::ffff:127.0.0.1").allowed).toBe(false);
    expect(evaluateDestination(policy(), "https://api.example.test/", "::ffff:7f00:1").allowed).toBe(false);
  });
});

describe("evaluateDestination: literal IP hosts (step 7)", () => {
  it("refuses a literal IP that is not in allowed hosts, whatever its class", () => {
    expect(evaluateDestination(policy(), "https://93.184.216.34/")).toMatchObject({ allowed: false, reason: "literal_ip_not_allowed" });
    expect(evaluateDestination(local(["127.0.0.1"], { allowedHosts: ["localhost"] }), "http://127.0.0.1:3000/")).toMatchObject({ allowed: false, reason: "literal_ip_not_allowed" });
  });

  it("does not let an address range stand in for the host list", () => {
    const verdict = evaluateDestination(policy({ tier: "local", allowedHosts: ["localhost"], allowedPorts: [3000], allowedAddressRanges: ["127.0.0.0/8"] }), "http://127.0.0.1:3000/");
    expect(verdict).toMatchObject({ allowed: false, reason: "literal_ip_not_allowed" });
  });

  it("judges a listed literal IP by its own address, with no resolution", () => {
    expect(evaluateDestination(policy({ allowedHosts: ["93.184.216.34"] }), "https://93.184.216.34/")).toMatchObject({ allowed: true, addressClass: "public" });
    expect(evaluateDestination(local(["127.0.0.1"]), "http://127.0.0.1:3000/")).toMatchObject({ allowed: true, addressClass: "loopback" });
    expect(evaluateDestination(local([]), "http://127.0.0.1:3000/")).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
  });

  it("blocks a listed literal restricted IP on a staging-like tier even with ranges named", () => {
    const verdict = evaluateDestination(policy({ tier: "staging", allowedHosts: ["10.0.0.5"], allowedAddressRanges: ["10.0.0.0/8"] }), "https://10.0.0.5/");
    expect(verdict).toMatchObject({ allowed: false, reason: "restricted_address_blocked" });
  });

  it("blocks a literal metadata IP, in every spelling, even when it is listed", () => {
    for (const host of ["169.254.169.254", "[fd00:ec2::254]", "[::ffff:169.254.169.254]", "0xa9.0xfe.0xa9.0xfe", "2852039166"]) {
      const verdict = evaluateDestination(policy({ tier: "local", allowedHosts: [host, "169.254.169.254"], allowedAddressRanges: ["169.254.0.0/16"], allowedPorts: [80] }), `http://${host}/`);
      expect(verdict.allowed, host).toBe(false);
      expect((verdict as { reason: string }).reason, host).toMatch(/metadata_address_blocked|literal_ip_not_allowed/);
    }
    const listed = evaluateDestination(policy({ tier: "local", allowedHosts: ["169.254.169.254"], allowedAddressRanges: ["169.254.0.0/16"], allowedPorts: [80] }), "http://2852039166/");
    expect(listed).toMatchObject({ allowed: false, reason: "metadata_address_blocked" });
  });

  it("sees through alternative spellings of a loopback address to the same decision", () => {
    for (const host of ["0x7f.1", "2130706433", "0177.0.0.1", "[::ffff:127.0.0.1]", "[0:0:0:0:0:0:0:1]"]) {
      // The host list names the canonical loopback, so the spelling reaches the address check and is refused there.
      const verdict = evaluateDestination(policy({ allowedHosts: ["127.0.0.1", "::1", "::ffff:7f00:1"], allowedPorts: [80] }), `http://${host}/`);
      expect(verdict, host).toMatchObject({ allowed: false, reason: "restricted_address_blocked", addressClass: "loopback" });
    }
  });

  it("evaluates an IPv6 literal with a port", () => {
    expect(evaluateDestination(local(["::1"], { allowedHosts: ["::1"] }), "http://[::1]:3000/")).toMatchObject({ allowed: true, host: "::1", port: 3000 });
  });
});

describe("a resolved name is judged at connect time", () => {
  const url = "https://api.example.test/";

  it("connects only to the allowed address when a name resolves to an allowed and a restricted one", () => {
    const chosen = selectAllowedAddress(policy(), url, ["10.0.0.5", "93.184.216.34", "169.254.169.254"]);
    expect(chosen).toMatchObject({ allowed: true, address: "93.184.216.34" });
  });

  it("fails with the first candidate's reason when none is allowed", () => {
    const chosen = selectAllowedAddress(policy(), url, ["169.254.169.254", "10.0.0.5"]);
    expect(chosen).toMatchObject({ allowed: false, verdict: { allowed: false, reason: "metadata_address_blocked" } });
    const other = selectAllowedAddress(policy(), url, ["10.0.0.5", "169.254.169.254"]);
    expect(other).toMatchObject({ allowed: false, verdict: { allowed: false, reason: "restricted_address_blocked" } });
  });

  it("returns the URL-level reason when the name itself is not allowed, before looking at addresses", () => {
    expect(selectAllowedAddress(policy(), "https://other.test/", ["93.184.216.34"])).toMatchObject({ allowed: false, verdict: { reason: "host_not_allowed" } });
  });

  it("blocks when the resolver returned nothing", () => {
    const chosen = selectAllowedAddress(policy(), url, []);
    expect(chosen.allowed).toBe(false);
  });

  it("re-checks a later, different answer: the same name is allowed once and blocked once (rebinding)", () => {
    const first = selectAllowedAddress(policy(), url, ["93.184.216.34"]);
    const rebound = selectAllowedAddress(policy(), url, ["127.0.0.1"]);
    expect(first.allowed).toBe(true);
    expect(rebound).toMatchObject({ allowed: false, verdict: { reason: "restricted_address_blocked" } });
  });
});

describe("tiers", () => {
  it("does not honour address ranges outside the local tier", () => {
    for (const tier of ["dev", "qa", "staging", "production"] as EnvironmentTier[]) {
      expect(evaluateAddress({ ...policy({ tier }), allowedAddressRanges: ["10.0.0.0/8"] }, "10.0.0.1").allowed, tier).toBe(false);
    }
    expect(evaluateAddress({ ...policy({ tier: "local" }), allowedAddressRanges: ["10.0.0.0/8"] }, "10.0.0.1").allowed).toBe(true);
  });
});

describe("block reasons", () => {
  it("has a sentence for every reason, none of which carries a host, address or secret", () => {
    for (const reason of BLOCK_REASONS) {
      const text = describeBlockReason(reason);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
    expect(new Set(BLOCK_REASONS).size).toBe(BLOCK_REASONS.length);
  });

  it("covers every reason in contracts/execution-safety-rules.md section 2", () => {
    expect([...BLOCK_REASONS].sort()).toEqual(
      ["host_not_allowed", "literal_ip_not_allowed", "metadata_address_blocked", "port_not_allowed", "restricted_address_blocked", "scheme_not_allowed", "unspecified_address_blocked", "userinfo_not_allowed"].sort(),
    );
  });
});
