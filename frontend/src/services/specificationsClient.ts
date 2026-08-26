import type { ApiModel } from "@apipilot/shared-domain";

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
      return {
        ok: false,
        error: (body?.error as string) ?? "unknown_error",
        message: (body?.message as string) ?? `Upload failed with status ${response.status}`,
      };
    }
    return { ok: true, apiModel: body.apiModel as ApiModel };
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Upload failed",
    };
  }
}
