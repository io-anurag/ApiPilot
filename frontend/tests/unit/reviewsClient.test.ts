import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import {
  applyReviewDecisions,
  loadReviewWorkspace,
  toReviewSnapshot,
} from "../../src/services/reviewsClient";

const apiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
} as ApiModel;
const testModel: TestModel = { scenarios: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reviewsClient", () => {
  it("loads a review workspace on success", async () => {
    const review = {
      workspaceRevision: 0,
      scenarios: [],
      summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
      policy: { originsRequiringReview: ["AI", "USER"] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ review, approvedTestModel: testModel, outcomes: [] }),
      }),
    );

    const result = await loadReviewWorkspace(apiModel, testModel);

    expect(result.ok).toBe(true);
    expect(result.ok && result.review.workspaceRevision).toBe(0);
  });

  it("returns a safe error result when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_test_scenario_review_request",
          message: "bad request",
        }),
      }),
    );

    const result = await loadReviewWorkspace(apiModel, testModel);

    expect(result).toEqual({
      ok: false,
      error: "invalid_test_scenario_review_request",
      message: "bad request",
    });
  });

  it("returns a network_error result when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const result = await loadReviewWorkspace(apiModel, testModel);

    expect(result).toEqual({
      ok: false,
      error: "network_error",
      message: "connection refused",
    });
  });

  it("sends the previous workspace snapshot when applying decisions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        review: {
          workspaceRevision: 1,
          scenarios: [],
          summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
          policy: { originsRequiringReview: [] },
        },
        approvedTestModel: testModel,
        outcomes: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = toReviewSnapshot({
      workspaceRevision: 0,
      scenarios: [],
      summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
      policy: { originsRequiringReview: [] },
    });

    await applyReviewDecisions(apiModel, testModel, snapshot, [
      { scenarioId: "s1", revision: 0, action: "accept" },
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.review.workspaceRevision).toBe(0);
    expect(body.review.updates).toEqual([
      { scenarioId: "s1", revision: 0, action: "accept" },
    ]);
  });

  it("returns undefined snapshot when no prior workspace has been observed", () => {
    expect(toReviewSnapshot(null)).toBeUndefined();
  });
});
