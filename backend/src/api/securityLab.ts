import { Router, type NextFunction, type Request, type Response } from "express";
import { createLogger } from "../logger";
import { isSecurityLabError } from "../securityLab/errors";
import { ownerMiddleware } from "../securityLab/owner/ownerMiddleware";
import {
  createSecurityLabService,
  type SecurityLabDependencies,
  type SecurityLabService,
} from "../securityLab/securityLabService";

const logger = createLogger("api.securityLab");

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

/**
 * Thin Security Lab router (specs/057 contracts/security-lab-api.md, CLAUDE.md section 22): it validates and
 * adapts input, calls the service, and maps typed errors. It holds no domain logic. Every route sits behind
 * the owner middleware, which is mounted here and nowhere else, so the `apipilotOwner` cookie is only ever set
 * by a Security Lab response. Logs carry ids, status codes and error categories only (constitution XX).
 */
export function createSecurityLabRouter(service: SecurityLabService = createSecurityLabService()): Router {
  const router = Router();
  router.use("/security-lab", ownerMiddleware);

  /** Wraps a handler: request logging, typed-error mapping, and delegation of anything unexpected to the central handler. */
  const handle =
    (handler: Handler) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const startedAt = Date.now();
      logger.info("request_received", { method: req.method, path: req.path });
      try {
        const body = await handler(req, res);
        // A handler may set 201 before returning its body, or end the response itself for a 204; otherwise this is a 200.
        if (!res.headersSent) res.set("Cache-Control", "no-store").json(body);
        logger.info("request_succeeded", {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        if (isSecurityLabError(err)) {
          logger.error("request_failed", {
            method: req.method,
            path: req.path,
            statusCode: err.statusCode,
            errorCategory: err.code,
            durationMs: Date.now() - startedAt,
          });
          res.status(err.statusCode).json(err.toBody());
          return;
        }
        next(err);
      }
    };

  router.get(
    "/security-lab/categories",
    handle(() => service.getCategories()),
  );

  router.get(
    "/security-lab/analysis",
    handle(() => service.getAnalysis()),
  );
  router.get(
    "/security-lab/settings",
    handle(() => service.getSettings()),
  );
  router.put(
    "/security-lab/settings",
    handle((req) => service.putSettings(req.body)),
  );
  router.get(
    "/security-lab/scope",
    handle(() => service.getScope()),
  );
  router.post(
    "/security-lab/scenarios/generate",
    handle((req) => service.generate(req.body)),
  );
  router.get(
    "/security-lab/scenarios/ids",
    handle((req) => service.listScenarioIds(req.query)),
  );
  router.get(
    "/security-lab/scenarios",
    handle((req) => service.listScenarios(req.query)),
  );
  router.post(
    "/security-lab/scenarios/review",
    handle((req) => service.review(req.body)),
  );
  router.get(
    "/security-lab/scenarios/:id",
    handle((req) => service.getScenario(req.params.id, req.query)),
  );
  router.patch(
    "/security-lab/scenarios/:id",
    handle((req) => service.editScenario(req.params.id, req.body)),
  );
  router.get(
    "/security-lab/profiles",
    handle(() => service.listProfiles()),
  );
  router.post(
    "/security-lab/profiles",
    handle((req, res) => {
      const created = service.createProfile(req.body);
      res.status(201);
      return created;
    }),
  );
  router.put(
    "/security-lab/profiles/:id",
    handle((req) => service.updateProfile(req.params.id, req.body)),
  );
  router.delete(
    "/security-lab/profiles/:id",
    handle((req, res) => {
      service.deleteProfile(req.params.id);
      res.status(204).end();
    }),
  );
  router.post(
    "/security-lab/profiles/:id/check",
    handle((req) => service.checkProfile(req.params.id)),
  );
  router.put(
    "/security-lab/profiles/:id/credentials",
    handle((req, res) => {
      service.putCredential(req.params.id, req.body);
      res.status(204).end();
    }),
  );
  router.get(
    "/security-lab/profiles/:id/credentials",
    handle((req) => service.getCredentials(req.params.id)),
  );
  router.get(
    "/security-lab/environments",
    handle(() => service.listEnvironments()),
  );
  router.post(
    "/security-lab/environments",
    handle((req) => service.createEnvironment(req.body)),
  );
  router.put(
    "/security-lab/environments/:environmentId",
    handle((req) => service.updateEnvironment(req.params.environmentId, req.body)),
  );

  return router;
}

export type { SecurityLabDependencies };

export const securityLabRouter = createSecurityLabRouter();
