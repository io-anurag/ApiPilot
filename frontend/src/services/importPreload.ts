import type { ExportResult } from "@apipilot/shared-domain";
import { artifactFilenames } from "./postmanCollectionsClient";

/** Fields an upload form can be pre-filled with once the guided workflow hands off its generated
 * Postman artifact to "Import & Run Collection" — the user still reviews and submits the upload
 * themselves (e.g. picking a risk tier), nothing is created on their behalf. */
export interface ImportPreload {
  token: number;
  name: string;
  collectionFile: File;
  environmentFile: File;
}

export function toImportPreload(
  postmanArtifact: ExportResult,
  specTitle: string | undefined,
  token: number,
): ImportPreload {
  const filenames = artifactFilenames(specTitle);
  return {
    token,
    name: specTitle?.trim() || "Generated collection",
    collectionFile: new File(
      [`${JSON.stringify(postmanArtifact.collection, null, 2)}\n`],
      filenames.collection,
      { type: "application/json" },
    ),
    environmentFile: new File(
      [`${JSON.stringify(postmanArtifact.environment, null, 2)}\n`],
      filenames.environment,
      { type: "application/json" },
    ),
  };
}
