/**
 * The five top-level views and the three artifacts that lead into them (AP-038, research.md D4):
 * the single source the start screen, the top tab menu, the command palette and the help dialog
 * all read, so a title, description or colour cannot drift between them. Presentation metadata
 * only — not domain data, so it lives here rather than in shared-domain.
 *
 * `tone` values are literal class strings (not built from the id) so Tailwind's scanner sees
 * them; each derives from the workflow's `--color-wf-*` token in index.css.
 */

export type EntryChoice =
  | "guided-workflow"
  | "import-collection"
  | "quick-performance"
  | "performance-plans"
  | "user-script";

/**
 * Views that present results rather than start a workflow (AP-046). They appear in the tab menu,
 * the command palette and the help dialog beside the five workflows, but not on the start screen:
 * a results view needs a specification and runs that a workflow produces first.
 */
export type ResultsViewId = "coverage";

/** Anything the top tab menu can show. */
export type TopLevelView = EntryChoice | ResultsViewId;

export type WorkflowIconName = "guided" | "import" | "quick" | "plans" | "script";
export type ArtifactIconName = "openapi" | "postman" | "k6";

export interface WorkflowTone {
  /** Small colour square shown beside the workflow's name (tabs, palette, artifact controls). */
  readonly marker: string;
  /** Icon tile: tinted background, border and icon colour. */
  readonly tile: string;
  /** Quiet round affordance (the card's arrow): outlined, never a filled circle. */
  readonly action: string;
  /** Card hover/focus border. */
  readonly border: string;
}

export interface WorkflowEntry {
  readonly id: EntryChoice;
  /** Start-screen, palette and help title. */
  readonly title: string;
  /** Top tab menu label, kept verbatim from before AP-038 (FR-013). */
  readonly tabLabel: string;
  readonly description: string;
  readonly icon: WorkflowIconName;
  readonly recommended: boolean;
  readonly tone: WorkflowTone;
}

export const WORKFLOWS: readonly WorkflowEntry[] = [
  {
    id: "guided-workflow",
    title: "Guided Workflow",
    tabLabel: "Guided Workflow",
    description:
      "Turn an OpenAPI specification into reviewed API tests and a ready-to-run Postman collection.",
    icon: "guided",
    recommended: true,
    tone: {
      marker: "bg-wf-guided",
      tile: "border-wf-guided/30 bg-wf-guided/10 text-wf-guided",
      action: "border border-wf-guided/40 bg-surface text-wf-guided",
      border: "hover:border-wf-guided/40",
    },
  },
  {
    id: "import-collection",
    title: "Import & Run Collection",
    tabLabel: "Import & Run Collection",
    description:
      "Bring in a Postman collection and environment, review every request, then run it against your API.",
    icon: "import",
    recommended: false,
    tone: {
      marker: "bg-wf-import",
      tile: "border-wf-import/30 bg-wf-import/10 text-wf-import",
      action: "border border-wf-import/40 bg-surface text-wf-import",
      border: "hover:border-wf-import/40",
    },
  },
  {
    id: "quick-performance",
    title: "Quick performance test",
    tabLabel: "Quick Performance Test",
    description:
      "Turn an OpenAPI specification into a k6 load test when you need fast signal, not review.",
    icon: "quick",
    recommended: false,
    tone: {
      marker: "bg-wf-quick",
      tile: "border-wf-quick/30 bg-wf-quick/10 text-wf-quick",
      action: "border border-wf-quick/40 bg-surface text-wf-quick",
      border: "hover:border-wf-quick/40",
    },
  },
  {
    id: "performance-plans",
    title: "Performance plans",
    tabLabel: "Performance Plans",
    description:
      "Design multi-step k6 journeys that pass data between requests and verify each response.",
    icon: "plans",
    recommended: false,
    tone: {
      marker: "bg-wf-plans",
      tile: "border-wf-plans/30 bg-wf-plans/10 text-wf-plans",
      action: "border border-wf-plans/40 bg-surface text-wf-plans",
      border: "hover:border-wf-plans/40",
    },
  },
  {
    id: "user-script",
    title: "Run k6 Script",
    tabLabel: "Run k6 Script",
    description:
      "Run a k6 script you own after confirming exactly what will execute on this machine.",
    icon: "script",
    recommended: false,
    tone: {
      marker: "bg-wf-k6",
      tile: "border-wf-k6/30 bg-wf-k6/10 text-wf-k6",
      action: "border border-wf-k6/40 bg-surface text-wf-k6",
      border: "hover:border-wf-k6/40",
    },
  },
];

export interface ResultsViewEntry {
  readonly id: ResultsViewId;
  readonly title: string;
  readonly tabLabel: string;
  readonly description: string;
  /** Colour square beside the name, from the results section token. */
  readonly marker: string;
}

export const RESULTS_VIEWS: readonly ResultsViewEntry[] = [
  {
    id: "coverage",
    title: "API Test Coverage",
    tabLabel: "Coverage",
    description:
      "See how much of the API your generated tests cover and how much real runs have verified, with the gaps to close next.",
    marker: "bg-section-results",
  },
];

export function isResultsView(view: TopLevelView): view is ResultsViewId {
  return RESULTS_VIEWS.some((entry) => entry.id === view);
}

export interface ArtifactChoice {
  readonly id: "openapi" | "postman" | "k6";
  readonly label: string;
  /** How the artifact reads inside a sentence: "for an OpenAPI specification". */
  readonly phrase: string;
  readonly icon: ArtifactIconName;
  readonly workflows: readonly EntryChoice[];
}

/** Which workflows accept each artifact an engineer may already hold (FR-009). */
export const ARTIFACT_CHOICES: readonly ArtifactChoice[] = [
  {
    id: "openapi",
    label: "OpenAPI specification",
    phrase: "an OpenAPI specification",
    icon: "openapi",
    workflows: ["guided-workflow", "quick-performance"],
  },
  {
    id: "postman",
    label: "Postman collection",
    phrase: "a Postman collection",
    icon: "postman",
    workflows: ["import-collection"],
  },
  {
    id: "k6",
    label: "k6 script",
    phrase: "a k6 script",
    icon: "k6",
    workflows: ["user-script"],
  },
];

export function workflowById(id: EntryChoice): WorkflowEntry {
  const entry = WORKFLOWS.find((workflow) => workflow.id === id);
  if (!entry) throw new Error(`Unknown workflow: ${id}`);
  return entry;
}
