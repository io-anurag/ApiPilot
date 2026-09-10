import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { runWithSession } from "./sessionContext";
import { touch } from "./sessionRegistry";

const COOKIE_NAME = "sessionId";
// crypto.randomUUID()'s shape — anything else (missing cookie, foreign/malformed value) is
// never registered as a session id at all, so it can't be used to grow the session registry
// with garbage entries; a fresh id is issued instead (FR-004a, FR-006).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSessionIdCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Request shape after `sessionMiddleware` has run — `sessionId` backs `reaffirmSession` below. */
interface RequestWithSessionId extends Request {
  sessionId?: string;
}

/**
 * Assigns every request an unguessable session identity (FR-004, FR-004a) and runs the rest of
 * the request inside `sessionContext`'s `AsyncLocalStorage`, so every existing
 * `testGenerationWorkflow/*` module keeps reading/writing "the current workflow" exactly as
 * before — it is now implicitly scoped to this session (research.md D1). Also stashes the id
 * directly on `req` for `reaffirmSession` to recover it (see below).
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const presented = parseSessionIdCookie(req.headers.cookie);
  const sessionId = presented && UUID_PATTERN.test(presented) ? presented : randomUUID();

  if (sessionId !== presented) {
    res.cookie(COOKIE_NAME, sessionId, { httpOnly: true, sameSite: "lax" });
  }

  (req as RequestWithSessionId).sessionId = sessionId;
  touch(sessionId);
  runWithSession(sessionId, () => next());
}

/**
 * Re-enters the session context after `multer`'s `upload.single(...)`/`upload.array(...)`
 * middleware: multer's multipart parsing completes via its own internal stream callback, which
 * does not preserve the `AsyncLocalStorage` context `sessionMiddleware` established (verified —
 * its `next()` call runs outside that context). Any route that both accepts a file upload and
 * needs `getSessionId()` to work afterward must insert this immediately after its
 * `upload.single(...)`/`upload.array(...)` call.
 */
export function reaffirmSession(req: Request, _res: Response, next: NextFunction): void {
  const sessionId = (req as RequestWithSessionId).sessionId;
  if (!sessionId) {
    next(new Error("reaffirmSession requires sessionMiddleware to have run first"));
    return;
  }
  runWithSession(sessionId, () => next());
}
