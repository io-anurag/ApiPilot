// @vitest-environment node
/**
 * The real frontend/vite.config.ts resolved under different FRONTEND_DEV_HOST values
 * (specs/049-lan-dev-access-token FR-001, FR-002, FR-011, SC-004, SC-006). Nothing is started: the
 * config is only resolved and inspected.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "vite";
import { DEV_ACCESS_PLUGIN_NAME } from "../../devAccess/devAccessPlugin";

const frontendRoot = path.resolve(__dirname, "../..");
const configFile = path.join(frontendRoot, "vite.config.ts");

const TOUCHED = ["FRONTEND_DEV_HOST", "BACKEND_PORT", "FRONTEND_DEV_PORT", "FRONTEND_DEV_ACCESS", "DEBUG_LOG_REAL_CLIENT_IP"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]));
  for (const name of TOUCHED) delete process.env[name];
});

afterEach(() => {
  for (const name of TOUCHED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

async function resolveWith(host: string | undefined, extra: Record<string, string> = {}) {
  // The config also reads the repository-root `.env`, where a developer may have set these very
  // values. A value in the shell wins over it, so pin both: "unset" is the empty string.
  process.env.FRONTEND_DEV_HOST = host ?? "";
  process.env.BACKEND_PORT = "4000";
  Object.assign(process.env, extra);
  return resolveConfig({ configFile, root: frontendRoot }, "serve");
}

const hasGuard = (config: Awaited<ReturnType<typeof resolveWith>>) =>
  config.plugins.some((plugin) => plugin.name === DEV_ACCESS_PLUGIN_NAME);

describe("frontend/vite.config.ts and FRONTEND_DEV_HOST", () => {
  it.each([undefined, "", "127.0.0.1", "localhost", "::1"])(
    "keeps today's behaviour for %j: loopback, no guard, the same proxy",
    async (host) => {
      const config = await resolveWith(host);
      expect(["127.0.0.1", "localhost", "::1"]).toContain(String(config.server.host));
      expect(hasGuard(config)).toBe(false);
      const proxy = config.server.proxy?.["/api"] as { target: string; changeOrigin: boolean; xfwd: boolean };
      expect(proxy).toMatchObject({ target: "http://127.0.0.1:4000", changeOrigin: true, xfwd: true });
    },
  );

  it("defaults to 127.0.0.1 exactly as before when the setting is unset", async () => {
    expect((await resolveWith(undefined)).server.host).toBe("127.0.0.1");
  });

  it.each(["0.0.0.0", "::", "192.168.1.20", "2001:db8::20", "my-machine.local"])(
    "protects the non-loopback value %s, listening on it",
    async (host) => {
      const config = await resolveWith(host);
      expect(hasGuard(config)).toBe(true);
      expect(config.server.host).toBe(host);
    },
  );

  it("has no switch that turns the guard off", async () => {
    const config = await resolveWith("0.0.0.0", {
      FRONTEND_DEV_ACCESS: "off",
      DEBUG_LOG_REAL_CLIENT_IP: "true",
    });
    expect(hasGuard(config)).toBe(true);
  });

  it("follows BACKEND_PORT for the proxy while protected", async () => {
    const config = await resolveWith("0.0.0.0", { BACKEND_PORT: "4777" });
    const proxy = config.server.proxy?.["/api"] as { target: string };
    expect(proxy.target).toBe("http://127.0.0.1:4777");
  });

  it.each(["not a host", "http://host", "host:5173", "999.999.999.999"])(
    "refuses to start for the invalid value %j, naming the setting, with no fallback",
    async (host) => {
      await expect(resolveWith(host)).rejects.toThrow(/FRONTEND_DEV_HOST/);
    },
  );
});
