import { describe, expect, it } from "vitest";
import { generateCollection } from "../../../src/postman/generateCollection";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

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

  it("reports no limitations plainly when everything was expressible", () => {
    const outcome = generateCollection(
      { ...exportApiModel, summary: { ...exportApiModel.summary, issues: [] } },
      { scenarios: [approvedTestModel.scenarios[0]] },
    );
    if (!outcome.ok) throw new Error("expected a successful export");
    expect(outcome.result.readme).toContain("None recorded");
  });
});
