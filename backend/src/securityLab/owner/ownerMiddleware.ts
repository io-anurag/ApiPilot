import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { runWithOwner } from "./ownerContext";

export const OWNER_COOKIE_NAME = "apipilotOwner";
/** 400 days, the longest lifetime browsers honour for a cookie. A constant, not product contract (research R22). */
export const OWNER_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

// crypto.randomUUID()'s shape: anything else (missing cookie, foreign or malformed value) is never used as an
// owner id, so a probing client cannot choose its own key or grow the store with garbage.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOwnerCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    if (part.slice(0, separatorIndex).trim() !== OWNER_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Request shape after `ownerMiddleware` has run. */
export interface RequestWithOwnerId extends Request {
  ownerId?: string;
}

/**
 * Gives every Security Lab request an unguessable retained-work owner identity and runs the rest of the
 * request inside `ownerContext`. It is mounted only on the `/api/security-lab` router: no other route sees
 * or sets this cookie. It creates no rows; an owner exists only once something is written under it. The
 * cookie is re-issued on every request so its 400-day lifetime rolls forward while it is in use.
 */
export function ownerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const presented = parseOwnerCookie(req.headers.cookie);
  const ownerId = presented && UUID_PATTERN.test(presented) ? presented.toLowerCase() : randomUUID();

  res.cookie(OWNER_COOKIE_NAME, ownerId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: OWNER_COOKIE_MAX_AGE_MS,
    secure: req.secure === true,
  });

  (req as RequestWithOwnerId).ownerId = ownerId;
  runWithOwner(ownerId, () => next());
}
