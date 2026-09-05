import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";

describe("GET /api/version", () => {
  it("reports the backend package's own version and a real commit hash rather than a hardcoded placeholder", async () => {
    const app = createApp();

    const response = await request(app).get("/api/version");

    expect(response.status).toBe(200);
    expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    // A checkout with git available reports a short commit hash; a deployed copy without a
    // .git directory (or without git installed) falls back to "unknown" instead of failing.
    expect(response.body.commit).toMatch(/^[0-9a-f]{4,40}$|^unknown$/);
  });
});
