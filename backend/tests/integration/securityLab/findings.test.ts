import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { getSecurityFindingRepository } from "../../../src/persistence/securityFindingRepository";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { approve, generateAll, scenarioIds, startHarness, startRun, waitForRun, type Harness, type ScenarioRef } from "../../fixtures/securityLab/runHarness";
import { ALICE_TOKEN } from "../../fixtures/securityLab/runFixtures";

const BASE = "/api/security-lab";
const harnesses: Harness[] = [];

afterEach(async () => {
  await settleActiveRuns();
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

async function setup(options: Parameters<typeof startHarness>[0] = {}): Promise<{ h: Harness; items: ScenarioRef[] }> {
  const h = await startHarness(options);
  harnesses.push(h);
  await generateAll(h);
  const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);
  await approve(h, items);
  return { h, items };
}

async function run(h: Harness, items: ScenarioRef[]) {
  const started = await startRun(h, items);
  expect(started.status).toBe(202);
  return waitForRun(h, started.body.run.id);
}

const findings = async (h: Harness, query = "") => (await h.agent.get(`${BASE}/findings${query}`)).body;

describe("a run against a vulnerable target creates findings", () => {
  it("fails the scenarios the target answers wrongly, and creates exactly one finding for each failed version", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    const detail = await run(h, items);
    const failed = detail.results.filter((result: { outcome: string }) => result.outcome === "failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(detail.results.every((result: { outcome: string }) => ["failed", "passed", "inconclusive"].includes(result.outcome))).toBe(true);

    const list = await findings(h);
    expect(list.total).toBe(failed.length);
    expect(list.items.map((finding: { scenarioId: string }) => finding.scenarioId).sort()).toEqual(failed.map((result: { scenarioId: string }) => result.scenarioId).sort());
    for (const finding of list.items) {
      expect(finding).toMatchObject({ status: "open", occurrenceCount: 1, scenarioVersion: 1, operationKey: "GET /orders", categoryId: "authentication", unreviewedOccurrence: false });
      expect(finding.id).toMatch(/^sf-[0-9a-f]{16}$/);
      expect(finding.remediation.length).toBeGreaterThan(40);
      expect(finding.severity.suggested).toBe(finding.severity.current);
      expect(finding.confidence.basis.length).toBeGreaterThan(20);
    }
    expect(list.counts).toMatchObject({ occurrences: failed.length, withUnreviewedOccurrence: 0 });
  });

  it("marks the scenarios evaluated and links every occurrence to its run and result", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    const detail = await run(h, items);
    expect((await h.agent.get(`${BASE}/scenarios?executionStatus=evaluated&pageSize=100`)).body.total).toBe(items.length);
    const [finding] = (await findings(h)).items;
    const resultIds = detail.results.map((result: { id: string }) => result.id);
    expect(finding.occurrences).toHaveLength(1);
    expect(finding.occurrences[0]).toMatchObject({ runId: detail.run.id, evidenceAvailable: true });
    expect(resultIds).toContain(finding.occurrences[0].resultId);
    expect(finding.specElementPointer).toMatch(/^\/operations\//);
  });

  it("adds an occurrence, not a finding, when the same version fails again (SC-011)", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await run(h, items);
    const first = await findings(h);
    await run(h, items);
    await run(h, items);
    const after = await findings(h);
    expect(after.total).toBe(first.total);
    for (const finding of after.items) expect(finding.occurrenceCount).toBe(3);
    expect(after.counts.occurrences).toBe(first.total * 3);
    // Findings are counted apart from occurrences.
    expect(after.total).not.toBe(after.counts.occurrences);
  });

  it("describes what was observed without quoting any of the response body or a credential", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await run(h, items);
    const text = JSON.stringify(await findings(h));
    expect(text).not.toContain(ALICE_TOKEN);
    expect(text).not.toContain("ord-1001");
    const [finding] = (await findings(h)).items;
    expect(finding.occurrences[0].observed.statement).toMatch(/^Status 200 for a request/);
    expect(finding.occurrences[0].observed.statement).toMatch(/ Violated: the /);
  });
});

describe("a run against a secure target creates none", () => {
  it("passes the scenarios and creates no finding", async () => {
    const { h, items } = await setup();
    const detail = await run(h, items);
    expect(detail.results.map((result: { outcome: string }) => result.outcome)).toEqual(items.map(() => "passed"));
    expect((await findings(h)).total).toBe(0);
  });

  it("creates none for a blocked scenario, which never counts as a pass either", async () => {
    const { h, items } = await setup();
    h.target.setHandler((_request, response) => response.writeHead(302, { location: "http://evil.example.test/steal" }).end());
    const detail = await run(h, items);
    expect(detail.results.map((result: { outcome: string }) => result.outcome)).toEqual(items.map(() => "blocked"));
    expect((await findings(h)).total).toBe(0);
  });

  it("creates none for an errored scenario", async () => {
    const { h, items } = await setup();
    await h.target.stop();
    const detail = await run(h, items);
    expect(detail.results.every((result: { outcome: string }) => result.outcome === "errored")).toBe(true);
    expect((await findings(h)).total).toBe(0);
  });
});

describe("reading findings", () => {
  async function withFindings() {
    const context = await setup({ behavior: { vulnerable: true } });
    await run(context.h, context.items);
    return context;
  }

  it("filters by status, severity, category, operation, scenario and unreviewed occurrences, and counts the filtered set", async () => {
    const { h } = await withFindings();
    const all = await findings(h);
    const first = all.items[0];
    expect((await findings(h, `?status=open`)).total).toBe(all.total);
    expect((await findings(h, `?status=resolved`)).total).toBe(0);
    expect((await findings(h, `?severity=${first.severity.current}`)).total).toBe(all.counts.bySeverity[first.severity.current]);
    expect((await findings(h, `?category=authentication`)).total).toBe(all.total);
    expect((await findings(h, `?category=input-validation`)).total).toBe(0);
    expect((await findings(h, `?operation=${encodeURIComponent("GET /orders")}`)).total).toBe(all.total);
    expect((await findings(h, `?scenario=${first.scenarioId}`)).total).toBe(1);
    expect((await findings(h, `?unreviewed=true`)).total).toBe(0);
    expect((await findings(h, `?unreviewed=false`)).total).toBe(all.total);
  });

  it("pages the list", async () => {
    const { h } = await withFindings();
    const all = await findings(h);
    expect(all.total).toBeGreaterThan(1);
    const one = await findings(h, "?pageSize=1&page=2");
    expect(one.items).toHaveLength(1);
    expect(one.items[0].id).not.toBe((await findings(h, "?pageSize=1&page=1")).items[0].id);
    expect(one.total).toBe(all.total);
  });

  it.each([["severity=urgent"], ["status=done"], ["unreviewed=maybe"], ["page=0"], ["pageSize=101"], ["pageSize=x"]])("refuses ?%s with invalid_request", async (query) => {
    const { h } = await withFindings();
    const res = await h.agent.get(`${BASE}/findings?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns one finding, and 404 for an unknown one", async () => {
    const { h } = await withFindings();
    const [first] = (await findings(h)).items;
    const one = await h.agent.get(`${BASE}/findings/${first.id}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(first.id);
    const missing = await h.agent.get(`${BASE}/findings/sf-0000000000000000`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("finding_not_found");
  });

  it("serves the redacted evidence of an occurrence, and refuses a result that is not one of its occurrences", async () => {
    const { h } = await withFindings();
    const [first] = (await findings(h)).items;
    const resultId = first.occurrences[0].resultId;
    const evidence = await h.agent.get(`${BASE}/findings/${first.id}/occurrences/${resultId}/evidence`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.available).toBe(true);
    expect(evidence.body.records[0]).toMatchObject({ method: "GET", responseStatus: 200 });
    expect(evidence.text).not.toContain(ALICE_TOKEN);
    const foreign = await h.agent.get(`${BASE}/findings/${first.id}/occurrences/not-a-result/evidence`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("finding_not_found");
  });

  it("keeps each browser's findings apart", async () => {
    const { h } = await withFindings();
    const other = request.agent(h.app);
    expect((await other.get(`${BASE}/findings`)).body.total).toBe(0);
    const [first] = (await findings(h)).items;
    expect((await other.get(`${BASE}/findings/${first.id}`)).status).toBe(404);
    expect((await other.patch(`${BASE}/findings/${first.id}`).send({ status: "resolved", note: "x" })).status).toBe(404);
  });
});

describe("findings survive the session and the specification (FR-051)", () => {
  it("stay readable with their observed summaries after the session expires, and report the raw evidence as no longer available", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await run(h, items);
    const listed = await findings(h);
    const [before] = listed.items;
    const resultId = before.occurrences[0].resultId;

    forceExpireForTest(h.sessionId);
    resetStore();

    const after = await h.agent.get(`${BASE}/findings/${before.id}`);
    expect(after.status).toBe(200);
    expect(after.body.occurrences[0]).toMatchObject({ evidenceAvailable: false, observed: before.occurrences[0].observed });
    expect(after.body.remediation).toBe(before.remediation);
    const evidence = await h.agent.get(`${BASE}/findings/${before.id}/occurrences/${resultId}/evidence`);
    expect(evidence.status).toBe(200);
    expect(evidence.body).toEqual({ available: false, records: [] });
    expect((await findings(h)).total).toBe(listed.total);
  });
});

describe("PATCH /findings/:id", () => {
  async function one() {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await run(h, items);
    const [finding] = (await findings(h)).items;
    return { h, items, finding };
  }

  it("changes the status with a note and records it in the history", async () => {
    const { h, finding } = await one();
    const res = await h.agent.patch(`${BASE}/findings/${finding.id}`).send({ status: "accepted-risk", note: "Public data only" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "accepted-risk" });
    expect(res.body.history).toEqual([expect.objectContaining({ field: "status", from: "open", to: "accepted-risk", note: "Public data only" })]);
    expect(res.body.occurrences[0].evidenceAvailable).toBe(true);
  });

  it("changes the current severity, and leaves the suggested one", async () => {
    const { h, finding } = await one();
    const res = await h.agent.patch(`${BASE}/findings/${finding.id}`).send({ severity: "critical", note: "Holds PII" });
    expect(res.body.severity).toEqual({ suggested: finding.severity.suggested, current: "critical" });
  });

  it.each([
    [{ status: "resolved" }],
    [{ status: "bogus", note: "n" }],
    [{}],
    [{ scenarioId: "ss-x" }],
    [{ acknowledgeOccurrences: true }],
    [{ status: "open", note: "same" }],
  ])("refuses %j with 422 invalid_finding_update", async (body) => {
    const { h, finding } = await one();
    const res = await h.agent.patch(`${BASE}/findings/${finding.id}`).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_finding_update");
  });

  it("keeps an accepted risk accepted when it fails again, flags the new occurrence, and clears the flag on acknowledgement", async () => {
    const { h, items, finding } = await one();
    await h.agent.patch(`${BASE}/findings/${finding.id}`).send({ status: "accepted-risk", note: "Known" });
    await run(h, items);
    const flagged = (await h.agent.get(`${BASE}/findings/${finding.id}`)).body;
    expect(flagged).toMatchObject({ status: "accepted-risk", unreviewedOccurrence: true, occurrenceCount: 2 });
    expect((await findings(h, "?unreviewed=true")).total).toBeGreaterThan(0);
    const cleared = await h.agent.patch(`${BASE}/findings/${finding.id}`).send({ acknowledgeOccurrences: true });
    expect(cleared.body.unreviewedOccurrence).toBe(false);
    expect(cleared.body.status).toBe("accepted-risk");
  });

  it("reopens a resolved finding when its version fails again", async () => {
    const { h, items, finding } = await one();
    await h.agent.patch(`${BASE}/findings/${finding.id}`).send({ status: "resolved", note: "Patched" });
    await run(h, items);
    const reopened = (await h.agent.get(`${BASE}/findings/${finding.id}`)).body;
    expect(reopened).toMatchObject({ status: "open", occurrenceCount: 2 });
    expect(reopened.history.at(-1)).toMatchObject({ from: "resolved", to: "open", actor: "system" });
  });

  it("verifies a resolved finding by a later passing run of the same version", async () => {
    const { h, items, finding } = await one();
    await h.agent.patch(`${BASE}/findings/${finding.id}`).send({ status: "resolved", note: "Patched" });
    // The service is fixed: the same scenario version now passes.
    await h.target.stop();
    const fixed = await startHarnessTargetLike(h);
    expect(fixed).toBeDefined();
    const run2 = await run(h, items);
    expect(run2.results.some((result: { scenarioId: string; outcome: string }) => result.scenarioId === finding.scenarioId && result.outcome === "passed")).toBe(true);
    const verified = (await h.agent.get(`${BASE}/findings/${finding.id}`)).body;
    expect(verified).toMatchObject({ status: "resolved", resolvedAssertion: "verified-by-rerun" });
  });

  it("starts a separate finding that supersedes the first after a material edit", async () => {
    const { h, finding } = await one();
    const edit = await h.agent.patch(`${BASE}/scenarios/${finding.scenarioId}`).send({ expectedVersion: 1, changes: { mutations: [{ kind: "auth.omit" }, { kind: "auth.malformed" }] }, note: "Also malformed" });
    expect(edit.status).toBe(200);
    expect(edit.body.material).toBe(true);
    const target = [{ id: finding.scenarioId, version: edit.body.version }];
    await approve(h, target);
    await run(h, target);
    const all = (await findings(h, `?scenario=${finding.scenarioId}`)).items;
    expect(all).toHaveLength(2);
    const newer = all.find((entry: { scenarioVersion: number }) => entry.scenarioVersion === 2);
    expect(newer.supersedes).toBe(finding.id);
    expect(getSecurityFindingRepository().get(h.ownerId, finding.id)?.occurrenceCount).toBe(1);
  });
});

/** Replaces the target's behavior with a secure one on the same port: the "fix" a later run should see. */
async function startHarnessTargetLike(h: Harness): Promise<boolean> {
  const { sampleHandler } = await import("../../fixtures/securityLab/sampleTargets");
  h.target.setHandler(sampleHandler());
  await h.target.start(undefined, h.target.portNumber);
  return true;
}
