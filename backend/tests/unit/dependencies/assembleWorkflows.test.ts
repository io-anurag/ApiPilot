import { describe, expect, it } from "vitest";
import type { ApiDependencyRelationship } from "@apipilot/shared-domain";
import { assembleWorkflows, MAX_WORKFLOW_STEPS } from "../../../src/dependencies/assembleWorkflows";

function rel(
  overrides: Partial<ApiDependencyRelationship> & Pick<ApiDependencyRelationship, "id" | "producer" | "consumer">,
): ApiDependencyRelationship {
  return {
    confidence: "CONFIRMED",
    source: "deterministic",
    evidence: {
      nameMatch: true,
      typeMatch: true,
      formatMatch: true,
      resourceRelationship: true,
      tagAlignment: true,
    },
    explanation: "test",
    ...overrides,
  };
}

describe("assembleWorkflows", () => {
  it("assembles a linear three-hop chain into one ordered workflow with named hand-offs", () => {
    const r1 = rel({
      id: "r1",
      producer: { operationPath: "/a", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/b", operationMethod: "GET", field: "aId", location: "path" },
    });
    const r2 = rel({
      id: "r2",
      producer: { operationPath: "/b", operationMethod: "GET", field: "token" },
      consumer: { operationPath: "/c", operationMethod: "PUT", field: "token", location: "header" },
    });
    const r3 = rel({
      id: "r3",
      producer: { operationPath: "/c", operationMethod: "PUT", field: "etag" },
      consumer: { operationPath: "/d", operationMethod: "DELETE", field: "etag", location: "header" },
    });

    const { workflows, manualConfirmationCandidates, cycles } = assembleWorkflows([r1, r2, r3]);

    expect(cycles).toEqual([]);
    expect(manualConfirmationCandidates).toEqual([]);
    expect(workflows).toHaveLength(1);
    const [workflow] = workflows;
    expect(workflow.steps.map((s) => `${s.operationMethod} ${s.operationPath}`)).toEqual([
      "POST /a",
      "GET /b",
      "PUT /c",
      "DELETE /d",
    ]);
    expect(workflow.relationshipIds).toEqual(["r1", "r2", "r3"]);
    expect(workflow.variables).toHaveLength(3);
    for (const variable of workflow.variables) {
      expect(variable.producerStepIndex).toBeLessThan(variable.consumerStepIndex);
    }
  });

  it("produces two separate workflows when one producer feeds two unrelated consumers", () => {
    const toB = rel({
      id: "r-to-b",
      producer: { operationPath: "/a", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/b", operationMethod: "GET", field: "aId", location: "path" },
    });
    const toE = rel({
      id: "r-to-e",
      producer: { operationPath: "/a", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/e", operationMethod: "GET", field: "aId", location: "path" },
    });

    const { workflows } = assembleWorkflows([toB, toE]);

    expect(workflows).toHaveLength(2);
    const targets = workflows.map((w) => w.steps.at(-1)?.operationPath).sort();
    expect(targets).toEqual(["/b", "/e"]);
  });

  it("excludes a POSSIBLE relationship from every workflow and reports it as a manual-confirmation candidate", () => {
    const possible = rel({
      id: "r-possible",
      confidence: "POSSIBLE",
      producer: { operationPath: "/x", operationMethod: "POST", field: "name" },
      consumer: { operationPath: "/y", operationMethod: "POST", field: "name", location: "body" },
    });

    const { workflows, manualConfirmationCandidates } = assembleWorkflows([possible]);

    expect(workflows).toEqual([]);
    expect(manualConfirmationCandidates).toEqual([
      expect.objectContaining({ relationshipId: "r-possible", reason: "possible-confidence" }),
    ]);
  });

  it("reports a disambiguation-excluded relationship as a manual-confirmation candidate rather than discarding it", () => {
    const winner = rel({
      id: "r-winner",
      confidence: "CONFIRMED",
      producer: { operationPath: "/a", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/b", operationMethod: "GET", field: "aId", location: "path" },
    });
    const loser = rel({
      id: "r-loser",
      confidence: "LIKELY",
      producer: { operationPath: "/z", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/b", operationMethod: "GET", field: "aId", location: "path" },
    });

    const { workflows, manualConfirmationCandidates } = assembleWorkflows([winner, loser]);

    expect(workflows).toHaveLength(1);
    expect(workflows[0].relationshipIds).toEqual(["r-winner"]);
    expect(manualConfirmationCandidates).toEqual([
      expect.objectContaining({ relationshipId: "r-loser", reason: "excluded-by-disambiguation" }),
    ]);
  });

  it("reports a chain that would exceed MAX_WORKFLOW_STEPS explicitly rather than silently truncating it", () => {
    const relationships: ApiDependencyRelationship[] = [];
    for (let i = 0; i < MAX_WORKFLOW_STEPS + 2; i += 1) {
      relationships.push(
        rel({
          id: `r-${i}`,
          producer: { operationPath: `/n${i}`, operationMethod: "POST", field: "id" },
          consumer: { operationPath: `/n${i + 1}`, operationMethod: "POST", field: "id", location: "path" },
        }),
      );
    }

    const { workflows, manualConfirmationCandidates } = assembleWorkflows(relationships);

    expect(workflows).toHaveLength(1);
    expect(workflows[0].steps.length).toBeLessThanOrEqual(MAX_WORKFLOW_STEPS);
    const oversized = manualConfirmationCandidates.filter((c) => c.reason === "chain-length-exceeded");
    expect(oversized.length).toBeGreaterThan(0);
  });

  it("is deterministic across repeated calls", () => {
    const r1 = rel({
      id: "r1",
      producer: { operationPath: "/a", operationMethod: "POST", field: "id" },
      consumer: { operationPath: "/b", operationMethod: "GET", field: "aId", location: "path" },
    });
    const first = assembleWorkflows([r1]);
    const second = assembleWorkflows([r1]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
