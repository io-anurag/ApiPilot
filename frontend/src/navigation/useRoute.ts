import { useCallback, useEffect, useState } from "react";
import { formatRoute, parseRoute, resolveRoute, routesEqual, type ResolveState, type Route } from "./routes";

/**
 * The current destination, read from the URL hash and kept in step with the browser's own history
 * (AP-054 FR-029). Back, Forward, refresh and bookmarks all arrive as `hashchange` or as the
 * initial hash. The path and the query string are never touched (the AP-049 access token and the
 * `?mock=` previews live there).
 *
 * `ready` says whether the session's workflow has been read yet. Until it has, an address that
 * names a stage cannot be judged, so it is shown as asked rather than redirected on a guess.
 */
export function useRoute(state: ResolveState & Readonly<{ ready: boolean }>): Readonly<{
  /** The destination to show (the requested one, or the nearest valid one). */
  route: Route;
  /** Why an address was replaced by a valid one; cleared on the next navigation. */
  notice: string | null;
  /** A user navigation: pushes an address so Back returns to the screen being left. */
  navigate: (route: Route) => void;
  /** Keeps the address in step with an in-page change (the stage on screen) without a history entry. */
  replaceRoute: (route: Route) => void;
  dismissNotice: () => void;
}> {
  const [hash, setHash] = useState(() => window.location.hash);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const requested = parseRoute(hash);
  const judgeable = state.ready || requested?.stage === undefined;
  const resolution = judgeable
    ? resolveRoute(requested, state)
    : { route: requested as Route, notice: null, replace: false };

  const { replace, route } = resolution;
  const target = formatRoute(route);
  const resolutionNotice = resolution.notice;
  useEffect(() => {
    if (!replace) return;
    writeAddress(target);
    setHash(window.location.hash);
    setNotice(resolutionNotice);
  }, [replace, target, resolutionNotice]);

  const navigate = useCallback((next: Route) => {
    setNotice(null);
    const current = parseRoute(window.location.hash);
    if (current !== null && routesEqual(current, next)) return;
    window.location.hash = formatRoute(next);
    setHash(formatRoute(next));
  }, []);

  const replaceRoute = useCallback((next: Route) => {
    const current = parseRoute(window.location.hash);
    if (current !== null && routesEqual(current, next)) return;
    writeAddress(formatRoute(next));
    setHash(window.location.hash);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { route, notice, navigate, replaceRoute, dismissNotice };
}

/** Replaces the hash only: path and query string stay exactly as they are. */
function writeAddress(hash: string) {
  const url = new URL(window.location.href);
  url.hash = hash;
  window.history.replaceState(null, "", url);
}
