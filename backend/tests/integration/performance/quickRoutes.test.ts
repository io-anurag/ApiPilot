import { beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { MAX_UPLOAD_BYTES } from "../../../src/uploadMiddleware";
import { QUICK_BASE, quickAgent, uploadQuick } from "../../fixtures/performance/quickAgent";
import { openApiFixtureBuffer } from "../../fixtures/performance/specification";

/**
 * AP-032 contracts/quick-performance-api.md (FR-001, FR-002, FR-021; tasks T020). Since AP-037 phase two
 * the quick test is a seeding source only: its upload and status remain (specs/037-request-chain-performance FR-036).
 */

const EMPTY_SPECIFICATION = Buffer.from('openapi: 3.0.3\ninfo:\n  title: Empty\n  version: "1"\npaths: {}\n');

describe("quick performance test routes", () => {
  beforeEach(() => resetStore());

  it("stores an uploaded specification for seeding, with no plan and no script", async () => {
    const { agent } = await quickAgent();
    const created = await uploadQuick(agent);
    expect(created.status).toBe(200);
    const { quickTest } = created.body;
    expect(quickTest).toEqual({ specification: { filename: "quick-performance.yaml", operationCount: 13, info: { title: "Quick Performance Fixture", version: expect.any(String) }, operations: expect.any(Array) } });
    expect(quickTest.specification.operations).toHaveLength(13);
    expect(quickTest.specification.operations[0]).toMatchObject({ method: expect.stringMatching(/^[A-Z]+$/), path: expect.stringMatching(/^\//), parameters: expect.any(Array), hasRequestBody: expect.any(Boolean), expectedStatuses: expect.any(Array) });
    const read = await agent.get(QUICK_BASE);
    expect(read.status).toBe(200);
    expect(read.body.quickTest).toEqual(quickTest);
  });

  it("gives the guided upload's error for the same bad input, and stores nothing (FR-002, US1 AS5)", async () => {
    const guided = await quickAgent();
    const { agent } = await quickAgent();
    const cases: { buffer?: Buffer; filename: string }[] = [
      { buffer: openApiFixtureBuffer("invalid-yaml.txt"), filename: "invalid-yaml.txt" },
      { buffer: openApiFixtureBuffer("unsupported-version.yaml"), filename: "unsupported-version.yaml" },
    ];
    for (const input of cases) {
      const quick = await uploadQuick(agent, input);
      const reference = await guided.agent.post("/api/test-generation-workflow").attach("file", input.buffer!, input.filename);
      expect(quick.status).toBe(reference.status);
      expect(quick.body).toEqual(reference.body);
      expect((await agent.get(QUICK_BASE)).status).toBe(404);
    }

    const noFile = await agent.post(QUICK_BASE);
    const noFileReference = await guided.agent.post("/api/test-generation-workflow");
    expect(noFile.status).toBe(400);
    expect(noFile.body).toEqual(noFileReference.body);

    const tooLarge = await uploadQuick(agent, { buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x20), filename: "big.yaml" });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error).toBe("file_too_large");
    const missing = await agent.get(QUICK_BASE);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("quick_test_not_found");
  });

  it("asks before replacing a quick test, and replaces it when told to (FR-021)", async () => {
    const { agent } = await quickAgent();
    await uploadQuick(agent);
    const refused = await uploadQuick(agent, { buffer: EMPTY_SPECIFICATION, filename: "empty.yaml" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("quick_test_exists");
    expect((await agent.get(QUICK_BASE)).body.quickTest.specification.filename).toBe("quick-performance.yaml");

    const replaced = await uploadQuick(agent, { buffer: EMPTY_SPECIFICATION, filename: "empty.yaml", replaceExisting: true });
    expect(replaced.status).toBe(200);
    expect(replaced.body.quickTest.specification.filename).toBe("empty.yaml");
  });
});
