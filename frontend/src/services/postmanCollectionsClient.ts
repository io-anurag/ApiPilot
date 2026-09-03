import type { ApiModel, ExportOptions, ExportResult, TestModel } from "@apipilot/shared-domain";

/** The three files one export produces (FR-022). */
export const ARTIFACT_FILENAMES = {
  collection: "collection.json",
  environment: "environment.json",
  readme: "README.md",
} as const;

export type PostmanExportResult =
  | { ok: true; result: ExportResult }
  | { ok: false; error: string; message: string; problems?: string[] };

/** Requests one export; the endpoint returns every artifact in a single response. */
export async function requestPostmanExport(
  apiModel: ApiModel,
  testModel: TestModel,
  options?: ExportOptions,
): Promise<PostmanExportResult> {
  try {
    const response = await fetch("/api/test-models/postman-collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiModel, testModel, ...(options ? { options } : {}) }),
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        error: (parsed?.error as string) ?? "unknown_error",
        message:
          (parsed?.message as string) ?? `Request failed with status ${response.status}`,
        ...(Array.isArray(parsed?.problems) ? { problems: parsed.problems as string[] } : {}),
      };
    }
    return { ok: true, result: parsed as ExportResult };
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

/**
 * A downloadable href for one artifact. Object URLs are used where the browser provides them
 * and a data URL is the fallback, so the artifacts download without the page needing to
 * navigate or the export needing to be repeated.
 */
export function artifactHref(text: string, mimeType: string): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(new Blob([text], { type: mimeType }));
  }
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
}

export function revokeArtifactHref(href: string): void {
  if (href.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(href);
  }
}

/** Serializes the artifacts for download, preserving the shape the endpoint returned. */
export function artifactFiles(result: ExportResult): {
  filename: string;
  label: string;
  text: string;
  mimeType: string;
}[] {
  return [
    {
      filename: ARTIFACT_FILENAMES.collection,
      label: "Download collection",
      text: `${JSON.stringify(result.collection, null, 2)}\n`,
      mimeType: "application/json",
    },
    {
      filename: ARTIFACT_FILENAMES.environment,
      label: "Download environment",
      text: `${JSON.stringify(result.environment, null, 2)}\n`,
      mimeType: "application/json",
    },
    {
      filename: ARTIFACT_FILENAMES.readme,
      label: "Download README",
      text: result.readme,
      mimeType: "text/markdown",
    },
  ];
}