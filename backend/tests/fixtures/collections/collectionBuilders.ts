import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Small pure builders for inline Postman v2.1 collections (AP-036 tasks T003). Ids are explicit
 * strings, never random, so plans built from them are deterministic.
 */
export type RawAuth = { type: string } & Record<string, unknown>;

export interface RawEvent {
  listen: "test" | "prerequest";
  script: { type: "text/javascript"; exec: string[] };
}

export interface RawRequestOptions {
  method?: string;
  url?: unknown;
  header?: { key: string; value: string; disabled?: boolean }[];
  body?: unknown;
  auth?: RawAuth;
  event?: RawEvent[];
}

export interface RawItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

export function testScript(...lines: string[]): RawEvent {
  return { listen: "test", script: { type: "text/javascript", exec: lines } };
}

export function prerequestScript(...lines: string[]): RawEvent {
  return { listen: "prerequest", script: { type: "text/javascript", exec: lines } };
}

export function requestItem(id: string, name: string, options: RawRequestOptions = {}): RawItem {
  return {
    id,
    name,
    ...(options.event ? { event: options.event } : {}),
    request: {
      method: options.method ?? "GET",
      header: options.header ?? [],
      url: options.url ?? `{{baseUrl}}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      ...(options.body ? { body: options.body } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
    },
  };
}

export function folderItem(id: string, name: string, items: RawItem[], options: { auth?: RawAuth; event?: RawEvent[] } = {}): RawItem {
  return { id, name, item: items, ...(options.auth ? { auth: options.auth } : {}), ...(options.event ? { event: options.event } : {}) };
}

export function collectionOf(
  items: RawItem[],
  options: { auth?: RawAuth; event?: RawEvent[]; variable?: { key: string; value: string }[]; name?: string } = {},
): Record<string, unknown> {
  return {
    info: { name: options.name ?? "Fixture", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.event ? { event: options.event } : {}),
    ...(options.variable ? { variable: options.variable } : {}),
    item: items,
  };
}

export function bearerAuth(token: string): RawAuth {
  return { type: "bearer", bearer: [{ key: "token", value: token, type: "string" }] };
}

export function jsonBody(raw: string): unknown {
  return { mode: "raw", raw, options: { raw: { language: "json" } } };
}

const FIXTURES = __dirname;

/** The APIFoundry fixture's request ids, in the collection's own order (User Story 1). */
export const APIFOUNDRY_REQUEST_IDS = [
  "req-token",
  "req-list-customers",
  "req-create-customer",
  "req-get-customer",
  "req-update-customer",
  "req-delete-customer",
  "req-health",
  "req-version",
] as const;

export const APIFOUNDRY_LITERAL_CUSTOMER_BODY = '{\n  "name": "Ada Lovelace",\n  "email": "ada@example.com"\n}';

/**
 * The APIFoundry fixture collection (tasks T002). With `dynamicBody: false`, the customer `POST`
 * sends a literal body, because supported dynamic variables arrive only in User Story 2.
 */
export function apifoundryCollection(options: { dynamicBody: boolean }): Record<string, unknown> {
  const collection = JSON.parse(readFileSync(path.join(FIXTURES, "apifoundry.postman_collection.json"), "utf-8")) as Record<string, unknown>;
  if (options.dynamicBody) return collection;
  const customers = (collection.item as RawItem[]).find((item) => item.id === "folder-customers")!;
  const create = (customers.item as RawItem[]).find((item) => item.id === "req-create-customer")!;
  (create.request as { body: { raw: string } }).body.raw = APIFOUNDRY_LITERAL_CUSTOMER_BODY;
  return collection;
}

export function apifoundryEnvironment(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, "apifoundry.postman_environment.json"), "utf-8")) as Record<string, unknown>;
}
