import type { Collection, Event, Item, ItemGroup, RequestAuth, Variable } from "postman-collection";
import type {
  CollectionFolderView,
  CollectionRequestFields,
  CollectionRequestView,
  CollectionView,
  ImpliedAuthHeader,
  RequestAuthView,
  RequestVariableReference,
  VariableBinding,
} from "@apipilot/shared-domain";
import { extractReferencedVariables, findVariableTokens, removeVariableTokens, substituteVariables } from "./uploadedCollectionParsing";
import { findEditedItemIds } from "./editedItems";
import { copiedScriptSourceFolderId, inheritedAuth, ownAuth } from "./collectionStructure";

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
 * The request's own "test" event script, exactly as stored (research.md D6 — read directly off the
 * SDK's own model, never reclassified). An item may carry more than one "test" event of its own;
 * they are concatenated in order. Only the item's own events are read (`listenersOwn`):
 * `listeners()` also returns every ancestor folder's and the collection's, and the Tests tab saves
 * what it shows onto the request, so showing those made each save copy them onto the request and
 * run them twice (fixed 2026-09-25).
 */
function testScriptOf(item: Item): string | undefined {
  const events: Event[] = item.events.listenersOwn("test");
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

/**
 * Auth field keys whose literal value is a secret (FR-002a, data-model.md). `value` counts only on
 * an `apikey` auth, where it holds the key itself.
 */
const SECRET_AUTH_FIELD_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "client_secret",
  "consumerSecret",
  "tokenSecret",
  "secretKey",
  "sessionToken",
  "privateKey",
  "authKey",
]);

function isSecretAuthField(type: string, key: string): boolean {
  return SECRET_AUTH_FIELD_KEYS.has(key) || (type === "apikey" && key === "value");
}

/** An auth parameter's stored value as text; non-string values (booleans, oauth2 objects) as JSON. */
function authFieldText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Everything the view builder threads down the tree: the collection, lookups, and the folders above the current node. */
interface ViewContext {
  collection: Collection;
  variableValues: Record<string, string>;
  editedItemIds: Set<string>;
  bindings: Map<string, VariableBinding>;
  chain: Folder[];
}

/**
 * The request's effective auth for display (FR-002a): its own, else the nearest folder's or the
 * collection's — the same walk `Item.getAuth()` makes. Values are as stored; a secret field holding
 * a literal is emptied here, on the server, so the literal never reaches the browser.
 */
function authViewFor(item: Item, context: ViewContext): { view: RequestAuthView; storedValues: string[] } | undefined {
  const own = ownAuth(item);
  if (own) return describeAuth(own, { kind: "request" });
  const inherited = inheritedAuth(context.collection, context.chain);
  if (!inherited) return undefined;
  return describeAuth(
    inherited.auth,
    inherited.source === context.collection
      ? { kind: "collection" }
      : { kind: "folder", folderId: inherited.source.id, folderName: inherited.source.name },
  );
}

function describeAuth(auth: RequestAuth, source: RequestAuthView["source"]): { view: RequestAuthView; storedValues: string[] } {
  const storedValues: string[] = [];
  const fields = (auth.parameters()?.all() ?? []).map((parameter: Variable) => {
    const key = parameter.key ?? "";
    const value = authFieldText(parameter.value);
    storedValues.push(value);
    const hiddenLiteral = isSecretAuthField(auth.type, key) && removeVariableTokens(value).trim().length > 0;
    return { key, value: hiddenLiteral ? "" : value, hiddenLiteral };
  });
  return { view: { type: auth.type, source, fields }, storedValues };
}

/** Every variable the request uses, in first-use order (URL, headers, body, auth), with its binding's status (FR-002b). */
function variableReferencesFor(
  raw: CollectionRequestFields,
  authValues: string[],
  bindings: Map<string, VariableBinding>,
): RequestVariableReference[] {
  const usage = new Map<string, Set<RequestVariableReference["usedIn"][number]>>();
  const record = (text: string, location: RequestVariableReference["usedIn"][number]) => {
    for (const name of findVariableTokens(text)) {
      const locations = usage.get(name) ?? new Set();
      locations.add(location);
      usage.set(name, locations);
    }
  };
  record(raw.url, "url");
  for (const header of raw.headers) record(header.value, "headers");
  if (raw.body) record(raw.body, "body");
  for (const value of authValues) record(value, "auth");

  return [...usage].map(([name, locations]) => {
    const binding = bindings.get(name);
    const resolved = binding?.resolved ?? false;
    return {
      name,
      usedIn: [...locations],
      resolved,
      ...(resolved && binding ? { source: binding.source } : {}),
    };
  });
}

/** Folders whose scripts `member` carries a copy of, from the marker line a move writes (FR-015b). */
function copiedScriptFolderIdsOf(member: Item | Folder): string[] {
  const ids = new Set<string>();
  for (const event of member.events.all()) {
    const source = event.script?.toSource();
    const folderId = source ? copiedScriptSourceFolderId(source) : undefined;
    if (folderId) ids.add(folderId);
  }
  return [...ids];
}

function toRequestView(item: Item, context: ViewContext): CollectionRequestView {
  const { variableValues } = context;
  const raw = rawFields(item);
  const testScript = testScriptOf(item);
  const impliedAuthHeader = impliedAuthHeaderFor(item, variableValues);
  const auth = authViewFor(item, context);
  return {
    id: item.id,
    name: item.name,
    wasEdited: context.editedItemIds.has(item.id),
    raw,
    resolved: resolvedFields(raw, variableValues),
    unresolvedVariables: unresolvedVariablesFor(raw, variableValues, impliedAuthHeader),
    ...(testScript !== undefined ? { testScript } : {}),
    ...(impliedAuthHeader !== undefined ? { impliedAuthHeader } : {}),
    ...(auth !== undefined ? { auth: auth.view } : {}),
    variableReferences: variableReferencesFor(raw, auth?.storedValues ?? [], context.bindings),
    copiedScriptFolderIds: copiedScriptFolderIdsOf(item),
  };
}

function toFolderView(group: Folder, context: ViewContext): CollectionFolderView {
  const inner: ViewContext = { ...context, chain: [...context.chain, group] };
  const items: CollectionRequestView[] = [];
  const folders: CollectionFolderView[] = [];
  group.items.each((member: Item | Folder) => {
    if (isFolder(member)) {
      folders.push(toFolderView(member, inner));
    } else {
      items.push(toRequestView(member, inner));
    }
  });
  const scriptEvents = (["prerequest", "test"] as const).filter((listen) =>
    group.events.listenersOwn(listen).some((event) => (event.script?.toSource() ?? "").trim().length > 0),
  );
  return { id: group.id, name: group.name, items, folders, scriptEvents, copiedScriptFolderIds: copiedScriptFolderIdsOf(group) };
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
  const variables = buildVariableBindings(collection, variableValues);
  const context: ViewContext = {
    collection,
    variableValues,
    editedItemIds: findEditedItemIds(rawCollectionJson),
    bindings: new Map(variables.map((binding) => [binding.name, binding])),
    chain: [],
  };
  const folders: CollectionFolderView[] = [];
  const items: CollectionRequestView[] = [];
  collection.items.each((member: Item | Folder) => {
    if (isFolder(member)) {
      folders.push(toFolderView(member, context));
    } else {
      items.push(toRequestView(member, context));
    }
  });
  return { id: uploadedCollectionSetId, items, folders, variables };
}
