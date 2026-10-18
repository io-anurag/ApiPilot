import { Router } from "express";
import { loadApiInput } from "../apiInput";
import { wipeUpload } from "../apiInput/wipeUpload";
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
      const { apiModel, input } = await loadApiInput(req.file.buffer, req.file.originalname);
      res.status(200).json({ apiModel, input });
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
    } finally {
      // The raw upload is not retained once analysis has finished or failed (specs/056 FR-049).
      wipeUpload(req.file);
    }
  })
  .all((_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
