import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { MAX_UPLOAD_BYTES } from "../../src/uploadMiddleware";
import { harEntry, harOf, jsonEntry, manyEntries } from "../fixtures/apiInput/harBuilders";

/**
 * specs/056 FR-045, SC-009: documented limits refuse or truncate input with a message naming the
 * limit, and other sessions keep being served. Cases that need the HAR pipeline are added with it.
 */

const WORKFLOW = "/api/test-generation-workflow";

describe("input limits", () => {
  it("keeps the existing upload size limit (not raised by this feature)", async () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    const response = await request(createApp())
      .post(WORKFLOW)
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1, "a"), "huge.har");
    expect(response.status).toBe(413);
    expect(response.body.error).toBe("file_too_large");
  });

  it("refuses JSON nested past the document depth limit and names it", async () => {
    const deep = Buffer.from("[".repeat(1000) + "]".repeat(1000));
    const response = await request(createApp()).post(WORKFLOW).attach("file", deep, "deep.json");
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: "input_limit_exceeded", limit: "INPUT_MAX_JSON_DEPTH", maximum: 128 });
    expect(response.body.message).toContain("INPUT_MAX_JSON_DEPTH");
  });

  it("accepts nesting exactly at the limit before judging the format", async () => {
    const atLimit = Buffer.from("[".repeat(128) + "]".repeat(128));
    const response = await request(createApp()).post(WORKFLOW).attach("file", atLimit, "limit.json");
    // Not refused for depth: it is then an array, so it is simply not a recognized format.
    expect(response.body.error).toBe("unrecognized_input_format");
  });

  it("keeps serving another session while a large file is analyzed", async () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 1500; i += 1) {
      paths[`/resource${i}/{id}`] = {
        get: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } },
        },
      };
    }
    const large = Buffer.from(JSON.stringify({ openapi: "3.0.3", info: { title: "Large", version: "1" }, paths }));
    const app = createApp();
    const owner = request.agent(app);
    const other = request.agent(app);
    const startedAt = Date.now();
    const [uploaded, otherSession] = await Promise.all([
      owner.post(WORKFLOW).attach("file", large, "large.json"),
      other.get(WORKFLOW),
    ]);
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.workflow.apiModel.summary.operationCount).toBe(1500);
    expect(otherSession.status).toBe(204);
    expect(Date.now() - startedAt).toBeLessThan(30_000);
  });
});

describe("HAR limits (FR-045, SC-007, SC-009)", () => {
  const stamp = (entries: Record<string, unknown>[]) => Buffer.from(JSON.stringify(harOf(entries)));

  it("refuses a capture with more entries than the limit and names it", async () => {
    const response = await request(createApp()).post(WORKFLOW).attach("file", stamp(manyEntries(5001)), "huge.har");
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: "input_limit_exceeded", limit: "INPUT_HAR_MAX_ENTRIES", maximum: 5000 });
    expect(response.body.message).toContain("narrower session");
  });

  it("skips an oversized body, reports it and still imports the capture", async () => {
    const blob = JSON.stringify({ blob: "x".repeat(1_100_000) });
    const entries = [
      harEntry({ method: "POST", url: "https://api.shop.test/v1/big", requestBody: { mimeType: "application/json", text: blob }, responseText: "{}" }),
      ...manyEntries(3),
    ];
    const response = await request(createApp()).post(WORKFLOW).attach("file", stamp(entries), "big.har");
    expect(response.status).toBe(200);
    const report = response.body.workflow.apiModel.importReport;
    expect(report.limitsApplied).toEqual([{ limit: "INPUT_MAX_BODY_BYTES", effect: "body skipped and reported", count: 1 }]);
  });

  it("refuses a capture that would produce more operations than the limit", async () => {
    const letters = (i: number) => String.fromCharCode(97 + (Math.floor(i / 676) % 26), 97 + (Math.floor(i / 26) % 26), 97 + (i % 26));
    const entries = Array.from({ length: 2001 }, (_, i) => jsonEntry("GET", `https://api.shop.test/v1/${letters(i)}x`, 200, {}));
    const response = await request(createApp()).post(WORKFLOW).attach("file", stamp(entries), "wide.har");
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: "input_limit_exceeded", limit: "derived-operations", maximum: 2000 });
  });

  it("turns a 500-entry capture into a reviewable operation list well inside the 30 second target (SC-007)", async () => {
    const startedAt = Date.now();
    const response = await request(createApp()).post(WORKFLOW).attach("file", stamp(manyEntries(500)), "typical.har");
    expect(response.status).toBe(200);
    expect(response.body.workflow.apiModel.importReport.counts.total).toBe(500);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it("keeps serving another session while a 5,000-entry capture is analyzed (SC-009)", async () => {
    const app = createApp();
    const owner = request.agent(app);
    const other = request.agent(app);
    const [uploaded, otherSession] = await Promise.all([
      owner.post(WORKFLOW).attach("file", stamp(manyEntries(5000)), "max.har"),
      other.get(WORKFLOW),
    ]);
    expect(uploaded.status).toBe(200);
    expect(otherSession.status).toBe(204);
  });
});
