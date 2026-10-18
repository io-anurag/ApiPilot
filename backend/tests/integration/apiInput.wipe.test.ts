import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/**
 * specs/056 FR-049, US5 scenario 6: the raw uploaded bytes are overwritten once analysis has finished
 * or failed, on both upload routes. `wipeUpload` is wrapped so the test can see the very buffer the
 * route handled and check that it was zeroed.
 */

const wiped: Buffer[] = [];

vi.mock("../../src/apiInput/wipeUpload", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/apiInput/wipeUpload")>();
  return {
    ...original,
    wipeUpload: (file: { buffer?: Buffer } | undefined) => {
      if (file?.buffer) wiped.push(file.buffer);
      original.wipeUpload(file);
    },
  };
});

const { createApp } = await import("../../src/app");
const validYaml = readFileSync(path.join(__dirname, "..", "fixtures", "openapi", "valid.yaml"));

describe("the raw upload is erased after analysis (FR-049)", () => {
  it.each(["/api/specifications", "/api/test-generation-workflow"])("%s zeroes the buffer after a successful analysis", async (route) => {
    wiped.length = 0;
    const response = await request(createApp()).post(route).attach("file", validYaml, "valid.yaml");
    expect(response.status).toBe(200);
    expect(wiped).toHaveLength(1);
    expect(wiped[0].length).toBeGreaterThan(0);
    expect(wiped[0].every((byte) => byte === 0)).toBe(true);
  });

  it.each(["/api/specifications", "/api/test-generation-workflow"])("%s zeroes the buffer after a rejected upload too", async (route) => {
    wiped.length = 0;
    const response = await request(createApp())
      .post(route)
      .attach("file", Buffer.from('{"hello": "SEEDED-SECRET-REJECTED"}'), "thing.json");
    expect(response.status).toBe(400);
    expect(wiped).toHaveLength(1);
    expect(wiped[0].every((byte) => byte === 0)).toBe(true);
  });
});
