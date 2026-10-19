import { useState } from "react";
import { Skeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { Tabs, type TabItem } from "../components/Tabs";
import { ExecutionArea } from "../components/securityLab/ExecutionArea";
import { OverviewArea } from "../components/securityLab/OverviewArea";
import { ReportsArea } from "../components/securityLab/ReportsArea";
import { ScenariosArea } from "../components/securityLab/ScenariosArea";
import { areaForIntent, type SecurityLabIntent } from "../components/securityLab/navigationIntent";
import { SpecNotLoadedNotice } from "../components/securityLab/SpecNotLoadedNotice";
import { RESULTS_VIEWS } from "../components/workflowCatalog";
import { SECURITY_AREAS, type SecurityArea } from "../navigation/routes";

const AREA_TABS: ReadonlyArray<TabItem<SecurityArea>> = [
  { id: "overview", label: "Overview" },
  { id: "scenarios", label: "Scenarios" },
  { id: "execution", label: "Execution and Findings" },
  { id: "reports", label: "Reports" },
];

const ENTRY = RESULTS_VIEWS.find((view) => view.id === "security");

export interface SecurityLabPageProps {
  /** `null` while the guided workflow has not been read yet; otherwise whether it holds a specification. */
  readonly specificationLoaded: boolean | null;
  /** The area addressed as `#/security/<area>`, or undefined for the bare destination (Overview). */
  readonly area: SecurityArea | undefined;
  readonly onAreaChange: (area: SecurityArea) => void;
}

/**
 * Security Lab (specs/057 FR-001 to FR-004). The four areas are tabs addressed through the route, so a
 * reload or a shared address lands on the same area. The page stays mounted when another destination is
 * shown (the shell hides it), so a run's progress and unsaved edits survive moving around the product.
 */
export function SecurityLabPage({ specificationLoaded, area, onAreaChange }: Readonly<SecurityLabPageProps>) {
  const [intent, setIntent] = useState<SecurityLabIntent | null>(null);
  const active: SecurityArea = area ?? "overview";
  if (!SECURITY_AREAS.includes(active)) return null;

  // Choosing an area by its tab always starts unfiltered; only an intent (a count or a link) opens a filtered list.
  const chooseArea = (next: SecurityArea) => {
    setIntent(null);
    onAreaChange(next);
  };
  const open = (next: SecurityLabIntent) => {
    setIntent(next);
    onAreaChange(areaForIntent(next));
  };

  return (
    <div data-testid="security-lab-page" className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">{ENTRY?.title ?? "Security Lab"}</h1>
        {ENTRY && <p className="max-w-3xl text-sm text-text-secondary">{ENTRY.description}</p>}
      </header>

      {specificationLoaded === false && <SpecNotLoadedNotice />}

      <Tabs tabs={AREA_TABS} activeTab={active} onChange={chooseArea} label="Security Lab areas" />

      {specificationLoaded === null ? (
        <div role="status" aria-label="Loading Security Lab" className="space-y-3">
          <Skeleton className="h-24 w-full rounded bg-surface-strong" />
          <Skeleton className="h-40 w-full rounded bg-surface-strong" />
        </div>
      ) : (
        <section aria-label={AREA_TABS.find((tab) => tab.id === active)?.label} data-testid={`security-area-${active}`}>
          <AreaContent area={active} intent={intent} onOpen={open} specificationLoaded={specificationLoaded} />
        </section>
      )}
    </div>
  );
}

/** The content of one area. */
function AreaContent({
  area,
  intent,
  onOpen,
  specificationLoaded,
}: Readonly<{ area: SecurityArea; intent: SecurityLabIntent | null; onOpen: (intent: SecurityLabIntent) => void; specificationLoaded: boolean | null }>) {
  if (area === "overview") return <OverviewArea onOpen={onOpen} />;
  if (area === "scenarios") {
    const scenarios = intent?.kind === "scenarios" ? intent : undefined;
    return <ScenariosArea initialFilters={scenarios?.filters} initialSelectedId={scenarios?.selectScenarioId ?? null} specificationLoaded={specificationLoaded !== false} />;
  }
  if (area === "execution") return <ExecutionArea intent={intent} onNavigate={onOpen} specificationLoaded={specificationLoaded} />;
  if (area === "reports") return <ReportsArea specificationLoaded={specificationLoaded !== false} />;
  const label = AREA_TABS.find((tab) => tab.id === area)?.label ?? "This area";
  return <EmptyState message={`${label} is not available yet.`} description="It is built in a later step of this feature." />;
}
