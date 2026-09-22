import type { Collection, Event, Item, ItemGroup, Variable } from "postman-collection";
import type {
  CollectionFolderView,
  CollectionRequestFields,
  CollectionRequestView,
  CollectionView,
  ImpliedAuthHeader,
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

/**
 * The request's "test" event script, exactly as stored (research.md D6 — read directly off the
 * SDK's own model, never reclassified). A collection item may carry more than one "test" event;
 * every one Newman would run is concatenated in order, matching what a run actually executes.
 */
function testScriptOf(item: Item): string | undefined {
  const events: Event[] = item.events.listeners("test");
  const sources = events.map((event) => event.script?.toSource()).filter((source): source is string => Boolean(source));
  return sources.length > 0 ? sources.join("\n") : undefined;
}

function resolvedFields(raw: CollectionRequestFields, variableValues: Record<string, string>): CollectionRequestFields {
  return {
    method: raw.method,
    url: substituteVariables(raw.url, variableValues),
    headers: raw.headers.map((header) => ({ key: header.key, value: substituteVariables(header.value, variableValues) })),
    body: raw.body === undefined ? undefined : substituteVariables(raw.body, variableValues),
  };
}

function unresolvedVariablesFor(
  raw: CollectionRequestFields,
  variableValues: Record<string, string>,
  impliedAuthHeader: ImpliedAuthHeader | undefined,
): string[] {
  const tokens = new Set<string>();
  for (const token of findVariableTokens(raw.url)) tokens.add(token);
  for (const header of raw.headers) {
    for (const token of findVariableTokens(header.value)) tokens.add(token);
  }
  if (raw.body) {
    for (const token of findVariableTokens(raw.body)) tokens.add(token);
  }
  if (impliedAuthHeader) {
    for (const token of findVariableTokens(impliedAuthHeader.rawValue)) tokens.add(token);
  }
  return [...tokens].filter((name) => !variableValues[name]);
}

/**
 * The header this item's effective `auth` (its own, or inherited from a parent folder/the
 * collection — `Item.getAuth()` walks that chain the same way Newman's own authorizer does)
 * would add automatically when the request runs. Only `bearer` and header-located `apikey` are
 * represented (see `ImpliedAuthHeader`'s doc comment for why every other type is left
 * undefined) — `undefined` whenever no auth applies or the effective type isn't one of these two.
 */
function impliedAuthHeaderFor(item: Item, variableValues: Record<string, string>): ImpliedAuthHeader | undefined {
  const auth = item.getAuth();
  if (!auth) return undefined;
  const params = auth.parameters();

  if (auth.type === "bearer") {
    const token = params?.get("token");
    if (typeof token !== "string" || token.length === 0) return undefined;
    return {
      key: "Authorization",
      rawValue: `Bearer ${token}`,
      resolvedValue: `Bearer ${substituteVariables(token, variableValues)}`,
    };
  }

  if (auth.type === "apikey") {
    const location = params?.get("in");
    if (location !== undefined && location !== "header") return undefined; // query-located: already visible in the URL
    const key = params?.get("key");
    const value = params?.get("value");
    if (typeof key !== "string" || key.length === 0 || typeof value !== "string" || value.length === 0) return undefined;
    return { key, rawValue: value, resolvedValue: substituteVariables(value, variableValues) };
  }

  return undefined;
}

function toRequestView(item: Item, variableValues: Record<string, string>, editedItemIds: Set<string>): CollectionRequestView {
  const raw = rawFields(item);
  const testScript = testScriptOf(item);
  const impliedAuthHeader = impliedAuthHeaderFor(item, variableValues);
  return {
    id: item.id,
    name: item.name,
    wasEdited: editedItemIds.has(item.id),
    raw,
    resolved: resolvedFields(raw, variableValues),
    unresolvedVariables: unresolvedVariablesFor(raw, variableValues, impliedAuthHeader),
    ...(testScript !== undefined ? { testScript } : {}),
    ...(impliedAuthHeader !== undefined ? { impliedAuthHeader } : {}),
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
