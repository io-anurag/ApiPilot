// @vitest-environment node
import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildNotice,
  listNoticeAddresses,
  type InterfaceTable,
} from "../../devAccess/notice";

const entry = (
  address: string,
  family: "IPv4" | "IPv6",
  internal = false,
): NetworkInterfaceInfo =>
  ({
    address,
    family,
    internal,
    netmask: "",
    mac: "",
    cidr: null,
  }) as NetworkInterfaceInfo;

const interfaces: InterfaceTable = {
  Loopback: [entry("127.0.0.1", "IPv4", true), entry("::1", "IPv6", true)],
  Ethernet: [
    entry("192.168.1.20", "IPv4"),
    entry("fe80::1234", "IPv6"),
    entry("2001:db8::20", "IPv6"),
  ],
  Wifi: [entry("10.0.0.7", "IPv4")],
  Down: undefined,
};

describe("listNoticeAddresses", () => {
  it("prints a specific address as is", () => {
    expect(listNoticeAddresses("192.168.1.20", false, interfaces)).toEqual([
      "192.168.1.20",
    ]);
  });

  it("lists every non-internal IPv4 and non-link-local IPv6 address for a wildcard", () => {
    expect(listNoticeAddresses("0.0.0.0", true, interfaces)).toEqual([
      "192.168.1.20",
      "2001:db8::20",
      "10.0.0.7",
    ]);
  });

  it("finds nothing when the machine has only loopback addresses", () => {
    expect(listNoticeAddresses("::", true, { Loopback: interfaces.Loopback })).toEqual(
      [],
    );
  });
});

describe("buildNotice (specs/060 FR-011)", () => {
  it("prints one plain URL per address, brackets IPv6, and uses the bound port", () => {
    const text = buildNotice({ addresses: ["192.168.1.20", "2001:db8::20"], port: 5174 });
    expect(text).toContain("http://192.168.1.20:5174/\n");
    expect(text).toContain("http://[2001:db8::20]:5174/\n");
    expect(text).not.toContain("token=");
  });

  it("tells users to just open the address and shows scripts how to get a token", () => {
    const text = buildNotice({ addresses: ["192.168.1.20"], port: 5173 });
    expect(text).toContain("given its own token automatically");
    expect(text).toContain(
      'curl -X POST -H "Accept: application/json" http://192.168.1.20:5173/__apipilot/access',
    );
    expect(text).toContain("X-ApiPilot-Token");
  });

  it("states the binding, the restart, the private-network limit and the plain-HTTP caveat", () => {
    const text = buildNotice({ addresses: ["192.168.1.20"], port: 5173 });
    expect(text).toMatch(/only from the network address it was issued to/);
    expect(text).toMatch(/stops working when the server restarts/);
    expect(text).toMatch(/Only private-network addresses/);
    expect(text).toMatch(/plain HTTP/);
    expect(text).toMatch(/TLS.*SSH or VPN tunnel/);
    expect(text).toContain("docs/configuration.md");
  });

  it("says so, and prints no URL or loopback address, when there is no network address", () => {
    const text = buildNotice({ addresses: [], port: 5173 });
    expect(text).toMatch(/No network address was found/);
    expect(text).not.toContain("http://");
    expect(text).not.toContain("127.0.0.1");
  });
});
