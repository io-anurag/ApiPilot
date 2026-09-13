import type { ApiModel, ExportOptions, ExportResult, TestModel } from "@apipilot/shared-domain";

/** Generic names used when the specification has no usable title (FR-022). */
export const ARTIFACT_FILENAMES = {
  collection: "collection.json",
  environment: "environment.json",
  readme: "README.md",
} as const;

const MAX_SLUG_LENGTH = 60;

/**
 * Derives a filesystem-safe slug from the specification's title, so downloaded artifact names
 * identify which specification they came from (FR-022). Returns undefined when the title has no
 * usable characters, so the caller can fall back to the generic names.
 */
function titleSlug(specTitle: string | undefined): string | undefined {
  const slug = (specTitle ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, "");
  return slug.length > 0 ? slug : undefined;
}

/** The three file names one export produces, named after the specification when possible. */
export function artifactFilenames(specTitle: string | undefined): {
  collection: string;
  environment: string;
  readme: string;
} {
  const slug = titleSlug(specTitle);
  if (slug === undefined) return ARTIFACT_FILENAMES;
  return {
    collection: `${slug}.postman_collection.json`,
    environment: `${slug}.postman_environment.json`,
    readme: `${slug}.README.md`,
  };
}

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

/**
 * Serializes the artifacts for download, preserving the shape the endpoint returned. `specTitle`
 * is the uploaded specification's own title (`apiModel.info.title`), used to name the downloaded
 * files so exports from different specifications stay distinguishable (FR-022); pass undefined
 * when the specification has no usable title to keep the generic file names.
 */
export function artifactFiles(
  result: ExportResult,
  specTitle?: string,
): {
  filename: string;
  label: string;
  text: string;
  mimeType: string;
}[] {
  const filenames = artifactFilenames(specTitle);
  return [
    {
      filename: filenames.collection,
      label: "Download collection",
      text: `${JSON.stringify(result.collection, null, 2)}\n`,
      mimeType: "application/json",
    },
    {
      filename: filenames.environment,
      label: "Download environment",
      text: `${JSON.stringify(result.environment, null, 2)}\n`,
      mimeType: "application/json",
    },
    {
      filename: filenames.readme,
      label: "Download README",
      text: result.readme,
      mimeType: "text/markdown",
    },
  ];
}