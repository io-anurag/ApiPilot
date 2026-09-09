import type { PostmanCollection, PostmanRequestItem } from "@apipilot/shared-domain";

export function workflowFolders(collection: PostmanCollection) {
  return collection.item.filter((folder) => folder.name.startsWith("Workflow: "));
}

export function workflowItems(collection: PostmanCollection): PostmanRequestItem[] {
  return workflowFolders(collection).flatMap((folder) => folder.item);
}

export function findWorkflowFolder(collection: PostmanCollection, workflowId: string) {
  return collection.item.find((folder) => folder.name === `Workflow: ${workflowId}`);
}

export function scriptLines(item: PostmanRequestItem): string[] {
  return item.event?.flatMap((event) => event.script.exec) ?? [];
}

export function serializedArtifact(result: unknown): string {
  return JSON.stringify(result);
}
