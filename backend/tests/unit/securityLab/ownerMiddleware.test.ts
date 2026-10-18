import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { getOwnerId } from "../../../src/securityLab/owner/ownerContext";
import {
  OWNER_COOKIE_MAX_AGE_MS,
  OWNER_COOKIE_NAME,
  ownerMiddleware,
} from "../../../src/securityLab/owner/ownerMiddleware";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeRequest(cookieHeader?: string, secure = false): Request {
  return { headers: { cookie: cookieHeader }, secure } as unknown as Request;
}

function run(req: Request): { cookie: [string, string, Record<string, unknown>]; seenOwner: string } {
  const calls: [string, string, Record<string, unknown>][] = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => calls.push([name, value, options]),
  } as unknown as Response;
  let seenOwner = "";
  const next = vi.fn(() => {
    seenOwner = getOwnerId();
  });
  ownerMiddleware(req, res, next as unknown as NextFunction);
  expect(next).toHaveBeenCalledTimes(1);
  expect(calls).toHaveLength(1);
  return { cookie: calls[0], seenOwner };
}

describe("ownerMiddleware", () => {
  it("issues a random UUID owner when no cookie is presented, with the documented attributes", () => {
    const { cookie, seenOwner } = run(fakeRequest(undefined));
    const [name, value, options] = cookie;
    expect(name).toBe(OWNER_COOKIE_NAME);
    expect(value).toMatch(UUID_PATTERN);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: OWNER_COOKIE_MAX_AGE_MS, secure: false });
    expect(seenOwner).toBe(value);
  });

  it("keeps a valid presented owner id and re-issues the same value so its lifetime rolls forward", () => {
    const existing = "11111111-2222-3333-4444-555555555555";
    const { cookie, seenOwner } = run(fakeRequest(`other=1; ${OWNER_COOKIE_NAME}=${existing}`));
    expect(cookie[1]).toBe(existing);
    expect(seenOwner).toBe(existing);
  });

  it("replaces a malformed or foreign value instead of adopting it", () => {
    for (const bad of ["not-a-uuid", "../../etc/passwd", "1; DROP TABLE", "%E0%A4%A", ""]) {
      const { cookie, seenOwner } = run(fakeRequest(`${OWNER_COOKIE_NAME}=${bad}`));
      expect(cookie[1]).toMatch(UUID_PATTERN);
      expect(cookie[1]).not.toBe(bad);
      expect(seenOwner).toBe(cookie[1]);
    }
  });

  it("marks the cookie secure only over HTTPS", () => {
    expect(run(fakeRequest(undefined, true)).cookie[2].secure).toBe(true);
    expect(run(fakeRequest(undefined, false)).cookie[2].secure).toBe(false);
  });

  it("does not read the session cookie, so the two identities stay independent", () => {
    const { cookie } = run(fakeRequest("sessionId=11111111-2222-3333-4444-555555555555"));
    expect(cookie[1]).not.toBe("11111111-2222-3333-4444-555555555555");
  });

  it("makes getOwnerId throw outside a request", () => {
    expect(() => getOwnerId()).toThrow(/ownerMiddleware/);
  });
});
