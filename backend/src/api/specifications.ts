import { Router } from "express";
import { buildApiModel } from "../openapi/buildApiModel";
import { parseYaml } from "../openapi/parseYaml";
import { validateSpec } from "../openapi/validateSpec";
import { upload } from "../uploadMiddleware";
import { createLogger } from "../logger";

const logger = createLogger("api.specifications");

export const specificationsRouter = Router();

specificationsRouter
  .route("/specifications")
  .post(upload.single("file"), async (req, res, next) => {
    const startedAt = Date.now();
    logger.info("request_received", { method: req.method, path: req.path });
    try {
      if (!req.file) {
        logger.error("request_failed", {
          method: req.method,
          path: req.path,
          statusCode: 400,
          errorCategory: "invalid_yaml",
          durationMs: Date.now() - startedAt,
        });
        res.status(400).json({
          error: "invalid_yaml",
          message: "No file was uploaded under the 'file' field",
        });
        return;
      }
      const content = req.file.buffer.toString("utf-8");
      const rawDoc = parseYaml(content);
      const { document, issues } = await validateSpec(rawDoc);
      const apiModel = buildApiModel(document, issues);
      res.status(200).json({ apiModel });
      logger.info("request_succeeded", {
        method: req.method,
        path: req.path,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      // Parse/validation errors are logged once, generically, by app.ts's centralized
      // error handler (which receives the same req) rather than duplicated here.
      next(err);
    }
  })
  .all((_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
