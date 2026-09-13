import type { ExportResult, GenerationLimitation } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { generateCollection } from "../../../src/postman/generateCollection";
import { renderReadme } from "../../../src/postman/readme";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";
import {
  chainingApiModel,
  graphOf,
  ordersDeleteRelationship,
  ordersDeleteScenario,
  ordersGetRelationship,
  ordersGetScenario,
  ordersListScenario,
  ordersPatchRelationship,
  ordersPatchScenario,
  testModelOf,
} from "../../fixtures/postman/dependencyFixtures";

function readmeFor(options = {}): string {
  const outcome = generateCollection(exportApiModel, approvedTestModel, options);
  if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
  return outcome.result.readme;
}

describe("accompanying document", () => {
  it("states the request count and the folder organization", () => {
    const readme = readmeFor();
    expect(readme).toContain(`Requests: ${approvedTestModel.scenarios.length}`);
    expect(readme).toContain("Folders:");
    expect(readme).toContain("`orders`");
  });

  it("reports the counts of approved scenarios by origin", () => {
    const readme = readmeFor();
    expect(readme).toContain("Rule-derived scenarios: 7");
    expect(readme).toContain("AI-derived scenarios: 1");
  });

  it("lists every variable that must be supplied, with its purpose and sensitivity", () => {
    const readme = readmeFor();
    expect(readme).toContain("## Variables to supply");
    expect(readme).toContain("| `baseUrl` | no |");
    expect(readme).toContain("| `token` | yes |");
    expect(readme).toContain("Address the collection runs against");
  });

  it("explains how to import and run the artifacts", () => {
    const readme = readmeFor();
    expect(readme).toContain("## How to run");
    expect(readme).toContain("collection.json");
    expect(readme).toContain("environment.json");
    expect(readme).toContain("authorized to call");
  });

  it("lists the known limitations grouped by kind", () => {
    const readme = readmeFor();
    expect(readme).toContain("## Known limitations");
    expect(readme).toContain("Scenarios with no expected outcome");
    expect(readme).toContain("Authentication schemes this export cannot configure");
    expect(readme).toContain("Operations carrying specification analysis issues");
    expect(readme).toContain("Request content types this export cannot represent");
  });

  it("states that no AI produced the artifacts and that nothing was executed", () => {
    const readme = readmeFor();
    expect(readme).toContain("nothing in this export was produced by AI");
    expect(readme).toContain("no request was executed");
  });

  it("reports the validation outcome", () => {
    expect(readmeFor()).toContain("passed ApiPilot's pre-delivery validation check");
  });

  it("contains no request payload and no supplied variable value", () => {
    const readme = readmeFor({
      baseUrl: "https://qa.internal.example",
      variableValues: { token: "super-secret-token" },
    });
    expect(readme).not.toContain("super-secret-token");
    expect(readme).not.toContain("qa.internal.example");
    expect(readme).not.toContain("hunter2");
    expect(readme).not.toContain("0f7d1c1e-0000-4000-8000-000000000000");
  });

  it("renders identically for identical input", () => {
    expect(readmeFor()).toBe(readmeFor());
  });

  it("lists a limitation recurring across many rendered occurrences once, with an affected-request count", () => {
    const repeated: GenerationLimitation = {
      kind: "unresolved-path-parameter",
      scenarioId: "scenario-1",
      location: "GET /customers/{id}",
      message:
        'The approved scenario supplied no value for the "id" path parameter, so it is exposed as a variable to fill in.',
    };
    const result: Omit<ExportResult, "readme"> = {
      collection: {
        info: {
          name: "Suite",
          _postman_id: "id",
          schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [{ key: "baseUrl", value: "" }],
        item: [],
      },
      environment: {
        name: "Suite environment",
        _postman_variable_scope: "environment",
        values: [],
      },
      validation: { valid: true, problems: [] },
      limitations: [repeated, repeated, repeated],
      summary: {
        requestCount: 3,
        folderCount: 0,
        byProvenance: { RULE: 3, AI: 0 },
        workflowCount: 3,
        workflowRequestCount: 3,
        standaloneRequestCount: 0,
        workflowVariableCount: 0,
        unsupportedWorkflowCount: 0,
        omittedWorkflowCount: 0,
        automaticChainCount: 0,
      },
    };
    const readme = renderReadme(result, []);
    expect(readme).toContain("Path parameters with no approved value (3)");
    expect(readme).toContain(
      '`GET /customers/{id}` (scenario-1): The approved scenario supplied no value for the "id" path parameter, so it is exposed as a variable to fill in. — affects 3 requests',
    );
    expect(readme.match(/scenario-1/g)).toHaveLength(1);
  });

  it("collapses distinct approved scenarios that hit the same unresolved path parameter at the same location", () => {
    const forOperation = (scenarioId: string): GenerationLimitation => ({
      kind: "unresolved-path-parameter",
      scenarioId,
      location: "PATCH /api/v1/customers/{id}",
      message:
        'The approved scenario supplied no value for the "id" path parameter, so it is exposed as a variable to fill in.',
    });
    const result: Omit<ExportResult, "readme"> = {
      collection: {
        info: {
          name: "Suite",
          _postman_id: "id",
          schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [{ key: "baseUrl", value: "" }],
        item: [],
      },
      environment: {
        name: "Suite environment",
        _postman_variable_scope: "environment",
        values: [],
      },
      validation: { valid: true, problems: [] },
      limitations: [
        forOperation("scenario-a"),
        forOperation("scenario-b"),
        forOperation("scenario-c"),
      ],
      summary: {
        requestCount: 3,
        folderCount: 0,
        byProvenance: { RULE: 3, AI: 0 },
        workflowCount: 0,
        workflowRequestCount: 0,
        standaloneRequestCount: 3,
        workflowVariableCount: 0,
        unsupportedWorkflowCount: 0,
        omittedWorkflowCount: 0,
        automaticChainCount: 0,
      },
    };
    const readme = renderReadme(result, []);
    expect(readme).toContain("Path parameters with no approved value (3)");
    expect(readme).toContain(
      '`PATCH /api/v1/customers/{id}` (3 scenarios): The approved scenario supplied no value for the "id" path parameter, so it is exposed as a variable to fill in. — affects 3 requests',
    );
    expect(readme).not.toContain("scenario-a");
  });

  it("lists an automatically applied chain with its producer, consumer, and evidence (US2, FR-010)", () => {
    const outcome = generateCollection(chainingApiModel, testModelOf(ordersListScenario, ordersDeleteScenario), {}, {
      workflows: [],
      approvedWorkflowIds: [],
      automaticChaining: { graph: graphOf(ordersDeleteRelationship()), cycles: [], workflowDecisions: {} },
    });
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    expect(outcome.result.readme).toContain("## Automatically chained requests");
    expect(outcome.result.readme).toContain("GET /orders");
    expect(outcome.result.readme).toContain("DELETE /orders/{id}");
    expect(outcome.result.readme).toContain("CONFIRMED relationship `rel-orders-delete`");
    expect(outcome.result.readme).toContain("Automatically chained path parameters: 1");
  });

  it("omits the automatic-chains section entirely when no chain was applied", () => {
    const readme = readmeFor();
    expect(readme).not.toContain("## Automatically chained requests");
  });

  it("keeps the automatic-chains section scannable — one bullet per producer, one sub-bullet per consumer (SC-006)", () => {
    const outcome = generateCollection(
      chainingApiModel,
      testModelOf(ordersListScenario, ordersGetScenario, ordersPatchScenario, ordersDeleteScenario),
      {},
      {
        workflows: [],
        approvedWorkflowIds: [],
        automaticChaining: {
          graph: graphOf(ordersGetRelationship(), ordersPatchRelationship(), ordersDeleteRelationship()),
          cycles: [],
          workflowDecisions: {},
        },
      },
    );
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    const section = outcome.result.readme
      .split("## Automatically chained requests")[1]
      .split("## How to run")[0];
    // One producer feeding three consumers: one top-level bullet (the shared capture), three
    // "used by" sub-bullets — never one line per consumer duplicating the producer's own capture.
    expect(section.match(/^- `/gm)).toHaveLength(1);
    expect(section.match(/^ {2}- used by/gm)).toHaveLength(3);
  });

  it("reports no limitations plainly when everything was expressible", () => {
    const outcome = generateCollection(
      { ...exportApiModel, summary: { ...exportApiModel.summary, issues: [] } },
      { scenarios: [approvedTestModel.scenarios[0]] },
    );
    if (!outcome.ok) throw new Error("expected a successful export");
    expect(outcome.result.readme).toContain("None recorded");
  });
});
