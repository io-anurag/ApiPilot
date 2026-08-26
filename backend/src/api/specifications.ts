import { Router } from "express";
import { buildApiModel } from "../openapi/buildApiModel";
import { parseYaml } from "../openapi/parseYaml";
import { validateSpec } from "../openapi/validateSpec";
import { upload } from "../uploadMiddleware";

export const specificationsRouter = Router();

specificationsRouter
  .route("/specifications")
  .post(upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) {
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
    } catch (err) {
      next(err);
    }
  })
  .all((_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
