import { randomUUID } from "node:crypto";
import { beforeEach } from "vitest";
import { enterTestSession } from "../../src/session/sessionContext";

/**
 * Global setup (specs/017-session-workflow-isolation): gives every test a session context
 * automatically, so the many existing unit tests that call `workflowStore.ts` or a stage module
 * directly (with no HTTP request in the picture) keep working unmodified — each test gets its
 * own fresh, isolated session id, exactly as a real request would via `sessionMiddleware`.
 * Integration tests that make real `supertest` requests are unaffected: `sessionMiddleware`
 * establishes its own per-request session for each call, overriding this ambient one.
 */
beforeEach(() => {
  enterTestSession(randomUUID());
});
