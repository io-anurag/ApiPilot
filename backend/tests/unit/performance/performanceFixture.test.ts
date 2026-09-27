import { describe, expect, it } from "vitest";
import { assembleWorkflows } from "../../../src/dependencies/assembleWorkflows";
import { computeDeterministicRelationships } from "../../../src/dependencies/deterministicMatching";
import { loadPerformanceApiModel } from "../../fixtures/performance/specification";

/**
 * Guards the AP-029 fixture itself (tasks T002, analysis finding C3): later tests assume
 * `performance.yaml` yields exactly one CONFIRMED or LIKELY workflow, POST /orders then
 * GET /orders/{orderId}, carrying `orderId`, and nothing for `warehouseId`.
 */
describe("performance.yaml fixture", () => {
  it("analyzes to four operations with an OAuth2 client-credentials scheme", async () => {
    const model = await loadPerformanceApiModel();
    expect(model.operations.map((op) => `${op.method.toUpperCase()} ${op.path}`).sort()).toEqual([
      "GET /orders/{orderId}",
      "GET /status",
      "GET /warehouses/{warehouseId}",
      "POST /orders",
    ]);
    expect(model.securitySchemes.OrdersAuth).toMatchObject({ type: "oauth2" });
  });

  it("gives exactly one eligible workflow: POST /orders -> GET /orders/{orderId} via orderId", async () => {
    const model = await loadPerformanceApiModel();
    const relationships = computeDeterministicRelationships(model);
    const eligible = relationships.filter((r) => r.confidence === "CONFIRMED" || r.confidence === "LIKELY");
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({
      confidence: "CONFIRMED",
      producer: { operationMethod: "POST", operationPath: "/orders", field: "orderId" },
      consumer: { operationMethod: "GET", operationPath: "/orders/{orderId}", field: "orderId" },
    });

    const { workflows } = assembleWorkflows(relationships);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].steps.map((s) => `${s.operationMethod.toUpperCase()} ${s.operationPath}`)).toEqual([
      "POST /orders",
      "GET /orders/{orderId}",
    ]);
    expect(workflows[0].variables.map((v) => v.name)).toEqual(["orderId"]);
    expect(relationships.some((r) => r.consumer.field === "warehouseId")).toBe(false);
  });
});
