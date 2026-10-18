/**
 * The four top-level workflows, the results views and the three artifacts that lead into them (AP-038, research.md D4):
 * the single source the start screen, the top tab menu, the command palette and the help dialog
 * all read, so a title or description cannot drift between them. Presentation metadata only — not
 * domain data, so it lives here rather than in shared-domain. AP-054: workflows no longer carry an
 * identity colour; one accent serves the whole application.
 */

export type EntryChoice =
  | "guided-workflow"
  | "import-collection"
  | "performance"
  | "user-script";

/**
 * Views that present results rather than start a workflow (AP-046). They appear in the tab menu,
 * the command palette and the help dialog beside the four workflows, but not on the start screen:
 * a results view needs a specification and runs that a workflow produces first.
 */
export type ResultsViewId = "coverage" | "security";

/** Anything the top tab menu can show. */
export type TopLevelView = EntryChoice | ResultsViewId;

export type WorkflowIconName = "guided" | "import" | "performance" | "script";
export type ArtifactIconName = "openapi" | "postman" | "k6";

export interface WorkflowEntry {
  readonly id: EntryChoice;
  /** Start-screen, palette and help title. */
  readonly title: string;
  /** Top tab menu label, kept verbatim from before AP-038 (FR-013). */
  readonly tabLabel: string;
  readonly description: string;
  readonly icon: WorkflowIconName;
  readonly recommended: boolean;
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
  },
  {
    id: "import-collection",
    title: "Import & Run Collection",
    tabLabel: "Import & Run Collection",
    description:
      "Bring in a Postman collection and environment, review every request, then run it against your API.",
    icon: "import",
    recommended: false,
  },
  {
    id: "performance",
    title: "Performance",
    tabLabel: "Performance",
    description:
      "Turn a specification, a guided workflow or a collection into a k6 load test: pick a source, review the plan, set the load and run.",
    icon: "performance",
    recommended: false,
  },
  {
    id: "user-script",
    title: "Run k6 Script",
    tabLabel: "Run k6 Script",
    description:
      "Run a k6 script you own after confirming exactly what will execute on this machine.",
    icon: "script",
    recommended: false,
  },
];

export interface ResultsViewEntry {
  readonly id: ResultsViewId;
  readonly title: string;
  readonly tabLabel: string;
  readonly description: string;
}

export const RESULTS_VIEWS: readonly ResultsViewEntry[] = [
  {
    id: "coverage",
    title: "API Test Coverage",
    tabLabel: "Coverage",
    description:
      "See how much of the API your generated tests cover and how much real runs have verified, with the gaps to close next.",
  },
  {
    id: "security",
    title: "Security Lab",
    tabLabel: "Security Lab",
    description:
      "Analyze a specification for security risks, review security test scenarios, run approved ones against a local or staging target, and track findings.",
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
    workflows: ["guided-workflow", "performance"],
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
