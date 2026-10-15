// @vitest-environment node
import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { buildNotice, listNoticeAddresses, type InterfaceTable } from "../../devAccess/notice";

const entry = (
  address: string,
  family: "IPv4" | "IPv6",
  internal = false,
): NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as NetworkInterfaceInfo;

const interfaces: InterfaceTable = {
  Loopback: [entry("127.0.0.1", "IPv4", true), entry("::1", "IPv6", true)],
  Ethernet: [entry("192.168.1.20", "IPv4"), entry("fe80::1234", "IPv6"), entry("2001:db8::20", "IPv6")],
  Wifi: [entry("10.0.0.7", "IPv4")],
  Down: undefined,
};

const TOKEN = "T".repeat(43);

describe("listNoticeAddresses (specs/049 FR-004)", () => {
  it("prints a specific address as is", () => {
    expect(listNoticeAddresses("192.168.1.20", false, interfaces)).toEqual(["192.168.1.20"]);
  });

  it("lists every non-internal IPv4 and non-link-local IPv6 address for a wildcard", () => {
    expect(listNoticeAddresses("0.0.0.0", true, interfaces)).toEqual([
      "192.168.1.20",
      "2001:db8::20",
      "10.0.0.7",
    ]);
  });

  it("finds nothing when the machine has only loopback addresses", () => {
    expect(listNoticeAddresses("::", true, { Loopback: interfaces.Loopback })).toEqual([]);
  });
});

describe("buildNotice (specs/049 FR-004, FR-014)", () => {
  it("prints one URL per address, brackets IPv6, and uses the bound port", () => {
    const text = buildNotice({ addresses: ["192.168.1.20", "2001:db8::20"], port: 5174, token: TOKEN });
    expect(text).toContain(`http://192.168.1.20:5174/?token=${TOKEN}`);
    expect(text).toContain(`http://[2001:db8::20]:5174/?token=${TOKEN}`);
  });

  it("shows scripts how to present the token in a header", () => {
    const text = buildNotice({ addresses: ["192.168.1.20"], port: 5173, token: TOKEN });
    expect(text).toContain(`curl -H "X-ApiPilot-Token: ${TOKEN}" http://192.168.1.20:5173/api/health`);
    expect(text).toMatch(/non-browser clients/);
  });

  it("says the connection is unencrypted, the address is a secret that stops on restart, and where to read more", () => {
    const text = buildNotice({ addresses: ["192.168.1.20"], port: 5173, token: TOKEN });
    expect(text).toMatch(/plain HTTP/);
    expect(text).toMatch(/read the token/);
    expect(text).toMatch(/Keep them secret/);
    expect(text).toMatch(/stop working when the server restarts/);
    expect(text).toMatch(/trusted network.*TLS.*SSH or VPN tunnel/);
    expect(text).toContain("docs/configuration.md");
  });

  it("says so, and prints no URL or loopback address, when there is no network address", () => {
    const text = buildNotice({ addresses: [], port: 5173, token: TOKEN });
    expect(text).toMatch(/No network address was found/);
    expect(text).not.toContain("?token=");
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain(TOKEN);
  });
});
