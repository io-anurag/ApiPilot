import { useEffect, useId, useState } from "react";
import type { TestGenerationWorkflow, WorkflowStageId } from "@apipilot/shared-domain";
import { TOP_DESTINATIONS, buildStageGroups, titleOfDestination } from "../../navigation/destinations";
import { formatRoute, type DestinationId, type Route } from "../../navigation/routes";
import { VersionBadge } from "../VersionBadge";
import { WorkflowIcon } from "../WorkflowIcon";
import type { WorkflowIconName } from "../workflowCatalog";
import { SidebarStages } from "./SidebarStages";

const ITEM =
  "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
// In forced-colours mode backgrounds and shadows are dropped, so the current item also gets an outline.
const CURRENT = "bg-accent font-semibold text-on-accent ring-1 ring-inset ring-brand-500 forced-colors:outline forced-colors:outline-2";
const IDLE = "text-text-secondary hover:bg-surface-hover hover:text-text-primary";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="m3 11 9-8 9 8M5 10v10h14V10M10 20v-6h4v6" />
    </svg>
  );
}

function CoverageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M5 20V10m7 10V4m7 16v-7" />
    </svg>
  );
}

function SecurityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6L12 3Z" />
      <path d="m9.25 12 2 2 3.5-4" />
    </svg>
  );
}

const WORKFLOW_ICON: Readonly<Record<DestinationId, WorkflowIconName | null>> = {
  home: null,
  guided: "guided",
  import: "import",
  performance: "performance",
  k6: "script",
  coverage: null,
  security: null,
};

function Icon({ id }: Readonly<{ id: DestinationId }>) {
  if (id === "home") return <HomeIcon />;
  if (id === "coverage") return <CoverageIcon />;
  if (id === "security") return <SecurityIcon />;
  return <WorkflowIcon name={WORKFLOW_ICON[id] as WorkflowIconName} className="h-5 w-5 shrink-0" />;
}

/**
 * The persistent navigation (AP-054 FR-002, FR-003): the brand with the version at its top, then
 * the six destinations, and under Guided Workflow its eleven stages. It holds navigation only.
 * Destinations are links, so the address bar, middle-click and Back all behave as they should; a
 * plain click is handled here so the shell can close the drawer and push one history entry.
 */
export function Sidebar({
  route,
  workflow,
  viewedStage,
  onNavigate,
}: Readonly<{
  route: Route;
  workflow: TestGenerationWorkflow | null;
  /** The stage the Guided Workflow page reports it is showing. */
  viewedStage: WorkflowStageId | null;
  onNavigate: (route: Route) => void;
}>) {
  const stagesId = useId();
  const inGuided = route.view === "guided";
  const [stagesOpen, setStagesOpen] = useState(inGuided);

  // Reaching the Guided Workflow shows where you are in it; leaving it keeps whatever was chosen.
  useEffect(() => {
    if (inGuided) setStagesOpen(true);
  }, [inGuided]);

  const currentStage = inGuided ? (route.stage ?? viewedStage ?? workflow?.activeStageId ?? "upload") : null;
  const groups = buildStageGroups(workflow, currentStage);

  function link(id: DestinationId, label: string, testId = `sidebar-destination-${id}`) {
    const target: Route = { view: id };
    const current = route.view === id;
    return (
      <a
        href={formatRoute(target)}
        aria-current={current ? "page" : undefined}
        data-testid={testId}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onNavigate(target);
        }}
        className={`${ITEM} ${current ? CURRENT : IDLE}`}
      >
        <Icon id={id} />
        <span className="min-w-0 truncate">{label}</span>
      </a>
    );
  }

  return (
    <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3.5 pb-4 pt-5">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <img src="/logo-icon.png" alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold tracking-tight text-text-primary">ApiPilot</p>
          <VersionBadge />
        </div>
      </div>

      <ul className="flex flex-col gap-0.5">
        <li className="flex">{link("home", titleOfDestination("home"))}</li>
        <li>
          <div className="flex items-center gap-1">
            {link("guided", titleOfDestination("guided"))}
            <button
              type="button"
              aria-expanded={stagesOpen}
              aria-controls={stagesId}
              aria-label={stagesOpen ? "Hide Guided Workflow stages" : "Show Guided Workflow stages"}
              onClick={() => setStagesOpen((open) => !open)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 motion-safe:transition-transform ${stagesOpen ? "rotate-180" : ""}`} aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          {stagesOpen && <SidebarStages id={stagesId} groups={groups} onNavigate={onNavigate} />}
        </li>
        {TOP_DESTINATIONS.map((destination) => (
          <li key={destination.id} className="flex">
            {link(destination.id, destination.label)}
          </li>
        ))}
      </ul>
    </nav>
  );
}
