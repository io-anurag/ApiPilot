import type { Collection, Item, ItemGroup, Variable } from "postman-collection";
import type {
  CollectionFolderView,
  CollectionRequestFields,
  CollectionRequestView,
  CollectionView,
  VariableBinding,
} from "@apipilot/shared-domain";
import { extractReferencedVariables, findVariableTokens, substituteVariables } from "./uploadedCollectionParsing";
import { findEditedItemIds } from "./editedItems";

type Folder = ItemGroup<Item>;

/** A member of a Postman `PropertyList<Item|ItemGroup>` — only `ItemGroup` (a folder) carries `.items`. */
function isFolder(member: Item | Folder): member is Folder {
  return "items" in member && member.items !== undefined;
}

function bodyToText(body: Item["request"]["body"]): string | undefined {
  if (!body) return undefined;
  const json = body.toJSON();
  // Only the "raw" mode round-trips as plain text; every other Postman body mode (formdata,
  // urlencoded, graphql, file) is rendered as its own JSON shape rather than corrupted into a
  // string that looks like raw text it never was (spec.md Edge Cases: "renders each supported
  // body mode faithfully").
  return json.mode === "raw" ? (json.raw ?? "") : JSON.stringify(json);
}

function rawFields(item: Item): CollectionRequestFields {
  const headers = item.request.headers.all().map((header) => ({ key: header.key, value: String(header.value ?? "") }));
  return {
    method: item.request.method,
    url: item.request.url ? item.request.url.toString() : "",
    headers,
    body: bodyToText(item.request.body),
  };
}

function resolvedFields(raw: CollectionRequestFields, variableValues: Record<string, string>): CollectionRequestFields {
  return {
    method: raw.method,
    url: substituteVariables(raw.url, variableValues),
    headers: raw.headers.map((header) => ({ key: header.key, value: substituteVariables(header.value, variableValues) })),
    body: raw.body === undefined ? undefined : substituteVariables(raw.body, variableValues),
  };
}

function unresolvedVariablesFor(raw: CollectionRequestFields, variableValues: Record<string, string>): string[] {
  const tokens = new Set<string>();
  for (const token of findVariableTokens(raw.url)) tokens.add(token);
  for (const header of raw.headers) {
    for (const token of findVariableTokens(header.value)) tokens.add(token);
  }
  if (raw.body) {
    for (const token of findVariableTokens(raw.body)) tokens.add(token);
  }
  return [...tokens].filter((name) => !variableValues[name]);
}

function toRequestView(item: Item, variableValues: Record<string, string>, editedItemIds: Set<string>): CollectionRequestView {
  const raw = rawFields(item);
  return {
    id: item.id,
    name: item.name,
    wasEdited: editedItemIds.has(item.id),
    raw,
    resolved: resolvedFields(raw, variableValues),
    unresolvedVariables: unresolvedVariablesFor(raw, variableValues),
  };
}

function toFolderView(group: Folder, variableValues: Record<string, string>, editedItemIds: Set<string>): CollectionFolderView {
  const items: CollectionRequestView[] = [];
  const folders: CollectionFolderView[] = [];
  group.items.each((member: Item | Folder) => {
    if (isFolder(member)) {
      folders.push(toFolderView(member, variableValues, editedItemIds));
    } else {
      items.push(toRequestView(member, variableValues, editedItemIds));
    }
  });
  return { id: group.id, name: group.name, items, folders };
}

/**
 * Every variable available to this collection (FR-003, FR-018) — the union of variables
 * referenced by a request, variables the collection's own `variable` array declares, and any key
 * already present in `variableValues` with no current reference (research.md D12). Exactly two
 * persisted `source` tiers (research.md D8): `variableValues` always wins over a collection
 * default of the same name.
 */
function buildVariableBindings(collection: Collection, variableValues: Record<string, string>): VariableBinding[] {
  const referenced = new Set(extractReferencedVariables(collection));
  const collectionDefaults = new Map<string, string>();
  collection.variables.each((variable: Variable) => {
    if (!variable.key) return;
    collectionDefaults.set(variable.key, variable.value === undefined ? "" : String(variable.value));
  });

  const names = new Set<string>([...referenced, ...collectionDefaults.keys(), ...Object.keys(variableValues)]);
  return [...names].map((name): VariableBinding => {
    const environmentValue = variableValues[name];
    if (environmentValue) {
      return { name, value: environmentValue, source: "environment", resolved: true, referenced: referenced.has(name) };
    }
    const defaultValue = collectionDefaults.get(name);
    return {
      name,
      value: defaultValue && defaultValue.length > 0 ? defaultValue : undefined,
      source: "collection-default",
      resolved: Boolean(defaultValue && defaultValue.length > 0),
      referenced: referenced.has(name),
    };
  });
}

/**
 * Builds the full pre-run read model for a loaded collection (FR-001–FR-003, research.md D3,
 * D12). `items`/`folders` at this level are the collection's own root-level requests/folders —
 * the root itself carries no `id` of its own, matching the `containerId: "root"` literal the
 * reorder endpoint uses (contracts/collection-editor-api.md) rather than a synthesized folder.
 *
 * `rawCollectionJson` must be the exact JSON string `collection` was parsed from — it is used
 * only to recover the `_apipilotEdited` marker the SDK itself cannot preserve (research.md D6,
 * `editedItems.ts`).
 */
export function buildCollectionView(
  uploadedCollectionSetId: string,
  collection: Collection,
  rawCollectionJson: string,
  variableValues: Record<string, string>,
): CollectionView {
  const editedItemIds = findEditedItemIds(rawCollectionJson);
  const folders: CollectionFolderView[] = [];
  const items: CollectionRequestView[] = [];
  collection.items.each((member: Item | Folder) => {
    if (isFolder(member)) {
      folders.push(toFolderView(member, variableValues, editedItemIds));
    } else {
      items.push(toRequestView(member, variableValues, editedItemIds));
    }
  });
  return { id: uploadedCollectionSetId, items, folders, variables: buildVariableBindings(collection, variableValues) };
}
