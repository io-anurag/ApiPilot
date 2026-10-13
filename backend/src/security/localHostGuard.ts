import type { NextFunction, Request, Response } from "express";

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

/** True when `host` (a bind address, not a request header) only accepts connections from this machine. */
export function isLoopbackBindAddress(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(host.trim().toLowerCase());
}

/**
 * Extracts the hostname from a `Host` header value (`name`, `name:port`, `[v6]`, `[v6]:port`),
 * lowercased and without brackets or port. Returns undefined for anything unparseable.
 */
function hostnameFromHostHeader(value: string): string | undefined {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function hostnameFromOrigin(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    // Includes the literal Origin "null" sent by sandboxed frames and file:// pages.
    return undefined;
  }
}

/**
 * DNS-rebinding defence for the single-user, local-only deployment model. A page on an attacker's
 * domain can be re-pointed at 127.0.0.1 so the victim's browser sends it requests to this server;
 * those requests still carry the attacker's hostname in `Host` (and `Origin`, for cross-origin
 * ones). Rejecting any request whose `Host` or `Origin` is not a loopback name closes that path.
 *
 * Applied only while the server is bound to a loopback address. An operator who explicitly sets
 * `BACKEND_HOST` to expose the server has opted out of the local-only model, and the guard is not
 * installed (see `createApp`'s `restrictToLocalHosts`).
 */
export function localHostGuard(req: Request, res: Response, next: NextFunction): void {
  const hostHeader = req.headers.host;
  const hostname = hostHeader === undefined ? undefined : hostnameFromHostHeader(hostHeader);
  if (hostname === undefined || !LOOPBACK_HOSTNAMES.has(hostname)) {
    reject(res);
    return;
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    const originHostname = hostnameFromOrigin(origin);
    if (originHostname === undefined || !LOOPBACK_HOSTNAMES.has(originHostname)) {
      reject(res);
      return;
    }
  }

  next();
}

function reject(res: Response): void {
  res.status(403).json({
    error: "forbidden_host",
    message: "Requests must be addressed to localhost. ApiPilot is a single-user, local-only tool.",
  });
}
