import type { ProxyOptions } from "vite";

/**
 * The one definition of the dev server's `/api` proxy, shared by `vite.config.ts` and the
 * integration tests so they cannot drift apart.
 */
export function apiProxyOptions(backendPort: string): ProxyOptions {
  return {
    // The backend binds 127.0.0.1 by default; `localhost` can resolve to ::1 first.
    target: `http://127.0.0.1:${backendPort}`,
    changeOrigin: true,
    // Forward the original browser address via X-Forwarded-For. The backend ignores this
    // header unless DEBUG_LOG_REAL_CLIENT_IP=true explicitly opts in (see .env.example and
    // backend/src/app.ts), so this is inert by default.
    xfwd: true,
  };
}
