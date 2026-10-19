import {
  WORKFLOW_STAGE_ORDER,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import { getLockReason } from "../components/workflowStageViewModel";

/**
 * Destination addresses (AP-054 FR-029, contracts/routes.md): pure parsing, formatting and
 * "nearest valid destination" resolution. The address is the URL hash only, so the path and the
 * query string (the AP-049 access token, `?mock=` previews) are never read or written. An address
 * carries identifiers only: never names, content, values, ids or tokens.
 */

export const DESTINATION_IDS = ["home", "guided", "import", "performance", "k6", "coverage", "security"] as const;
export type DestinationId = (typeof DESTINATION_IDS)[number];

/** The four areas of Security Lab (AP-057 FR-003), addressable as `#/security/<area>`. A closed list. */
export const SECURITY_AREAS = ["overview", "scenarios", "execution", "reports"] as const;
export type SecurityArea = (typeof SECURITY_AREAS)[number];

export interface Route {
  readonly view: DestinationId;
  /** Only with `view = "guided"`. */
  readonly stage?: WorkflowStageId;
  /** Only with `view = "security"`. */
  readonly area?: SecurityArea;
}

export interface RouteResolution {
  /** The route to show: the requested one, or the nearest valid one. */
  readonly route: Route;
  /** Text explaining a redirect; null when the request is shown as asked. */
  readonly notice: string | null;
  /** True when the browser address should be replaced rather than pushed. */
  readonly replace: boolean;
}

export interface ResolveState {
  readonly workflow: TestGenerationWorkflow | null;
}

const HOME: Route = { view: "home" };

const SEGMENT_TO_VIEW: Readonly<Record<string, DestinationId>> = {
  guided: "guided",
  import: "import",
  performance: "performance",
  k6: "k6",
  coverage: "coverage",
  security: "security",
};

/** Returns null for anything that does not match the grammar exactly: no partial matches. */
export function parseRoute(hash: string): Route | null {
  if (hash === "" || hash === "#" || hash === "#/") return HOME;
  if (!hash.startsWith("#/")) return null;
  const segments = hash.slice(2).split("/");
  const view = SEGMENT_TO_VIEW[segments[0]];
  if (view === undefined) return null;
  if (segments.length === 1) return { view };
  if (segments.length !== 2) return null;
  if (view === "security") {
    const area = SECURITY_AREAS.find((id) => id === segments[1]);
    return area === undefined ? null : { view, area };
  }
  if (view !== "guided") return null;
  const stage = WORKFLOW_STAGE_ORDER.find((id) => id === segments[1]);
  return stage === undefined ? null : { view, stage };
}

/** The exact inverse of `parseRoute` for every valid route. */
export function formatRoute(route: Route): string {
  if (route.view === "home") return "#/";
  if (route.view === "guided" && route.stage !== undefined) return `#/guided/${route.stage}`;
  if (route.view === "security" && route.area !== undefined) return `#/security/${route.area}`;
  return `#/${route.view}`;
}

export function routesEqual(a: Route, b: Route): boolean {
  return a.view === b.view && a.stage === b.stage && a.area === b.area;
}

/**
 * Resolves a requested route against what the session holds. Total and pure: every address
 * resolves to something that can be shown, never to a blank page or an error. This is the only
 * place a redirect is decided.
 */
export function resolveRoute(requested: Route | null, state: ResolveState): RouteResolution {
  if (requested === null) {
    return { route: HOME, notice: "That address does not match a screen, so Home is shown.", replace: true };
  }
  if (requested.view !== "guided" || requested.stage === undefined) {
    return { route: requested, notice: null, replace: false };
  }

  const { workflow } = state;
  if (workflow === null) {
    return {
      route: { view: "guided" },
      notice: "There is no workflow in progress, so the Guided Workflow opens at Upload.",
      replace: true,
    };
  }
  if ((workflow.stages[requested.stage]?.status ?? "not-yet-reached") === "not-yet-reached") {
    const reason = getLockReason(requested.stage, workflow);
    return {
      route: { view: "guided", stage: workflow.activeStageId },
      notice: reason === undefined ? "That stage is not available yet." : `${reason}.`,
      replace: true,
    };
  }
  return { route: requested, notice: null, replace: false };
}
