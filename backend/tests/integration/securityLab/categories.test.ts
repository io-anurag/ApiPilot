import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function setCookies(res: request.Response): string[] {
  const header = res.headers["set-cookie"] as unknown;
  return Array.isArray(header) ? (header as string[]) : header ? [String(header)] : [];
}

describe("GET /api/security-lab/categories", () => {
  it("returns the registry with its taxonomy edition", async () => {
    const res = await request(createApp()).get("/api/security-lab/categories");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.edition).toBe("owasp-api-top10-2023");
    expect(res.body.taxonomy).toHaveLength(10);
    expect(res.body.categories).toHaveLength(11);
    const byId = Object.fromEntries((res.body.categories as Array<{ id: string }>).map((c) => [c.id, c]));
    expect(byId["input-validation"].taxonomy[0]).toMatchObject({ id: "API8", relation: "related" });
    expect(byId["ssrf-unsafe-consumption"]).toMatchObject({ supportLevel: "limited", executable: false });
    expect(byId["api-inventory"]).toMatchObject({ supportLevel: "analysis-only", executable: false });
  });

  it("issues the owner cookie with the documented attributes, and keeps the same owner on the next request", async () => {
    const agent = request.agent(createApp());
    const first = await agent.get("/api/security-lab/categories");
    const owner = setCookies(first).find((c) => c.startsWith("apipilotOwner="));
    expect(owner).toBeDefined();
    expect(owner).toMatch(/HttpOnly/i);
    expect(owner).toMatch(/SameSite=Lax/i);
    expect(owner).toMatch(/Max-Age=\d+/);
    const value = owner!.split(";")[0].split("=")[1];
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const second = await agent.get("/api/security-lab/categories");
    const reissued = setCookies(second).find((c) => c.startsWith("apipilotOwner="));
    expect(reissued?.split(";")[0]).toBe(`apipilotOwner=${value}`);
  });

  it("keeps the session cookie and the owner cookie independent", async () => {
    const res = await request(createApp()).get("/api/security-lab/categories");
    const names = setCookies(res).map((c) => c.split("=")[0]);
    expect(names).toContain("sessionId");
    expect(names).toContain("apipilotOwner");
    const sessionValue = setCookies(res).find((c) => c.startsWith("sessionId="))?.split(";")[0].split("=")[1];
    const ownerValue = setCookies(res).find((c) => c.startsWith("apipilotOwner="))?.split(";")[0].split("=")[1];
    expect(sessionValue).not.toBe(ownerValue);
  });

  it("never sets the owner cookie from any other route", async () => {
    const app = createApp();
    for (const path of ["/api/health", "/api/version", "/api/coverage"]) {
      const res = await request(app).get(path);
      expect(setCookies(res).some((c) => c.startsWith("apipilotOwner="))).toBe(false);
    }
  });

  it("replaces a malformed owner cookie instead of adopting it", async () => {
    const res = await request(createApp()).get("/api/security-lab/categories").set("Cookie", "apipilotOwner=../../etc/passwd");
    const issued = setCookies(res).find((c) => c.startsWith("apipilotOwner="));
    expect(issued).toBeDefined();
    expect(issued).not.toContain("passwd");
  });
});
