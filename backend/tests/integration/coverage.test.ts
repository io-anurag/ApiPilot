import express from "express";
import request from "supertest";
import type { CoverageSnapshot, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createCoverageRouter } from "../../src/api/coverage";
import type { CoverageSources } from "../../src/apiCoverage/coverageService";
import {
  FIXED_NOW,
  findScenario,
  ordersApiModel,
  ordersScenarios,
  uploadedRun,
} from "../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();

function workflow(over: Partial<TestGenerationWorkflow> = {}): TestGenerationWorkflow {
  return {
    id: "wf-1",
    createdAt: "2026-10-10T09:00:00.000Z",
    updatedAt: "2026-10-10T09:00:00.000Z",
    activeStageId: "scenarioReview",
    stages: {} as TestGenerationWorkflow["stages"],
    specificationFilename: "orders.yaml",
    apiModel: ordersApiModel,
    deterministicTestModel: { scenarios: all },
    ...over,
  };
}

function appWith(sources: Partial<CoverageSources> = {}): express.Express {
  const app = express();
  app.use(
    "/api",
    createCoverageRouter({
      getWorkflow: () => workflow(),
      listUploadedRuns: () => [],
      listGuidedRuns: () => [],
      now: () => FIXED_NOW,
      ...sources,
    }),
  );
  return app;
}

describe("GET /api/coverage", () => {
  it("returns a real, honest snapshot for a specification with no execution", async () => {
    const response = await request(appWith()).get("/api/coverage");
    expect(response.status).toBe(200);
    const snapshot = response.body as CoverageSnapshot;
    expect(snapshot.specification).toMatchObject({ name: "Orders API", version: "1.0.0" });
    expect(snapshot.metrics.find((m) => m.id === "spec-operations")).toMatchObject({ numerator: 4, denominator: 4 });
    expect(snapshot.metrics.find((m) => m.id === "runtime-operations")).toMatchObject({ numerator: 0, denominator: 4 });
    expect(snapshot.notices.map((n) => n.code)).toContain("not-executed");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("applies filters and returns unfiltered totals alongside", async () => {
    const response = await request(appWith()).get("/api/coverage?method=POST&sort=path&order=desc");
    expect(response.status).toBe(200);
    expect(response.body.operations).toHaveLength(1);
    expect(response.body.totals.operations).toBe(4);
  });

  it("accepts repeated and comma-separated list parameters", async () => {
    const repeated = await request(appWith()).get("/api/coverage?method=GET&method=DELETE");
    const commas = await request(appWith()).get("/api/coverage?method=GET,DELETE");
    expect(repeated.body.operations).toHaveLength(3);
    expect(commas.body.operations).toHaveLength(3);
  });

  it("evaluates the selected run and returns 404 for an unknown run", async () => {
    const run = uploadedRun(all, { id: "run-7" });
    const ok = await request(appWith({ listUploadedRuns: () => [run] })).get("/api/coverage?runId=run-7");
    expect(ok.status).toBe(200);
    expect(ok.body.execution.selectedRunId).toBe("run-7");
    const missing = await request(appWith({ listUploadedRuns: () => [run] })).get("/api/coverage?runId=nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("run_not_found");
  });

  it.each([
    ["method=FETCH"],
    ["state=almost"],
    ["priority=urgent"],
    ["gapKind=other"],
    ["sort=colour"],
    ["order=sideways"],
    [`q=${"x".repeat(201)}`],
  ])("rejects an invalid filter (%s) with 400 invalid_filter", async (query) => {
    const response = await request(appWith()).get(`/api/coverage?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_filter");
  });

  it("rejects the security category with 400 category_unavailable and the reason", async () => {
    const response = await request(appWith()).get("/api/coverage?category=security");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("category_unavailable");
    expect(response.body.message).toContain("authorization intent");
  });

  it.each(["insufficient", "stale"])("accepts gapKind=%s", async (kind) => {
    const response = await request(appWith()).get(`/api/coverage?gapKind=${kind}`);
    expect(response.status).toBe(200);
  });

  it("returns 409 no_active_workflow when the session has no specification", async () => {
    const response = await request(appWith({ getWorkflow: () => undefined })).get("/api/coverage");
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("no_active_workflow");
  });

  it("is mounted in the real application and refuses a session without a workflow", async () => {
    const response = await request(createApp()).get("/api/coverage");
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("no_active_workflow");
  });

  it("never leaks raw capture, headers or bodies from stored runs", async () => {
    const run = uploadedRun(all);
    run.results[0].rawCapture = {
      requestUrl: "https://internal.example/?token=LEAK-URL",
      requestHeaders: [{ name: "Authorization", value: "Bearer LEAK-HEADER" }],
      requestBody: "LEAK-REQUEST",
      responseHeaders: [],
      responseBody: "LEAK-RESPONSE",
    };
    const response = await request(appWith({ listUploadedRuns: () => [run] })).get("/api/coverage");
    expect(JSON.stringify(response.body)).not.toMatch(/LEAK/);
  });

  it("treats results from another specification as unattributed, never verified", async () => {
    const orphan = uploadedRun(all.map((s) => ({ ...s, id: `old-${s.id}` })));
    const response = await request(appWith({ listUploadedRuns: () => [orphan] })).get("/api/coverage");
    expect(response.body.execution.unattributedResults).toBe(all.length);
    expect(response.body.metrics.find((m: { id: string }) => m.id === "runtime-operations").numerator).toBe(0);
  });

  it("counts review-workspace scenarios by review state and never counts rejected ones", async () => {
    const delScenario = findScenario(all, "DELETE", "/orders/{id}", "positive-scenario");
    const reviewWorkspace = {
      workspaceRevision: 1,
      scenarios: all.map((scenario) => ({
        scenarioId: scenario.id,
        revision: 1,
        scenario,
        state: scenario.id === delScenario.id ? ("rejected" as const) : ("accepted" as const),
        isUserModified: false,
        history: [],
      })),
      summary: { total: all.length, pending: 0, accepted: all.length - 1, rejected: 1, requiresReview: 0 },
      policy: { originsRequiringReview: ["AI", "USER"] as ("AI" | "USER" | "RULE")[] },
    };
    const response = await request(appWith({ getWorkflow: () => workflow({ reviewWorkspace }) })).get("/api/coverage");
    expect(response.body.context.scenarioCounts).toMatchObject({ rejected: 1, accepted: all.length - 1 });
    const del = response.body.requirements.find((r: { id: string }) => r.id === "op:DELETE /orders/{id}");
    expect(del.scenarioIds).not.toContain(delScenario.id);
  });
});

describe("GET /api/coverage/export", () => {
  it("exports a self-contained, escaped HTML view", async () => {
    const response = await request(appWith()).get("/api/coverage/export?format=html");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-disposition"]).toMatch(/attachment; filename="apipilot-coverage-orders-api-2026-10-10\.html"/);
    expect(response.text).toContain("Generated scenarios contribute to specification coverage.");
    expect(response.text).toContain("Numerator and denominator");
  });

  it("matches the screen figures for the same filtered view, and the whole view for scope=all", async () => {
    const screen = await request(appWith()).get("/api/coverage?method=POST");
    const filtered = await request(appWith()).get("/api/coverage/export?format=json&method=POST");
    const whole = await request(appWith()).get("/api/coverage/export?format=json&method=POST&scope=all");
    expect(JSON.parse(filtered.text).metrics).toEqual(screen.body.metrics);
    expect(JSON.parse(filtered.text).operations).toHaveLength(1);
    expect(JSON.parse(whole.text).operations).toHaveLength(4);
    expect(JSON.parse(filtered.text).view).toContain("method POST");
  });

  it("requires a format and rejects unknown ones", async () => {
    expect((await request(appWith()).get("/api/coverage/export")).status).toBe(400);
    expect((await request(appWith()).get("/api/coverage/export?format=pdf")).status).toBe(400);
  });

  it("escapes specification text in the HTML export", async () => {
    const hostile = { ...ordersApiModel, info: { title: "<script>alert(1)</script>", version: "1" } };
    const response = await request(appWith({ getWorkflow: () => workflow({ apiModel: hostile }) })).get(
      "/api/coverage/export?format=html",
    );
    expect(response.text).not.toContain("<script>alert(1)</script>");
    expect(response.text).toContain("&lt;script&gt;");
  });

  it("carries no secrets in either format", async () => {
    const run = uploadedRun(all);
    run.results[0].rawCapture = {
      requestUrl: "https://x/?t=LEAK",
      requestHeaders: [{ name: "Authorization", value: "Bearer LEAK" }],
      responseHeaders: [],
      responseBody: "LEAK",
    };
    const app = appWith({ listUploadedRuns: () => [run] });
    for (const format of ["html", "json"]) {
      const response = await request(app).get(`/api/coverage/export?format=${format}`);
      expect(response.text).not.toMatch(/LEAK/);
    }
  });

  it("returns 409 without an active workflow", async () => {
    const response = await request(appWith({ getWorkflow: () => undefined })).get("/api/coverage/export?format=json");
    expect(response.status).toBe(409);
  });
});
