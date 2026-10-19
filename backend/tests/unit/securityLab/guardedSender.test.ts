import { afterEach, describe, expect, it } from "vitest";
import { RESPONSE_READ_CAP_BYTES } from "../../../src/securityLab/config";
import type { DestinationPolicy } from "../../../src/securityLab/execution/destinationPolicy";
import { createGuardedSender } from "../../../src/securityLab/execution/guardedSender";
import type { AddressResolver, SendOptions } from "../../../src/securityLab/execution/types";
import { RawTarget, makeSelfSignedCertificate, opensslAvailable, type RawHandler } from "../../fixtures/securityLab/rawTarget";

const targets: RawTarget[] = [];
afterEach(async () => {
  await Promise.all(targets.splice(0).map((target) => target.stop()));
});

async function target(handler: RawHandler = (_request, response) => response.writeHead(200, { "content-type": "text/plain" }).end("ok")) {
  const raw = new RawTarget(handler);
  await raw.start();
  targets.push(raw);
  return raw;
}

/** A local policy that allows 127.0.0.1 and the named hosts on the given ports. */
function localPolicy(ports: number[], hosts: string[] = ["127.0.0.1"], ranges: string[] = ["127.0.0.1"]): DestinationPolicy {
  return { tier: "local", allowedHosts: hosts, allowedPorts: ports, allowedAddressRanges: ranges };
}

function options(policy: DestinationPolicy, overrides: Partial<SendOptions> = {}): SendOptions {
  return { policy, tlsPolicy: "verify", timeoutMs: 5_000, reserveHop: () => true, ...overrides };
}

const never: AddressResolver = async () => {
  throw new Error("the resolver must not be called for a literal IP");
};

describe("a plain request to an allowed loopback target", () => {
  it("returns the status, lowercase headers and body, and records the destination", async () => {
    const raw = await target((_request, response) => response.writeHead(201, { "Content-Type": "application/json", "X-Custom": "a" }).end('{"id":7}'));
    const sender = createGuardedSender(never);
    const outcome = await sender.send({ method: "GET", url: `${raw.origin}/things?x=1`, headers: { "x-trace": "t1" } }, options(localPolicy([raw.portNumber])));
    expect(outcome).toMatchObject({ status: 201, bodyText: '{"id":7}', truncated: false, requestsSent: 1, redirects: [] });
    expect(outcome.headers["content-type"]).toBe("application/json");
    expect(outcome.headers["x-custom"]).toBe("a");
    expect(outcome.destination).toMatchObject({ host: "127.0.0.1", port: raw.portNumber, addressClass: "loopback", verdict: "allowed" });
    expect(outcome.error).toBeUndefined();
    expect(raw.requests).toHaveLength(1);
    expect(raw.requests[0]).toMatchObject({ method: "GET", url: "/things?x=1" });
    expect(raw.requests[0].headers["x-trace"]).toBe("t1");
  });

  it("sends a body with its length and returns what the server echoes", async () => {
    const raw = await target((request, response) => response.writeHead(200).end(request.body));
    const outcome = await createGuardedSender(never).send(
      { method: "POST", url: `${raw.origin}/echo`, headers: { "content-type": "application/json" }, body: '{"a":"é"}' },
      options(localPolicy([raw.portNumber])),
    );
    expect(outcome.bodyText).toBe('{"a":"é"}');
    expect(raw.requests[0].headers["content-length"]).toBe(String(Buffer.byteLength('{"a":"é"}')));
  });

  it("joins a repeated response header and reports a failed connection as a connect error", async () => {
    const raw = await target((_request, response) => response.writeHead(200, { "set-cookie": ["a=1", "b=2"] }).end());
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.headers["set-cookie"]).toBe("a=1, b=2");
    const port = raw.portNumber;
    await raw.stop();
    const refused = await createGuardedSender(never).send({ method: "GET", url: `http://127.0.0.1:${port}/`, headers: {} }, options(localPolicy([port])));
    expect(refused.error).toEqual({ category: "connect" });
    expect(refused.status).toBeUndefined();
  });
});

describe("the destination policy is enforced before and at connect time", () => {
  it("sends nothing for a host that is not allowed, and says why", async () => {
    const raw = await target();
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `http://127.0.0.2:${raw.portNumber}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.error).toEqual({ category: "blocked" });
    expect(outcome.destination).toMatchObject({ verdict: "blocked", reason: "literal_ip_not_allowed" });
    expect(outcome.requestsSent).toBe(0);
    expect(raw.requests).toEqual([]);
  });

  it("sends nothing for a port that is not allowed, and for a scheme that is not http(s)", async () => {
    const raw = await target();
    const sender = createGuardedSender(never);
    const port = await sender.send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber + 1])));
    expect(port.destination).toMatchObject({ verdict: "blocked", reason: "port_not_allowed" });
    const scheme = await sender.send({ method: "GET", url: `ftp://127.0.0.1:${raw.portNumber}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(scheme.destination).toMatchObject({ verdict: "blocked", reason: "scheme_not_allowed" });
    expect(raw.requests).toEqual([]);
  });

  it("refuses a loopback target when the profile does not name the address, on a literal IP and on a name", async () => {
    const raw = await target();
    const sender = createGuardedSender(async () => ["127.0.0.1"]);
    const literal = await sender.send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber], ["127.0.0.1"], [])));
    expect(literal.destination).toMatchObject({ verdict: "blocked", reason: "restricted_address_blocked" });
    const named = await sender.send({ method: "GET", url: `http://target.test:${raw.portNumber}/`, headers: {} }, options(localPolicy([raw.portNumber], ["target.test"], [])));
    expect(named.error).toEqual({ category: "blocked" });
    expect(named.destination).toMatchObject({ host: "target.test", verdict: "blocked", reason: "restricted_address_blocked", addressClass: "loopback" });
    expect(raw.requests).toEqual([]);
  });

  it("connects a name to the address the resolver returns, when that address is allowed", async () => {
    const raw = await target();
    const outcome = await createGuardedSender(async () => ["127.0.0.1"]).send(
      { method: "GET", url: `http://target.test:${raw.portNumber}/named`, headers: {} },
      options(localPolicy([raw.portNumber], ["target.test"])),
    );
    expect(outcome.status).toBe(200);
    expect(outcome.destination).toMatchObject({ host: "target.test", addressClass: "loopback", verdict: "allowed" });
    expect(raw.requests[0].headers.host).toBe(`target.test:${raw.portNumber}`);
  });

  it("connects only to the allowed address when a name resolves to a restricted and an allowed one", async () => {
    const raw = await target();
    const outcome = await createGuardedSender(async () => ["10.255.255.1", "169.254.169.254", "127.0.0.1"]).send(
      { method: "GET", url: `http://target.test:${raw.portNumber}/`, headers: {} },
      options(localPolicy([raw.portNumber], ["target.test"])),
    );
    expect(outcome.status).toBe(200);
    expect(outcome.destination.addressClass).toBe("loopback");
    expect(raw.requests).toHaveLength(1);
  });

  it("blocks a re-resolution to a restricted address after an allowed one (rebinding), and nothing reaches the target", async () => {
    const raw = await target();
    const answers = [["127.0.0.1"], ["10.0.0.5"], ["169.254.169.254"]];
    let call = 0;
    const sender = createGuardedSender(async () => answers[Math.min(call++, answers.length - 1)]);
    const policy = options(localPolicy([raw.portNumber], ["target.test"], ["127.0.0.1"]));
    const url = `http://target.test:${raw.portNumber}/`;
    const first = await sender.send({ method: "GET", url, headers: {} }, policy);
    const second = await sender.send({ method: "GET", url, headers: {} }, policy);
    const third = await sender.send({ method: "GET", url, headers: {} }, policy);
    expect(first.status).toBe(200);
    expect(second.error).toEqual({ category: "blocked" });
    expect(second.destination).toMatchObject({ verdict: "blocked", reason: "restricted_address_blocked" });
    expect(third.destination).toMatchObject({ verdict: "blocked", reason: "metadata_address_blocked" });
    expect(raw.requests).toHaveLength(1);
  });

  it("treats a failed name resolution as a connect error, not a pass", async () => {
    const outcome = await createGuardedSender(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }).send({ method: "GET", url: "http://target.test:1/", headers: {} }, options(localPolicy([1], ["target.test"])));
    expect(outcome.error).toEqual({ category: "connect" });
  });

  it("does not resolve a literal IP host", async () => {
    const raw = await target();
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.status).toBe(200);
  });

  it("reaches the loopback that a local profile names when localhost resolves to both ::1 and 127.0.0.1 (Windows)", async () => {
    const raw = await target();
    const sender = createGuardedSender(async () => ["::1", "127.0.0.1"]);
    const url = `http://localhost:${raw.portNumber}/`;
    const named = await sender.send({ method: "GET", url, headers: {} }, options(localPolicy([raw.portNumber], ["localhost"], ["127.0.0.1"])));
    expect(named.status).toBe(200);
    expect(named.destination.addressClass).toBe("loopback");
    const wrong = await sender.send({ method: "GET", url, headers: {} }, options(localPolicy([raw.portNumber], ["localhost"], ["::1"])));
    // The profile names only ::1, which the target does not listen on; the connection is attempted there and nowhere else.
    expect(wrong.status).toBeUndefined();
    expect(raw.requests).toHaveLength(1);
  });
});

describe("redirects are revalidated, never followed by the library", () => {
  it("follows a same-origin redirect, counting the hop against the budget, and returns the final response", async () => {
    const raw = await target((request, response) => {
      if (request.url === "/a") response.writeHead(302, { location: "/b" }).end();
      else response.writeHead(200).end("final");
    });
    let hops = 0;
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/a`, headers: {} }, options(localPolicy([raw.portNumber]), { reserveHop: () => (hops += 1) > 0 }));
    expect(outcome).toMatchObject({ status: 200, bodyText: "final", requestsSent: 2 });
    expect(outcome.redirects).toEqual([{ to: `${raw.origin}/b`, verdict: "followed" }]);
    expect(hops).toBe(1);
    expect(raw.requests.map((r) => r.url)).toEqual(["/a", "/b"]);
  });

  it("drops credentials on a cross-origin hop and keeps them on a same-origin one", async () => {
    const second = await target((_request, response) => response.writeHead(200).end("second"));
    const first = await target((request, response) => {
      if (request.url === "/same") response.writeHead(302, { location: "/same-landing" }).end();
      else if (request.url === "/same-landing") response.writeHead(200).end();
      else response.writeHead(302, { location: `${second.origin}/landing?token=abc` }).end();
    });
    const policy = options(localPolicy([first.portNumber, second.portNumber]));
    const headers = { authorization: "Bearer sl-seed", cookie: "sid=1", "proxy-authorization": "x", "x-keep": "yes" };
    await createGuardedSender(never).send({ method: "GET", url: `${first.origin}/cross`, headers }, policy);
    expect(first.requests[0].headers.authorization).toBe("Bearer sl-seed");
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0].headers.authorization).toBeUndefined();
    expect(second.requests[0].headers.cookie).toBeUndefined();
    expect(second.requests[0].headers["proxy-authorization"]).toBeUndefined();
    expect(second.requests[0].headers["x-keep"]).toBe("yes");

    await createGuardedSender(never).send({ method: "GET", url: `${first.origin}/same`, headers }, policy);
    const landing = first.requests.find((r) => r.url === "/same-landing");
    expect(landing?.headers.authorization).toBe("Bearer sl-seed");
    expect(landing?.headers.cookie).toBe("sid=1");
  });

  it("does not follow a redirect to a host that is not allowed, records it without the query, and never resolves that host", async () => {
    const seen: string[] = [];
    const raw = await target((_request, response) => response.writeHead(302, { location: "http://evil.test/steal?token=sl-seed-secret#frag" }).end());
    const sender = createGuardedSender(async (host) => {
      seen.push(host);
      return ["127.0.0.1"];
    });
    const outcome = await sender.send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.status).toBe(302);
    expect(outcome.requestsSent).toBe(1);
    expect(outcome.redirects).toEqual([{ to: "http://evil.test/steal", verdict: "blocked", reason: "host_not_allowed" }]);
    expect(JSON.stringify(outcome.redirects)).not.toContain("sl-seed-secret");
    expect(seen).toEqual([]);
    expect(raw.requests).toHaveLength(1);
  });

  it.each([
    ["the metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["an IPv6 metadata address", "http://[fd00:ec2::254]/"],
    ["a decimal spelling of the metadata address", "http://2852039166/"],
    ["a private address", "http://10.0.0.1/"],
    ["a different loopback address", "http://127.0.0.2/"],
    ["another scheme", "ftp://127.0.0.1/"],
    ["a userinfo URL", "http://user:pw@127.0.0.1/"],
  ])("does not follow a redirect to %s", async (_name, location) => {
    const raw = await target((_request, response) => response.writeHead(307, { location }).end());
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber, 80])));
    expect(outcome.redirects).toHaveLength(1);
    expect(outcome.redirects[0].verdict).toBe("blocked");
    expect(outcome.requestsSent).toBe(1);
    expect(raw.requests).toHaveLength(1);
  });

  it("blocks the metadata address even when a local profile lists it and names its range", async () => {
    const raw = await target((_request, response) => response.writeHead(302, { location: "http://169.254.169.254/" }).end());
    const policy = localPolicy([raw.portNumber, 80], ["127.0.0.1", "169.254.169.254"], ["127.0.0.1", "169.254.0.0/16"]);
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(policy));
    expect(outcome.redirects).toEqual([{ to: "http://169.254.169.254/", verdict: "blocked", reason: "metadata_address_blocked" }]);
  });

  it("stops after the hop limit, having followed exactly that many", async () => {
    const raw = await target((request, response) => response.writeHead(302, { location: `/${Number(request.url?.slice(1) ?? "0") + 1}` }).end());
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/0`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.requestsSent).toBe(4);
    expect(outcome.redirects.filter((r) => r.verdict === "followed")).toHaveLength(3);
    expect(outcome.redirects.at(-1)).toMatchObject({ verdict: "blocked", reason: "redirect_hop_limit" });
    expect(outcome.status).toBe(302);
  });

  it("does not follow a hop when the budget has run out", async () => {
    const raw = await target((_request, response) => response.writeHead(302, { location: "/next" }).end());
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber]), { reserveHop: () => false }));
    expect(outcome.requestsSent).toBe(1);
    expect(outcome.redirects).toEqual([{ to: `${raw.origin}/next`, verdict: "blocked", reason: "budget_exhausted" }]);
    expect(raw.requests).toHaveLength(1);
  });

  it("turns a POST into a GET without a body on 303, and keeps method and body on 307", async () => {
    const raw = await target((request, response) => {
      if (request.url === "/see-other") response.writeHead(303, { location: "/landing" }).end();
      else if (request.url === "/temporary") response.writeHead(307, { location: "/landing" }).end();
      else response.writeHead(200).end();
    });
    const sender = createGuardedSender(never);
    const policy = options(localPolicy([raw.portNumber]));
    const post = (path: string) => sender.send({ method: "POST", url: `${raw.origin}${path}`, headers: { "content-type": "application/json" }, body: '{"a":1}' }, policy);
    await post("/see-other");
    await post("/temporary");
    const landings = raw.requests.filter((r) => r.url === "/landing");
    expect(landings[0]).toMatchObject({ method: "GET", body: "" });
    expect(landings[0].headers["content-type"]).toBeUndefined();
    expect(landings[1]).toMatchObject({ method: "POST", body: '{"a":1}' });
  });

  it("reports an unparseable Location as a blocked redirect", async () => {
    const raw = await target((_request, response) => response.writeHead(302, { location: "http://[bad" }).end());
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.redirects[0]).toMatchObject({ verdict: "blocked", reason: "redirect_target_invalid" });
  });
});

describe("limits on the response and the request", () => {
  it("reads only up to the byte cap and marks the response truncated", async () => {
    const raw = await target((_request, response) => response.writeHead(200).end("a".repeat(RESPONSE_READ_CAP_BYTES * 2)));
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.status).toBe(200);
    expect(outcome.truncated).toBe(true);
    expect(Buffer.byteLength(outcome.bodyText)).toBe(RESPONSE_READ_CAP_BYTES);
  });

  it("does not mark a body exactly at the cap as truncated", async () => {
    const raw = await target((_request, response) => response.writeHead(200).end("b".repeat(RESPONSE_READ_CAP_BYTES)));
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
    expect(outcome.truncated).toBe(false);
    expect(Buffer.byteLength(outcome.bodyText)).toBe(RESPONSE_READ_CAP_BYTES);
  });

  it("times out a slow response with the timeout category", async () => {
    const raw = await target((_request, response) => setTimeout(() => response.writeHead(200).end("late"), 1_000));
    const started = Date.now();
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber]), { timeoutMs: 150 }));
    expect(outcome.error).toEqual({ category: "timeout" });
    expect(outcome.status).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("applies one deadline across redirect hops, not one per hop", async () => {
    const raw = await target((request, response) => setTimeout(() => response.writeHead(302, { location: `${request.url}x` }).end(), 120));
    const started = Date.now();
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber]), { timeoutMs: 300 }));
    expect(outcome.error).toEqual({ category: "timeout" });
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("aborts a request in flight when the signal fires, reporting aborted", async () => {
    const raw = await target((_request, response) => setTimeout(() => response.writeHead(200).end(), 2_000));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const started = Date.now();
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber]), { signal: controller.signal }));
    expect(outcome.error).toEqual({ category: "aborted" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("sends nothing when the signal is already aborted", async () => {
    const raw = await target();
    const controller = new AbortController();
    controller.abort();
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber]), { signal: controller.signal }));
    expect(outcome.error).toEqual({ category: "aborted" });
    expect(raw.requests).toEqual([]);
  });

  it("ignores proxy environment variables", async () => {
    const saved = { http: process.env.HTTP_PROXY, https: process.env.HTTPS_PROXY, lower: process.env.http_proxy };
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    process.env.http_proxy = "http://127.0.0.1:1";
    process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    try {
      const raw = await target();
      const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(localPolicy([raw.portNumber])));
      expect(outcome.status).toBe(200);
      expect(raw.requests).toHaveLength(1);
    } finally {
      for (const [name, value] of [["HTTP_PROXY", saved.http], ["HTTPS_PROXY", saved.https], ["http_proxy", saved.lower]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe.skipIf(!opensslAvailable())("TLS policy", () => {
  let certificate: ReturnType<typeof makeSelfSignedCertificate> | undefined;

  async function secureTarget() {
    const raw = new RawTarget((_request, response) => response.writeHead(200).end("secure"));
    // One throwaway certificate for both tests: generating a key is the slow part, and nothing here needs two.
    certificate ??= makeSelfSignedCertificate();
    await raw.start(certificate);
    targets.push(raw);
    return raw;
  }

  it("verifies the certificate by default, so a self-signed one is refused with the tls category", async () => {
    const raw = await secureTarget();
    const policy: DestinationPolicy = { tier: "local", allowedHosts: ["127.0.0.1"], allowedPorts: [raw.portNumber], allowedAddressRanges: ["127.0.0.1"] };
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(policy, { tlsPolicy: "verify" }));
    expect(outcome.error).toEqual({ category: "tls" });
    expect(raw.requests).toEqual([]);
  });

  it("accepts the same certificate under the relaxed-local policy", async () => {
    const raw = await secureTarget();
    const policy: DestinationPolicy = { tier: "local", allowedHosts: ["127.0.0.1"], allowedPorts: [raw.portNumber], allowedAddressRanges: ["127.0.0.1"] };
    const outcome = await createGuardedSender(never).send({ method: "GET", url: `${raw.origin}/`, headers: {} }, options(policy, { tlsPolicy: "relaxed-local" }));
    expect(outcome).toMatchObject({ status: 200, bodyText: "secure" });
  });
});
