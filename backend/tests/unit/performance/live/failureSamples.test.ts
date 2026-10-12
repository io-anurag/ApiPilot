import { describe, expect, it } from "vitest";
import { createAggregate } from "../../../../src/performance/report/aggregate";
import { layoutFromChainSnapshot } from "../../../../src/performance/report/runLayout";
import { analyzeChainPlan } from "@apipilot/shared-domain";
import { chainRunSnapshot } from "../../../../src/performance/chain/runSnapshot";
import { planFingerprint } from "../../../../src/performance/chain/savePlan";
import { failureResponseSettings } from "../../../../src/performance/chain/failureResponseSettings";
import { liveStepInfoFromChain } from "../../../../src/performance/live/liveStepInfo";
import { createFailureResponseBuilder, createFailureRing, parseFailureLine, FAILURE_MARKER, type FailureSample } from "../../../../src/performance/live/failureSamples";
import { customerLifecyclePlan } from "../../../fixtures/chain/chainPlans";

/** AP-049: failed-request samples for the live view. */

function line(sample: Record<string, unknown>): string {
  return JSON.stringify({ level: "info", msg: FAILURE_MARKER + JSON.stringify(sample), source: "console", time: "2026-10-12T13:12:14Z" });
}

const SAMPLE: FailureSample = { step: "s2", journey: "c1", status: 400, contentType: "application/json", size: 30, body: '{"error":"name already exists"}' };

describe("parseFailureLine", () => {
  it("reads a console line the script wrote", () => {
    expect(parseFailureLine(line({ step: "s2", journey: "c1", status: 400, type: "application/json", size: 30, body: SAMPLE.body }))).toEqual(SAMPLE);
  });

  it("ignores other k6 output and malformed lines", () => {
    expect(parseFailureLine('{"level":"warning","msg":"Request Failed"}')).toBeNull();
    expect(parseFailureLine("not json APIPILOT_FAILURE {")).toBeNull();
    expect(parseFailureLine(JSON.stringify({ msg: `${FAILURE_MARKER}{"step":1}` }))).toBeNull();
  });

  it("never keeps more than the body limit", () => {
    const parsed = parseFailureLine(line({ step: "s2", journey: "c1", status: 500, type: null, size: 9000, body: "x".repeat(9000) }));
    expect(parsed?.body).toHaveLength(2048);
  });
});

describe("failure responses", () => {
  const builder = createFailureResponseBuilder({ secrets: [{ name: "client_secret", value: "s3cr3t-value", kind: "environment" }], withhold: false });

  it("shows the response text", () => {
    expect(builder.responseOf(SAMPLE)).toEqual({ kind: "text", contentType: "application/json", text: SAMPLE.body, truncated: false });
  });

  it("masks a secret environment value and a credential-looking field", () => {
    const body = '{"echo":"s3cr3t-value","access_token":"abc.def.ghi","message":"bad request"}';
    const response = builder.responseOf({ ...SAMPLE, size: body.length, body });
    expect(response.kind === "text" && response.text).not.toContain("s3cr3t-value");
    expect(response.kind === "text" && response.text).not.toContain("abc.def.ghi");
    expect(response.kind === "text" && response.text).toContain("bad request");
    expect(response.kind === "text" && response.text).toContain("[masked]");
  });

  it("says when the text was cut", () => {
    const response = builder.responseOf({ ...SAMPLE, size: 5000, body: "x".repeat(2048) });
    expect(response.kind === "text" && response.truncated).toBe(true);
  });

  it("distinguishes no response, an empty response and a withheld one", () => {
    expect(builder.responseOf({ ...SAMPLE, status: 0, size: 0, body: "" })).toEqual({ kind: "none-received" });
    expect(builder.responseOf({ ...SAMPLE, size: 0, body: "" })).toEqual({ kind: "empty", contentType: "application/json" });
    const withheld = createFailureResponseBuilder({ secrets: [], withhold: true });
    expect(withheld.responseOf(SAMPLE)).toEqual({ kind: "withheld", reason: "secret-data-columns" });
  });
});

describe("failureResponseSettings", () => {
  it("masks the plan's secret environment values and withholds when a data set column is secret", () => {
    const plan = customerLifecyclePlan();
    const settings = failureResponseSettings({ ...plan, secretNames: ["client_secret"] }, { variableValues: { client_secret: "abc", other: "def" } });
    expect(settings.secrets).toEqual([{ name: "client_secret", value: "abc", kind: "environment" }]);
    expect(settings.withhold).toBe(false);
    const withSecretColumn = { ...plan, dataSets: [{ ...plan.dataSets[0], columns: [{ name: "password", secret: true }] }] } as unknown as typeof plan;
    expect(failureResponseSettings(withSecretColumn, { variableValues: {} }).withhold).toBe(true);
  });
});

describe("failure ring", () => {
  it("keeps the newest fifteen, newest first", () => {
    const ring = createFailureRing();
    for (let index = 0; index < 20; index += 1) ring.push({ second: index, chain: "c", method: "GET", path: "/", status: 500, response: { kind: "none-received" } });
    const kept = ring.list();
    expect(kept).toHaveLength(15);
    expect(kept[0].second).toBe(19);
    expect(kept.at(-1)?.second).toBe(5);
  });
});

describe("aggregate.recordFailureSample", () => {
  it("lists the failure with its step's chain, method and path, and puts it in the live parts", () => {
    const plan = { ...customerLifecyclePlan(), fingerprint: "" };
    const fingerprinted = { ...plan, fingerprint: planFingerprint(plan) };
    const snapshot = chainRunSnapshot(fingerprinted, analyzeChainPlan(fingerprinted, { environmentValueNames: null }));
    const stepId = snapshot.chains[0].steps[1].id;
    const aggregate = createAggregate(layoutFromChainSnapshot(snapshot), 60_000, 1_000_000, { steps: liveStepInfoFromChain(snapshot) });
    aggregate.recordFailureSample({ ...SAMPLE, step: stepId }, 1_000_000 + 12_400);
    const [failure] = aggregate.liveParts(1_000_000 + 13_000).recentFailures ?? [];
    expect(failure).toMatchObject({ second: 12, status: 400, method: snapshot.chains[0].steps[1].method });
    expect(failure.response).toMatchObject({ kind: "text" });
  });
});
