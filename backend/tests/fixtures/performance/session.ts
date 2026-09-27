import type { Response } from "supertest";
import type TestAgent from "supertest/lib/agent";

/**
 * Reads the session id `sessionMiddleware` issued to a supertest agent, so a test can seed
 * session-owned rows (for example a performance run in progress) through a repository directly.
 * The agent must not have been issued a cookie yet.
 */
export async function establishSession(agent: TestAgent): Promise<string> {
  const response: Response = await agent.get("/api/health");
  const header = response.headers["set-cookie"] as unknown as string[] | string | undefined;
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  for (const cookie of cookies) {
    const match = /^sessionId=([^;]+)/.exec(cookie);
    if (match) return decodeURIComponent(match[1]);
  }
  throw new Error("The agent was not issued a sessionId cookie.");
}
