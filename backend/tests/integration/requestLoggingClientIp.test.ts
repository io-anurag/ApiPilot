import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";

const FORWARDED_IP = "203.0.113.5";

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedClientIp(): string | undefined {
  const line = logged.find((entry) => entry.includes("request_completed"));
  return line ? (JSON.parse(line).clientIp as string) : undefined;
}

describe("request-completion diagnostics: clientIp (DEBUG_LOG_REAL_CLIENT_IP)", () => {
  it("ignores X-Forwarded-For and logs the direct socket peer when the option is off (default)", async () => {
    const app = createApp();

    await request(app).get("/api/health").set("X-Forwarded-For", FORWARDED_IP);

    expect(loggedClientIp()).not.toBe(FORWARDED_IP);
  });

  it("trusts X-Forwarded-For from the loopback peer and logs the real client IP when enabled", async () => {
    const app = createApp(undefined, { debugLogRealClientIp: true });

    await request(app).get("/api/health").set("X-Forwarded-For", FORWARDED_IP);

    expect(loggedClientIp()).toBe(FORWARDED_IP);
  });
});
