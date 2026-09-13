import type { ApiModel } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("specificationsClient");

export type UploadResult =
  | { ok: true; apiModel: ApiModel }
  | { ok: false; error: string; message: string };

export async function uploadSpecification(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/specifications", {
      method: "POST",
      body: formData,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const errorCategory = (body?.error as string) ?? "unknown_error";
      logger.error("upload_failed", {
        operation: "uploadSpecification",
        errorCategory,
        statusCode: response.status,
      });
      return {
        ok: false,
        error: errorCategory,
        message: (body?.message as string) ?? `Upload failed with status ${response.status}`,
      };
    }
    return { ok: true, apiModel: body.apiModel as ApiModel };
  } catch (err) {
    logger.error("network_error", { operation: "uploadSpecification", errorCategory: "network_error" });
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Upload failed",
    };
  }
}
