import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import type { TestGenerationWorkflow, WorkflowStageId } from "@apipilot/shared-domain";
import type { HealthCheckResult } from "../../services/healthClient";
import type { Theme } from "../../hooks/useTheme";
import { guidedStageOf, headerTitleFor } from "../../navigation/destinations";
import type { Route } from "../../navigation/routes";
import { Drawer } from "./Drawer";
import { PageHeader } from "./PageHeader";
import { RouteNotice } from "./RouteNotice";
import { Sidebar } from "./Sidebar";
import { SkipLink } from "./SkipLink";

/**
 * The one shell every screen sits in (AP-054 FR-001): a persistent sidebar, a page header and the
 * page. At `lg` and above the sidebar is a column; below it is a drawer opened by the header's
 * menu button. The pages themselves are rendered by `App`, which keeps them mounted, so this
 * component holds only presentation state (whether the drawer is open).
 */
export function AppShell({
  route,
  workflow,
  viewedStage,
  notice,
  health,
  theme,
  onThemeChange,
  onOpenCommandPalette,
  shortcutHint,
  onNavigate,
  children,
}: Readonly<{
  route: Route;
  workflow: TestGenerationWorkflow | null;
  viewedStage: WorkflowStageId | null;
  notice: string | null;
  health: HealthCheckResult | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenCommandPalette: () => void;
  shortcutHint: string;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}>) {
  const drawerId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const stageOnScreen = route.view === "guided" ? guidedStageOf(route, workflow) : null;
  const heading = headerTitleFor(route, route.view === "guided" ? (viewedStage ?? stageOnScreen) : null);

  return (
    <div data-testid="app-shell" className="technical-grid min-h-screen bg-background text-text-primary lg:flex">
      <SkipLink />
      <Drawer id={drawerId} open={drawerOpen} onClose={closeDrawer}>
        <Sidebar
          route={route}
          workflow={workflow}
          viewedStage={viewedStage}
          onNavigate={(next) => {
            closeDrawer();
            onNavigate(next);
          }}
        />
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          ref={menuButtonRef}
          heading={heading}
          health={health}
          theme={theme}
          onThemeChange={onThemeChange}
          onOpenCommandPalette={onOpenCommandPalette}
          shortcutHint={shortcutHint}
          drawerOpen={drawerOpen}
          drawerId={drawerId}
          onToggleDrawer={() => setDrawerOpen((open) => !open)}
        />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <RouteNotice notice={notice} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
