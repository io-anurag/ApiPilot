import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sessionMiddleware } from "../../../src/session/sessionMiddleware";
import { resetRegistryForTest } from "../../../src/session/sessionRegistry";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeRequest(cookieHeader?: string): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}

function fakeResponse(): { res: Response; cookieCalls: [string, string, unknown][] } {
  const cookieCalls: [string, string, unknown][] = [];
  const res = {
    cookie: (name: string, value: string, options: unknown) => {
      cookieCalls.push([name, value, options]);
    },
  } as unknown as Response;
  return { res, cookieCalls };
}

describe("sessionMiddleware", () => {
  beforeEach(() => {
    resetRegistryForTest();
  });

  it("issues a cryptographically-random-shaped session id when no cookie is presented", () => {
    const req = fakeRequest(undefined);
    const { res, cookieCalls } = fakeResponse();
    const next = vi.fn();

    sessionMiddleware(req, res, next as unknown as NextFunction);

    expect(cookieCalls).toHaveLength(1);
    const [name, value, options] = cookieCalls[0];
    expect(name).toBe("sessionId");
    expect(value).toMatch(UUID_PATTERN);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing, validly-shaped session id and does not re-issue a cookie", () => {
    const existing = "11111111-2222-3333-4444-555555555555";
    const req = fakeRequest(`sessionId=${existing}`);
    const { res, cookieCalls } = fakeResponse();
    const next = vi.fn();

    sessionMiddleware(req, res, next as unknown as NextFunction);

    expect(cookieCalls).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("replaces a malformed cookie value with a fresh id rather than trusting it", () => {
    const req = fakeRequest("sessionId=not-a-real-uuid");
    const { res, cookieCalls } = fakeResponse();
    const next = vi.fn();

    sessionMiddleware(req, res, next as unknown as NextFunction);

    expect(cookieCalls).toHaveLength(1);
    expect(cookieCalls[0][1]).toMatch(UUID_PATTERN);
    expect(cookieCalls[0][1]).not.toBe("not-a-real-uuid");
  });
});
