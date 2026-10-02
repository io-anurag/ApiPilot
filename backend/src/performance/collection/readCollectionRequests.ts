import type { CollectionRequestRef, FindingOwner, LeftOutReason, LeftOutRequest } from "@apipilot/shared-domain";
import type { Collection, Event, Item, ItemGroup, RequestAuth, RequestBody } from "postman-collection";
import { isPostmanDynamicVariable } from "../../externalCollections/uploadedCollectionParsing";

/**
 * AP-036 (specs/036-collection-performance-test research R3, R4, R11): reads the selected requests
 * of a stored collection through the `postman-collection` SDK, with variables unresolved. Newman is
 * never invoked and nothing is sent (FR-005). Scripts are kept as text, with their owner, in the
 * order Postman runs them: the collection's, each folder's from the root inwards, then the
 * request's own. Pure over the parsed collection.
 */
export type ScriptEvent = "test" | "prerequest";

export interface CollectionScript {
  event: ScriptEvent;
  owner: FindingOwner;
  /** A stable key for the owner, for caching recognition per script. */
  ownerKey: string;
  text: string;
}

/** The effective auth, with the variables of its fields unresolved. `none` is Postman's `noauth`, or no auth anywhere. */
export interface CollectionAuth {
  type: "none" | "bearer" | "basic" | "apikey";
  /** `token`; `username` and `password`; or `key`, `value` and `in`. */
  fields: Record<string, string>;
  owner: FindingOwner | null;
}

export type CollectionBody = { kind: "json" | "text"; text: string; language: string | null } | { kind: "form"; pairs: { key: string; value: string }[] };

export interface CollectionRequestSource {
  ref: CollectionRequestRef;
  folderIds: string[];
  method: string;
  /** As written, with `{{name}}` references and path variables filled from `url.variable`. */
  url: string;
  headers: { key: string; value: string }[];
  body: CollectionBody | null;
  auth: CollectionAuth;
  scripts: CollectionScript[];
}

export type ReadRequest = { kind: "request"; source: CollectionRequestSource } | { kind: "left-out"; leftOut: LeftOutRequest };

/** Postman's `{{name}}`, with the surrounding spaces the collection editor tolerates. */
export const COLLECTION_REFERENCE = /\{\{\s*([^{}]+?)\s*\}\}/g;
export const RESERVED_PREFIX = "apipilot_";
const SUPPORTED_AUTH: ReadonlySet<string> = new Set(["noauth", "bearer", "basic", "apikey"]);
const UNSUPPORTED_BODY: ReadonlySet<string> = new Set(["formdata", "file", "graphql"]);

/** Every `{{name}}` in `text`, in order, repeats included. */
export function collectionReferences(text: string): string[] {
  return [...text.matchAll(COLLECTION_REFERENCE)].map((match) => match[1]);
}

/** `text` with every reference written as `{{name}}`, without the spaces Postman tolerates. */
export function normalizeReferences(text: string): string {
  return text.replace(COLLECTION_REFERENCE, (_match, name: string) => `{{${name}}}`);
}

interface Parents {
  folders: ItemGroup<Item>[];
  collection: Collection | undefined;
}

/** The item's folders from the root inwards, and its collection. */
function parentsOf(item: Item): Parents {
  const chain: unknown[] = [];
  item.forEachParent({ withRoot: true }, (parent: unknown) => chain.push(parent));
  const collection = chain.find((parent) => (parent as { constructor: { isCollection?: (value: unknown) => boolean } }).constructor.isCollection?.(parent)) as
    | Collection
    | undefined;
  const folders = chain.filter((parent) => parent !== collection).reverse() as ItemGroup<Item>[];
  return { folders, collection };
}

function folderOwner(folder: ItemGroup<Item>): FindingOwner {
  return { kind: "folder", folderId: String(folder.id), folderName: String(folder.name ?? "") };
}

function ownerKey(owner: FindingOwner): string {
  if (owner.kind === "collection") return "collection";
  return owner.kind === "folder" ? `folder:${owner.folderId}` : `request:${owner.itemId}`;
}

function scriptsOf(events: { all(): Event[] } | undefined, owner: FindingOwner): CollectionScript[] {
  if (!events) return [];
  const scripts: CollectionScript[] = [];
  for (const event of events.all()) {
    if (event.disabled === true || (event.listen !== "test" && event.listen !== "prerequest")) continue;
    const exec = event.script?.exec;
    const text = Array.isArray(exec) ? exec.join("\n") : typeof exec === "string" ? exec : "";
    scripts.push({ event: event.listen, owner, ownerKey: ownerKey(owner), text });
  }
  return scripts;
}

function authParameters(auth: RequestAuth): Record<string, string> {
  const parameters = auth.parameters()?.toObject() as Record<string, unknown> | undefined;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(parameters ?? {})) fields[key] = value === undefined || value === null ? "" : String(value);
  return fields;
}

/** The auth Postman applies: the request's own, else the nearest folder's, else the collection's (`Item.getAuth`). */
function effectiveAuth(item: Item, parents: Parents): { auth: RequestAuth | undefined; owner: FindingOwner | null } {
  if (item.request.auth) return { auth: item.request.auth, owner: { kind: "request", itemId: String(item.id) } };
  for (const folder of [...parents.folders].reverse()) {
    const auth = (folder as unknown as { auth?: RequestAuth }).auth;
    if (auth) return { auth, owner: folderOwner(folder) };
  }
  const auth = (parents.collection as unknown as { auth?: RequestAuth } | undefined)?.auth;
  return auth ? { auth, owner: { kind: "collection" } } : { auth: undefined, owner: null };
}

function authOf(item: Item, parents: Parents): CollectionAuth | { unsupported: string } {
  const { auth, owner } = effectiveAuth(item, parents);
  if (!auth || auth.type === "noauth") return { type: "none", fields: {}, owner };
  if (!SUPPORTED_AUTH.has(auth.type)) return { unsupported: auth.type };
  const parameters = authParameters(auth);
  if (auth.type === "bearer") return { type: "bearer", fields: { token: parameters.token ?? "" }, owner };
  if (auth.type === "basic") return { type: "basic", fields: { username: parameters.username ?? "", password: parameters.password ?? "" }, owner };
  return { type: "apikey", fields: { key: parameters.key ?? "", value: parameters.value ?? "", in: parameters.in === "query" ? "query" : "header" }, owner };
}

function isJsonContentType(value: string): boolean {
  const base = value.split(";")[0].trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

function bodyOf(body: RequestBody | undefined, headers: readonly { key: string; value: string }[]): CollectionBody | null | { unsupported: string } {
  if (!body || (body as unknown as { disabled?: boolean }).disabled === true || !body.mode) return null;
  if (UNSUPPORTED_BODY.has(body.mode)) return { unsupported: body.mode };
  if (body.mode === "urlencoded") {
    const params = body.urlencoded as unknown as { all?: () => { key: string | null; value: string | null; disabled?: boolean }[] } | undefined;
    const pairs = (params?.all?.() ?? []).filter((pair) => pair.disabled !== true).map((pair) => ({ key: pair.key ?? "", value: pair.value ?? "" }));
    return pairs.length === 0 ? null : { kind: "form", pairs };
  }
  if (body.mode !== "raw") return null;
  const text = typeof body.raw === "string" ? body.raw : "";
  if (text.length === 0) return null;
  const language = (body as unknown as { options?: { raw?: { language?: string } } }).options?.raw?.language ?? null;
  const contentType = headers.find((header) => header.key.toLowerCase() === "content-type")?.value ?? "";
  return { kind: language === "json" || isJsonContentType(contentType) ? "json" : "text", text, language };
}

/** The request's URL as Postman sends it: its scheme defaults to `http` when a literal host has none. */
function urlOf(item: Item): string {
  const text = normalizeReferences(item.request.url.toString());
  if (text.startsWith("{{") || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  return `http://${text}`;
}

/** The path after the leading `{{name}}` or `scheme://host[:port]`, without the query. */
export function pathOfUrl(url: string): string {
  let rest = url;
  const leading = /^\{\{[^{}]+\}\}/.exec(rest);
  if (leading) rest = rest.slice(leading[0].length);
  else {
    const authority = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(rest);
    if (authority) rest = rest.slice(authority[0].length);
  }
  const query = rest.search(/[?#]/);
  const path = query < 0 ? rest : rest.slice(0, query);
  return path.length === 0 ? "/" : path;
}

function texts(source: Omit<CollectionRequestSource, "scripts" | "ref" | "folderIds">): string[] {
  const all = [source.url, ...source.headers.flatMap((header) => [header.key, header.value]), ...Object.values(source.auth.fields)];
  if (source.body?.kind === "form") all.push(...source.body.pairs.flatMap((pair) => [pair.key, pair.value]));
  else if (source.body) all.push(source.body.text);
  return all;
}

/**
 * The first dynamic variable `{{$name}}` the request uses that the plan cannot generate, with its
 * reason (R4, FR-013): a known Postman variable outside `supported`, or an unknown one.
 */
function unsupportedDynamic(names: readonly string[], supported: ReadonlySet<string>): { reason: LeftOutReason; name: string } | null {
  for (const name of names) {
    if (!name.startsWith("$") || supported.has(name)) continue;
    return { reason: isPostmanDynamicVariable(name) ? "unsupported-dynamic-variable" : "unknown-dynamic-variable", name };
  }
  return null;
}

export interface ReadOptions {
  /** The `{{$name}}` variables the plan generates at run time (research R9); empty before User Story 2. */
  supportedDynamicVariables: ReadonlySet<string>;
}

/**
 * The ordered selected requests (research R3), each read or left out with one reason (R4).
 * `orderedRequestIds` must already be validated by AP-026's `resolveRunOrder`.
 */
export function readCollectionRequests(collection: Collection, orderedRequestIds: readonly string[], options: ReadOptions): ReadRequest[] {
  const items = new Map<string, Item>();
  collection.forEachItem((item: Item) => {
    items.set(String(item.id), item);
  });
  return orderedRequestIds.map((itemId): ReadRequest => {
    const item = items.get(itemId);
    if (!item) throw new Error(`The collection has no request ${itemId}.`);
    const parents = parentsOf(item);
    const ref: CollectionRequestRef = { itemId, name: String(item.name ?? ""), folderPath: parents.folders.map((folder) => String(folder.name ?? "")) };
    const method = String(item.request.method ?? "GET").toUpperCase();
    const url = urlOf(item);
    const leftOut = (reason: LeftOutReason, detail: string | null): ReadRequest => ({ kind: "left-out", leftOut: { ...ref, method, path: pathOfUrl(url), reason, detail } });

    const headers = item.request.headers
      .all()
      .filter((header) => header.disabled !== true)
      .map((header) => ({ key: String(header.key ?? ""), value: normalizeReferences(String(header.value ?? "")) }));
    const auth = authOf(item, parents);
    if ("unsupported" in auth) return leftOut("unsupported-auth", auth.unsupported);
    const body = bodyOf(item.request.body, headers);
    if (body && "unsupported" in body) return leftOut("unsupported-body", body.unsupported);
    const normalizedBody: CollectionBody | null =
      body === null ? null : body.kind === "form" ? { kind: "form", pairs: body.pairs.map((pair) => ({ key: normalizeReferences(pair.key), value: normalizeReferences(pair.value) })) } : { ...body, text: normalizeReferences(body.text) };
    const normalizedAuth: CollectionAuth = { ...auth, fields: Object.fromEntries(Object.entries(auth.fields).map(([key, value]) => [key, normalizeReferences(value)])) };

    const request = { method, url, headers, body: normalizedBody, auth: normalizedAuth };
    const names = texts(request).flatMap(collectionReferences);
    const dynamic = unsupportedDynamic(names, options.supportedDynamicVariables);
    if (dynamic) return leftOut(dynamic.reason, dynamic.name);
    const reserved = names.find((name) => name.startsWith(RESERVED_PREFIX));
    if (reserved !== undefined) return leftOut("reserved-name", reserved);

    const scripts = [
      ...scriptsOf(parents.collection?.events, { kind: "collection" }),
      ...parents.folders.flatMap((folder) => scriptsOf(folder.events, folderOwner(folder))),
      ...scriptsOf(item.events, { kind: "request", itemId }),
    ];
    return { kind: "request", source: { ref, folderIds: parents.folders.map((folder) => String(folder.id)), ...request, scripts } };
  });
}
