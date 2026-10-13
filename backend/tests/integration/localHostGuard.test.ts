import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { isLoopbackBindAddress } from "../../src/security/localHostGuard";

describe("local Host/Origin guard (DNS-rebinding defence)", () => {
  const app = createApp();

  it.each(["localhost:4000", "127.0.0.1:4000", "[::1]:4000", "LOCALHOST"])(
    "accepts Host %s",
    async (host) => {
      const res = await request(app).get("/api/health").set("Host", host);
      expect(res.status).toBe(200);
    },
  );

  it.each(["evil.example.com", "evil.example.com:4000", "192.168.1.20:4000", "localhost.evil.test"])(
    "rejects Host %s with 403 and issues no session cookie",
    async (host) => {
      const res = await request(app).get("/api/health").set("Host", host);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden_host");
      expect(res.headers["set-cookie"]).toBeUndefined();
    },
  );

  it("accepts a loopback Origin such as the Vite dev server", async () => {
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
  });

  it.each(["http://evil.example.com", "http://192.168.1.20:5173", "null"])(
    "rejects a non-loopback Origin %s even when Host is local",
    async (origin) => {
      const res = await request(app).get("/api/health").set("Origin", origin);
      expect(res.status).toBe(403);
    },
  );

  it("is not installed when restrictToLocalHosts is false (operator exposed the server)", async () => {
    const open = createApp(undefined, { restrictToLocalHosts: false });
    const res = await request(open).get("/api/health").set("Host", "apipilot.internal");
    expect(res.status).toBe(200);
  });
});

describe("isLoopbackBindAddress", () => {
  it.each(["127.0.0.1", "localhost", "::1", " 127.0.0.1 "])("treats %s as loopback", (host) => {
    expect(isLoopbackBindAddress(host)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "192.168.1.20", "example.com"])("treats %s as exposed", (host) => {
    expect(isLoopbackBindAddress(host)).toBe(false);
  });
});
