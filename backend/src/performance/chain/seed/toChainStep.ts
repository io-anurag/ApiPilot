import { parseReferences, STEP_METHODS, type ChainStep, type NameValue, type StepBody, type StepMethod } from "@apipilot/shared-domain";
import type { RequestTemplate } from "../../plan/stepRequest";

/**
 * Turns a request the existing builders produce (`RequestTemplate`) into a request-chain step's
 * concrete text (specs/037-request-chain-performance research R15). The URL's query becomes rows;
 * a JSON body becomes raw `application/json`; a form body becomes fields; auth becomes plain headers
 * or query rows, because the chain runtime has no auth kinds (research R10):
 * - bearer: `Authorization: Bearer <token>`;
 * - API key: a header or query row;
 * - basic with literal user and password: `Authorization: Basic <base64>`, a literal the credential
 *   mover then handles (FR-027); basic with references: `Authorization: Basic {{<name>}}`, a secret
 *   value that must hold the Base64 of `user:password`, which the seeding report says.
 * Unique body fields arrive as `{{$guid}}` or `{{$randomEmail}}` (FR-021). Names a reference may not
 * use are rewritten to letters, digits and underscores (FR-004). Pure.
 */
export type SeedRequest = Pick<ChainStep, "method" | "url" | "query" | "headers" | "body">;

export interface ConvertedRequest {
  request: SeedRequest;
  /** A basic-auth value the engineer must provide, encoded (`basic-auth-encoded-value`). */
  basicValueName: string | null;
}

const VALID_NAME = /^[A-Za-z0-9_]+$/;

export function referenceName(name: string): string {
  return VALID_NAME.test(name) ? name : name.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Rewrites every `{{name}}` with characters a reference may not hold. Dynamic variables are kept. */
export function withValidReferences(text: string): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (match, name: string) => (name.startsWith("$") || VALID_NAME.test(name) ? match : `{{${referenceName(name)}}}`));
}

function splitQuery(url: string): { url: string; query: NameValue[] } {
  const at = url.indexOf("?");
  if (at < 0) return { url, query: [] };
  const query = url
    .slice(at + 1)
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const equals = pair.indexOf("=");
      return equals < 0 ? { name: pair, value: "" } : { name: pair.slice(0, equals), value: pair.slice(equals + 1) };
    });
  return { url: url.slice(0, at), query };
}

function formFields(text: string): NameValue[] {
  return text
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const decode = (part: string) => {
        try {
          return decodeURIComponent(part.replace(/\+/g, " "));
        } catch {
          return part;
        }
      };
      return equals < 0 ? { name: decode(pair), value: "" } : { name: decode(pair.slice(0, equals)), value: decode(pair.slice(equals + 1)) };
    });
}

function methodOf(method: string): StepMethod {
  const upper = method.toUpperCase();
  return (STEP_METHODS as readonly string[]).includes(upper) ? (upper as StepMethod) : "GET";
}

function isLiteral(text: string): boolean {
  return text !== "" && parseReferences(text).length === 0;
}

/** `basicName` names the value a basic credential with references is replaced by. */
export function toChainRequest(template: RequestTemplate, basicName: string): ConvertedRequest {
  const split = splitQuery(withValidReferences(template.url));
  const query = split.query.map((row) => ({ name: withValidReferences(row.name), value: withValidReferences(row.value) }));
  let contentType: string | null = null;
  const headers: NameValue[] = [];
  for (const header of template.headers) {
    const name = header.key.trim();
    if (name.toLowerCase() === "content-type") {
      contentType = header.value;
      continue;
    }
    if (name.toLowerCase() === "host" || name.toLowerCase() === "content-length") continue;
    headers.push({ name, value: withValidReferences(header.value) });
  }
  let basicValueName: string | null = null;
  const auth = template.auth;
  if (auth.kind === "bearer") headers.push({ name: "Authorization", value: `Bearer ${withValidReferences(auth.token)}` });
  if (auth.kind === "apikey" && auth.in === "header") headers.push({ name: auth.key, value: withValidReferences(auth.value) });
  if (auth.kind === "apikey" && auth.in === "query") query.push({ name: auth.key, value: withValidReferences(auth.value) });
  if (auth.kind === "basic") {
    if (isLiteral(auth.username) && isLiteral(auth.password)) {
      headers.push({ name: "Authorization", value: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf-8").toString("base64")}` });
    } else {
      basicValueName = referenceName(basicName);
      headers.push({ name: "Authorization", value: `Basic {{${basicValueName}}}` });
    }
  }
  let body: StepBody = { kind: "none" };
  if (template.body !== undefined) {
    if (template.bodyKind === "form") body = { kind: "form", fields: formFields(template.body).map((field) => ({ name: withValidReferences(field.name), value: withValidReferences(field.value) })) };
    else body = { kind: "raw", contentType: template.bodyKind === "json" ? "application/json" : (contentType ?? "text/plain"), text: withValidReferences(template.body) };
  }
  return { request: { method: methodOf(template.method), url: split.url, query, headers, body }, basicValueName };
}
