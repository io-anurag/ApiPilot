import express, { Router, type Request, type Response } from "express";
import { USER_SCRIPT_MAX_BYTES } from "@apipilot/shared-domain";
import { getEnvironment } from "../execution/environmentStore";
import {
  InvalidMappingNameError,
  InvalidUserScriptSettingsError,
  LoadOverrideUnavailableError,
  PerformanceRunNotFoundError,
  UserScriptChangedError,
  UserScriptNotConfirmedError,
  UserScriptNotFoundError,
  UserScriptRefusedError,
  UserScriptRunInProgressError,
} from "../performance/errors";
import { getUserScriptLiveSnapshot, parseLiveCursor } from "../performance/live/liveRunService";
import { renderUserScriptReport } from "../performance/report/renderUserScriptReport";
import { cancelLiveRun } from "../performance/runPerformanceTest";
import { EXAMPLE_SCRIPT } from "../performance/userScript/exampleScript";
import { parseSettings } from "../performance/userScript/settings";
import { ExecutionSlotTakenError, K6NotReadyError, startUserScriptRun, type UserScriptRunDependencies } from "../performance/userScript/startUserScriptRun";
import { getUserScriptRun, listUserScriptRuns, requestUserScriptCancel } from "../performance/userScript/userScriptRunStore";
import {
  confirmUserScript,
  createUserScript,
  deleteUserScript,
  getUserScript,
  listUserScripts,
  normalizeScriptName,
  readUserScriptContent,
  renameUserScript,
  replaceUserScriptContent,
  saveUserScriptSettings,
} from "../performance/userScript/userScriptStore";
import { getSessionId } from "../session/sessionContext";
import { reaffirmSession } from "../session/sessionMiddleware";
import { fail, handleKnownError, logReceived, logSucceeded } from "./performanceHttp";

/**
 * AP-034 Run k6 Script (specs/034-run-user-k6-script contracts/user-scripts-api.md). A standalone
 * route family, like Import & Run and the quick performance test: no specification, guided
 * workflow or plan is needed. Routes stay thin over `performance/userScript/`. A run starts only on
 * `POST /api/user-scripts/:id/runs`, the engineer's explicit trigger (constitution XVII exception of
 * 2026-09-30); no other route runs anything. No response carries an environment value, k6's
 * console output or a raw URL, and only the two content routes carry the script.
 */
const BASE = "/user-scripts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rawBody = express.raw({ type: "application/octet-stream", limit: USER_SCRIPT_MAX_BYTES });

function handleError(req: Request, res: Response, startedAt: number, err: unknown): void {
  if (err instanceof UserScriptNotFoundError) return fail(req, res, startedAt, 404, "script_not_found", err.message);
  if (err instanceof UserScriptRefusedError) return fail(req, res, startedAt, 422, "script_refused", err.message, { problems: err.problems });
  if (err instanceof UserScriptChangedError) return fail(req, res, startedAt, 409, "script_changed", err.message);
  if (err instanceof UserScriptNotConfirmedError) return fail(req, res, startedAt, 409, "script_not_confirmed", err.message);
  if (err instanceof UserScriptRunInProgressError) return fail(req, res, startedAt, 409, "run_in_progress", err.message, { runId: err.runId });
  if (err instanceof LoadOverrideUnavailableError) return fail(req, res, startedAt, 409, "load_override_unavailable", err.message);
  if (err instanceof K6NotReadyError) return fail(req, res, startedAt, 409, "k6_unavailable", err.message, { readiness: err.readiness });
  if (err instanceof ExecutionSlotTakenError) return fail(req, res, startedAt, 409, "execution_in_progress", err.message, { runId: err.runId });
  if (err instanceof InvalidMappingNameError) return fail(req, res, startedAt, 400, "invalid_mapping_name", err.message, { name: err.mappingName, reason: err.reason });
  if (err instanceof InvalidUserScriptSettingsError) return fail(req, res, startedAt, 400, "invalid_settings", err.message);
  handleKnownError(req, res, startedAt, err);
}

/** Wraps a handler: request logging, the shared error mapping, and anything unknown to the central handler. */
function route(handler: (req: Request, res: Response, startedAt: number) => void | Promise<void>) {
  return async (req: Request, res: Response, next: (err?: unknown) => void) => {
    const startedAt = logReceived(req);
    try {
      await handler(req, res, startedAt);
    } catch (err) {
      try {
        handleError(req, res, startedAt, err);
      } catch (unknown) {
        next(unknown);
      }
    }
  };
}

function requireUuid(value: string, kind: "script" | "run"): void {
  if (!UUID.test(value)) throw kind === "script" ? new UserScriptNotFoundError(value) : new PerformanceRunNotFoundError(value);
}

/** The bytes of an editor save (JSON `content`), as UTF-8. `null` means too large. */
function jsonContent(req: Request): Buffer | null | undefined {
  const content = (req.body as Record<string, unknown> | undefined)?.content;
  if (typeof content !== "string") return undefined;
  const bytes = Buffer.from(content, "utf-8");
  return bytes.length > USER_SCRIPT_MAX_BYTES ? null : bytes;
}

function tooLarge(req: Request, res: Response, startedAt: number): void {
  fail(req, res, startedAt, 413, "payload_too_large", `Request body exceeds the maximum allowed size of ${USER_SCRIPT_MAX_BYTES} bytes`);
}

/** `Content-Disposition` file name: the script's name reduced to safe characters. */
function downloadName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${safe === "" ? "script" : safe}.js`;
}

export function createUserScriptsRouter(deps: UserScriptRunDependencies): Router {
  const router = Router();

  // ── Fixed paths, before `/:id` ───────────────────────────────────────────────────────────────

  router.get(
    BASE,
    route((req, res, startedAt) => {
      res.status(200).json({ scripts: listUserScripts() });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/upload`,
    rawBody,
    reaffirmSession,
    route((req, res, startedAt) => {
      if (!req.is("application/octet-stream") || !Buffer.isBuffer(req.body)) {
        return fail(req, res, startedAt, 415, "unsupported_media_type", "Send the script file as application/octet-stream.");
      }
      const script = createUserScript(normalizeScriptName(req.query.name, "Uploaded script"), req.body);
      res.status(201).json({ script });
      logSucceeded(req, startedAt, 201);
    }),
  );

  router.post(
    BASE,
    route((req, res, startedAt) => {
      const bytes = jsonContent(req);
      if (bytes === null) return tooLarge(req, res, startedAt);
      if (bytes === undefined) return fail(req, res, startedAt, 400, "invalid_request", "Send the script as { name, content }.");
      const script = createUserScript(normalizeScriptName((req.body as Record<string, unknown>).name, "New script"), bytes);
      res.status(201).json({ script });
      logSucceeded(req, startedAt, 201);
    }),
  );

  router.get(
    `${BASE}/example`,
    route((req, res, startedAt) => {
      res.status(200).type("text/plain; charset=utf-8").send(EXAMPLE_SCRIPT);
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/readiness`,
    route(async (req, res, startedAt) => {
      const { readiness } = await deps.probe({ recheck: req.query.recheck === "true" });
      res.status(200).json({ readiness });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/runs`,
    route((req, res, startedAt) => {
      const scriptId = typeof req.query.scriptId === "string" ? req.query.scriptId : undefined;
      res.status(200).json({ runs: listUserScriptRuns(scriptId) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/runs/:runId`,
    route((req, res, startedAt) => {
      requireUuid(req.params.runId, "run");
      res.status(200).json({ run: getUserScriptRun(req.params.runId) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  // AP-045: the live dashboard's read-only snapshot, answered from memory while the run is live.
  router.get(
    `${BASE}/runs/:runId/live`,
    route((req, res, startedAt) => {
      requireUuid(req.params.runId, "run");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(getUserScriptLiveSnapshot(getSessionId(), req.params.runId, deps.now().getTime(), parseLiveCursor(req.query)));
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/runs/:runId/cancel`,
    route((req, res, startedAt) => {
      requireUuid(req.params.runId, "run");
      const run = getUserScriptRun(req.params.runId);
      if (run.status !== "in-progress") return fail(req, res, startedAt, 409, "run_not_in_progress", "This run has already ended.");
      const updated = requestUserScriptCancel(run.id);
      cancelLiveRun(run.id);
      res.status(202).json({ run: updated });
      logSucceeded(req, startedAt, 202);
    }),
  );

  router.get(
    `${BASE}/runs/:runId/report`,
    route((req, res, startedAt) => {
      requireUuid(req.params.runId, "run");
      const run = getUserScriptRun(req.params.runId);
      if (run.status === "in-progress") return fail(req, res, startedAt, 409, "run_in_progress", "The report is available once the run has ended.");
      if (req.query.download === "true") res.setHeader("Content-Disposition", `attachment; filename="apipilot-k6-script-${run.id}.html"`);
      res.status(200).type("text/html; charset=utf-8").send(renderUserScriptReport(run));
      logSucceeded(req, startedAt, 200);
    }),
  );

  // ── One script ────────────────────────────────────────────────────────────────────────────

  router.get(
    `${BASE}/:id`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      res.status(200).json({ script: getUserScript(req.params.id) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/:id/content`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      const { content } = readUserScriptContent(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).type("text/plain; charset=utf-8").send(content);
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/:id/download`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      const { name, content } = readUserScriptContent(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="${downloadName(name)}"`);
      res.status(200).type("application/javascript").send(content);
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.put(
    `${BASE}/:id/content`,
    rawBody,
    reaffirmSession,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      let bytes: Buffer;
      let baseSha256: unknown;
      if (req.is("application/octet-stream") && Buffer.isBuffer(req.body)) {
        bytes = req.body;
        baseSha256 = req.query.baseSha256;
      } else if (req.is("application/json")) {
        const content = jsonContent(req);
        if (content === null) return tooLarge(req, res, startedAt);
        if (content === undefined) return fail(req, res, startedAt, 400, "invalid_request", "Send { content, baseSha256 }.");
        bytes = content;
        baseSha256 = (req.body as Record<string, unknown>).baseSha256;
      } else {
        return fail(req, res, startedAt, 415, "unsupported_media_type", "Send JSON from the editor, or the file as application/octet-stream.");
      }
      res.status(200).json({ script: replaceUserScriptContent(req.params.id, bytes, baseSha256) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.patch(
    `${BASE}/:id`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      const name = (req.body as Record<string, unknown> | undefined)?.name;
      if (typeof name !== "string" || name.trim() === "") return fail(req, res, startedAt, 400, "invalid_request", "Send { name } with a name that is not empty.");
      res.status(200).json({ script: renameUserScript(req.params.id, normalizeScriptName(name, "Script")) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.delete(
    `${BASE}/:id`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      deleteUserScript(req.params.id);
      res.status(204).end();
      logSucceeded(req, startedAt, 204);
    }),
  );

  router.post(
    `${BASE}/:id/confirmation`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      res.status(200).json({ script: confirmUserScript(req.params.id, (req.body as Record<string, unknown> | undefined)?.sha256) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.put(
    `${BASE}/:id/settings`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      res.status(200).json({ script: saveUserScriptSettings(req.params.id, parseSettings(req.body)) });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.get(
    `${BASE}/:id/values`,
    route((req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      const script = getUserScript(req.params.id);
      const environment = getEnvironment(typeof req.query.environmentId === "string" ? req.query.environmentId : "");
      const values = script.settings.mapping.map((entry) => {
        const value = entry.source.kind === "base-url" ? environment.baseUrl : environment.variableValues[entry.source.valueName];
        return { name: entry.name, source: entry.source, present: value !== undefined && value !== "" };
      });
      res.status(200).json({ values, baseUrl: environment.baseUrl });
      logSucceeded(req, startedAt, 200);
    }),
  );

  router.post(
    `${BASE}/:id/runs`,
    route(async (req, res, startedAt) => {
      requireUuid(req.params.id, "script");
      const run = await startUserScriptRun(req.params.id, (req.body ?? {}) as Record<string, unknown>, deps);
      res.status(200).json({ run });
      logSucceeded(req, startedAt, 200);
    }),
  );

  return router;
}
