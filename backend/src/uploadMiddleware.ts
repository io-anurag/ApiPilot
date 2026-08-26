import multer from "multer";

/** Default maximum upload size for OpenAPI spec files (FR-015): ~10 MB, enforced before parsing. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Memory-only storage: uploaded content never touches disk (research.md decision 3). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});
