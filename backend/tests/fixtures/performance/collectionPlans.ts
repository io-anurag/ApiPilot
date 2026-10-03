import type { UploadedCollectionSet } from "@apipilot/shared-domain";
import type TestAgent from "supertest/lib/agent";

/** Uploads a collection through `POST /api/external-collections`, as the browser does, and returns its id. */
export async function uploadCollection(
  agent: TestAgent,
  collection: Record<string, unknown>,
  environment: Record<string, unknown> | undefined,
  options: { name?: string; tier?: UploadedCollectionSet["tier"] } = {},
): Promise<string> {
  const response = await agent
    .post("/api/external-collections")
    .field("name", options.name ?? "APIFoundry")
    .field("tier", options.tier ?? "local")
    .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment ?? { values: [] })), "environment.json");
  if (response.status !== 201 && response.status !== 200) throw new Error(`Upload failed with ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body.uploadedCollection.id as string;
}
