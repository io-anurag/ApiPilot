import { describe, expect, it } from "vitest";
import { createAggregate } from "../../../../src/performance/report/aggregate";
import type { RunLayout } from "../../../../src/performance/report/runLayout";
import { createUserScriptAggregate } from "../../../../src/performance/report/userScriptAggregate";
import { httpReq } from "../../../fixtures/performance/ndjson";
import { userRequest } from "../../../fixtures/userScripts/ndjsonBuilder";
import { parseMetricsLine } from "../../../../src/performance/k6/metricsStream";

/**
 * AP-045 FR-005, SC-006: whatever a request carries (an Authorization header, a `?token=` query, a
 * body, user info in the URL), nothing but the step or request name, method, path template, status
 * and duration reaches the live view. The streams below put those values everywhere k6 could.
 */

const SECRETS = ["Bearer SECRET-HEADER", "SECRET-TOKEN", "SECRET-USER", "SECRET-BODY", "SECRET-COOKIE"];

const layout: RunLayout = {
  kind: "run-layout",
  journeys: [{ id: "c1", steps: [{ stepId: "s1", journeyId: "c1", operationKey: "s1", method: "GET", expected: [{ code: "200", source: "user" }], captureNames: [], checks: [] }] }],
  thresholds: [],
};

function expectClean(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain("?");
  expect(text).not.toContain("token=");
}

describe("latest requests carry no sensitive data", () => {
  it("chain: a request tagged with a secret URL shows only the plan's template", () => {
    const aggregate = createAggregate(layout, 10_000, 0, {
      steps: new Map([["s1", { chainId: "c1", chainName: "C", stepName: "Read order", method: "GET", path: "/orders/{{id}}" }]]),
    });
    for (const line of httpReq({ step: "s1", journey: "c1", status: 200, method: "GET", durationMs: 12, atMs: 100 })) {
      const parsed = parseMetricsLine(line);
      if (parsed.kind !== "point") continue;
      const point = { ...parsed.point, tags: { ...parsed.point.tags, url: "https://SECRET-USER:pw@host.test/orders/9?token=SECRET-TOKEN", authorization: "Bearer SECRET-HEADER" } };
      aggregate.ingest(point);
    }
    const { recent } = aggregate.liveParts(1_000);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ chain: "Read order", path: "/orders/{{id}}" });
    expectClean(aggregate.liveParts(1_000));
  });

  it("user script: a named and an unnamed request, each with a secret query, user info and header tag", () => {
    const aggregate = createUserScriptAggregate({ plannedDurationMs: null, startedAtMs: 0 });
    const lines = [
      ...userRequest({ url: "https://SECRET-USER:pw@host.test/orders/9?token=SECRET-TOKEN#SECRET-COOKIE", name: "Named", method: "GET", status: 200, durationMs: 10, atMs: 100 }),
      ...userRequest({ url: "https://SECRET-USER:pw@host.test/orders/9?token=SECRET-TOKEN#SECRET-COOKIE", method: "POST", status: 201, durationMs: 11, atMs: 200 }),
    ];
    for (const line of lines) {
      const parsed = parseMetricsLine(line, { acceptAllMetrics: true });
      if (parsed.kind === "point") aggregate.add({ kind: "point", point: { ...parsed.point, tags: { ...parsed.point.tags, authorization: "Bearer SECRET-HEADER", body: "SECRET-BODY" } } });
    }
    const { recent } = aggregate.liveParts(1_000);
    expect(recent.map((entry) => [entry.chain, entry.path])).toEqual([
      ["host.test", "/orders/9"],
      ["Named", ""],
    ]);
    expectClean(aggregate.liveParts(1_000));
  });

  it("keeps newest first and at most 15 entries for a long stream", () => {
    const aggregate = createAggregate(layout, 10_000, 0, { steps: new Map() });
    for (let n = 0; n < 40; n += 1) {
      for (const line of httpReq({ step: "s1", journey: "c1", status: 200, method: "GET", durationMs: n + 1, atMs: n * 10 })) {
        const parsed = parseMetricsLine(line);
        if (parsed.kind === "point") aggregate.ingest(parsed.point);
      }
    }
    const { recent } = aggregate.liveParts(1_000);
    expect(recent).toHaveLength(15);
    expect(recent[0]!.durationMs).toBe(40);
    expect(recent[14]!.durationMs).toBe(26);
  });
});
