import { describe, expect, it } from "vitest";
import { parseMetricsLine } from "../../../src/performance/k6/metricsStream";
import { declaration, point } from "../../fixtures/userScripts/ndjsonBuilder";

/** AP-034 tasks T014: the `acceptAllMetrics` option, beside AP-029's unchanged default. */
describe("parseMetricsLine", () => {
  it("keeps the AP-029 allow-list and ignores declarations by default", () => {
    expect(parseMetricsLine(point("order_latency", 3, {}, 0)).kind).toBe("ignored");
    expect(parseMetricsLine(declaration("http_req_duration", "trend", ["p(95)<500"])).kind).toBe("ignored");
    expect(parseMetricsLine(point("http_reqs", 1, { status: "200" }, 0)).kind).toBe("point");
  });

  it("with acceptAllMetrics, keeps every metric and returns declarations with their thresholds", () => {
    const options = { acceptAllMetrics: true };
    const custom = parseMetricsLine(point("order_latency", 3, { scenario: "default" }, 0), options);
    expect(custom).toMatchObject({ kind: "point", point: { metric: "order_latency", value: 3 } });
    expect(parseMetricsLine(declaration("http_req_duration", "trend", ["p(95)<500"]), options)).toEqual({
      kind: "declaration",
      name: "http_req_duration",
      metricType: "trend",
      thresholds: ["p(95)<500"],
    });
    expect(parseMetricsLine(JSON.stringify({ type: "Metric", metric: "x", data: { name: "x", type: "histogram" } }), options).kind).toBe("unreadable");
  });
});
