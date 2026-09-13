import {
  aggregateLimitations,
  type ArtifactVariable,
  type ExportResult,
  type GenerationLimitation,
  type PostmanCollection,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "./ordering";

/**
 * Renders the accompanying document (FR-016, FR-017) deterministically from the export result.
 * It states what the suite covers, what must be supplied to run it, and what could not be
 * expressed. It carries no request payload and no variable value (FR-025).
 */

const LIMITATION_HEADINGS: Record<GenerationLimitation["kind"], string> = {
  "no-expected-outcome": "Scenarios with no expected outcome",
  "undocumented-status-code": "Responses the specification did not document concretely",
  "unsupported-auth-scheme": "Authentication schemes this export cannot configure",
  "unsupported-content-type": "Request content types this export cannot represent",
  "unresolved-path-parameter": "Path parameters with no approved value",
  "specification-analysis-issue": "Operations carrying specification analysis issues",
  "alternative-auth-requirement-selected":
    "Operations declaring alternative authentication",
  "workflow-missing-scenario": "Workflow steps with no approved scenario",
  "workflow-unsupported-sequence": "Workflow sequences this export cannot represent",
  "workflow-unresolved-handoff": "Workflow data handoffs this export could not resolve",
  "workflow-unsupported-extraction-path": "Workflow response paths this export cannot extract",
  "workflow-unsupported-request-representation":
    "Workflow request representations this export cannot express",
};

function coverageSection(
  collection: PostmanCollection,
  summary: ExportResult["summary"],
): string[] {
  const lines = [
    "## Coverage",
    "",
    `- Requests: ${summary.requestCount}`,
    `- Folders: ${summary.folderCount}`,
    `- Rule-derived scenarios: ${summary.byProvenance.RULE}`,
    `- AI-derived scenarios: ${summary.byProvenance.AI}`,
    `- Rendered workflows: ${summary.workflowCount}`,
    `- Workflow requests: ${summary.workflowRequestCount}`,
    `- Standalone requests: ${summary.standaloneRequestCount}`,
    `- Workflow data handoffs: ${summary.workflowVariableCount}`,
    `- Unsupported approved workflows: ${summary.unsupportedWorkflowCount}`,
    `- Omitted unapproved workflows: ${summary.omittedWorkflowCount}`,
    "",
    "Workflow folders contain only explicitly approved, fully supported sequences. Standalone",
    "folders contain approved scenarios not covered by a rendered workflow. Requests are",
    "organized into one folder per workflow or API grouping:",
    "",
  ];
  for (const folder of collection.item) {
    lines.push(`- \`${folder.name}\` — ${folder.item.length} request(s)`);
  }
  return lines;
}

function variableSection(variables: ArtifactVariable[]): string[] {
  const lines = [
    "## Variables to supply",
    "",
    "Fill these into the accompanying environment file before running. Credential variables are",
    "stored as secret values in the environment and never appear in the collection.",
    "",
    "| Variable | Credential | Purpose |",
    "| --- | --- | --- |",
  ];
  for (const variable of [...variables].sort((a, b) =>
    compareCodeUnits(a.name, b.name),
  )) {
    lines.push(
      `| \`${variable.name}\` | ${variable.secret ? "yes" : "no"} | ${variable.purpose} |`,
    );
  }
  return lines;
}

function limitationSection(limitations: GenerationLimitation[]): string[] {
  const lines = ["## Known limitations", ""];
  if (limitations.length === 0) {
    lines.push("None recorded: every approved scenario was expressed in full.");
    return lines;
  }
  lines.push(
    "These are cases the export could not express fully. They are reported rather than filled in",
    "with an assumed value. An identical case recurring across several rendered requests (for",
    "example, the same scenario reused by multiple workflows) is listed once, with the number of",
    "requests it affects.",
    "",
  );
  const kinds = [...new Set(limitations.map((limitation) => limitation.kind))].sort(
    compareCodeUnits,
  );
  for (const kind of kinds) {
    const forKind = limitations.filter((limitation) => limitation.kind === kind);
    lines.push(`### ${LIMITATION_HEADINGS[kind]} (${forKind.length})`, "");
    for (const limitation of aggregateLimitations(forKind)) {
      const scenario = limitation.scenarioId ? ` (${limitation.scenarioId})` : "";
      const affected =
        limitation.occurrences > 1 ? ` — affects ${limitation.occurrences} requests` : "";
      lines.push(`- \`${limitation.location}\`${scenario}: ${limitation.message}${affected}`);
    }
    lines.push("");
  }
  return lines;
}

/** Renders the accompanying README markdown deterministically from the export result and declared variables. */
export function renderReadme(
  result: Omit<ExportResult, "readme">,
  variables: ArtifactVariable[],
): string {
  const lines = [
    `# ${result.collection.info.name}`,
    "",
    "Generated by ApiPilot from an approved test model. Every request here comes from a scenario a",
    "reviewer accepted; nothing in this export was produced by AI, and no request was executed to",
    "create it.",
    "",
    ...coverageSection(result.collection, result.summary),
    "",
    ...variableSection(variables),
    "",
    "## How to run",
    "",
    "1. Import `collection.json` and `environment.json` into Postman.",
    "2. Select the imported environment and fill in the variables listed above.",
    "3. Run the collection, or any individual request.",
    "",
    "Running the collection issues real requests to the address you supply. Generating this",
    "artifact is not authorization to run it: only run it against an environment you are",
    "authorized to call.",
    "",
    ...limitationSection(result.limitations),
    "## Validation",
    "",
    result.validation.valid
      ? "The generated collection passed ApiPilot's pre-delivery validation check."
      : "The generated collection did not pass validation and was not delivered.",
    "",
  ];
  return `${lines.join("\n")}`;
}
