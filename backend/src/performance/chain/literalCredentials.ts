import { parseReferences, type ChainPlan, type ChainStep, type MovedCredential } from "@apipilot/shared-domain";
import { namesUsedBy } from "@apipilot/shared-domain";
import { CredentialMixedLiteralError, CredentialNeedsEnvironmentError, type CredentialLocation } from "../errors";
import { parseCapturePath, valueAtPath, withValueAtPath } from "../plan/capturePath";

/**
 * FR-027 (specs/037-request-chain-performance research R8; Clarification 2026-10-03): a literal
 * credential typed into a step never stays in the plan. On every save, a literal value in an
 * `Authorization`, `Proxy-Authorization` or `Cookie` header, or in a JSON body field the seeding
 * operation declared `format: password`, is replaced by a `{{name}}` reference, and the value is
 * handed back to the caller to store as a secret value of the target environment. With no target
 * environment the save is refused (`CredentialNeedsEnvironmentError`); text that mixes a literal with
 * references is refused, since the move could not be exact. Pure: the caller writes the values, and
 * no value is ever logged.
 */

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization"]);
const COOKIE = "cookie";
/** An auth scheme word followed by whitespace, as in `Bearer abc`. */
const SCHEME = /^(\s*[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*)(\s+)([\s\S]*)$/;
const MARKER = /@@APIPILOT_REF_(\d+)@@/g;

export interface CredentialMove extends Omit<MovedCredential, "environmentName"> {
  /** The literal moved out of the plan. Only ever written to the environment, never logged. */
  value: string;
}

export interface CredentialMoveResult {
  plan: ChainPlan;
  moves: CredentialMove[];
}

type Classified = { kind: "none" } | { kind: "literal"; text: string } | { kind: "mixed" };

function classify(text: string): Classified {
  const references = parseReferences(text);
  let rest = text;
  for (const reference of references) rest = rest.split(reference.raw).join("");
  if (rest.trim() === "") return { kind: "none" };
  return references.length > 0 ? { kind: "mixed" } : { kind: "literal", text: text.trim() };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "credential";
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}_${suffix}`;
  taken.add(name);
  return name;
}

interface HeaderMove {
  header: string;
  value: string;
  replacement: (name: string) => string;
}

function headerMove(stepId: string, header: { name: string; value: string }): HeaderMove | null {
  const lower = header.name.toLowerCase();
  if (!CREDENTIAL_HEADERS.has(lower) && lower !== COOKIE) return null;
  const location: CredentialLocation = { kind: "header", name: header.name };
  if (lower === COOKIE) {
    const found = classify(header.value);
    if (found.kind === "mixed") throw new CredentialMixedLiteralError(stepId, location);
    return found.kind === "literal" ? { header: header.name, value: found.text, replacement: (name) => `{{${name}}}` } : null;
  }
  const scheme = SCHEME.exec(header.value);
  const credential = scheme ? scheme[3] : header.value;
  const found = classify(credential);
  if (found.kind === "mixed") throw new CredentialMixedLiteralError(stepId, location);
  if (found.kind === "none") return null;
  const prefix = scheme ? `${scheme[1].trim()} ` : "";
  return { header: header.name, value: found.text, replacement: (name) => `${prefix}{{${name}}}` };
}

/** Replaces each reference by a marker JSON can parse: inside a string as text, outside as a quoted string. */
function withMarkers(text: string): { json: string; outside: Set<number>; raws: string[] } {
  const raws: string[] = [];
  const outside = new Set<number>();
  let json = "";
  let inString = false;
  for (let index = 0; index < text.length; ) {
    const char = text[index];
    if (char === "{" && text[index + 1] === "{") {
      const end = text.indexOf("}}", index + 2);
      if (end > 0 && !text.slice(index + 2, end).includes("{")) {
        const raw = text.slice(index, end + 2);
        const marker = `@@APIPILOT_REF_${raws.length}@@`;
        if (!inString) outside.add(raws.length);
        raws.push(raw);
        json += inString ? marker : `"${marker}"`;
        index = end + 2;
        continue;
      }
    }
    if (inString && char === "\\") {
      json += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '"') inString = !inString;
    json += char;
    index += 1;
  }
  return { json, outside, raws };
}

function withoutMarkers(text: string, outside: Set<number>, raws: string[]): string {
  return text
    .replace(/"@@APIPILOT_REF_(\d+)@@"/g, (match, index: string) => (outside.has(Number(index)) ? raws[Number(index)] : match))
    .replace(MARKER, (_match, index: string) => raws[Number(index)]);
}

function isJson(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}

/**
 * A JSON body's literal values at the step's `passwordFields`, moved to references. The body is
 * written back with `JSON.stringify` (2-space indentation when the original had line breaks), so a
 * body with a moved password field is reformatted; references keep their places. A body that is not
 * JSON is left as it is.
 */
function movePasswordFields(step: ChainStep, nameFor: (base: string) => string, moves: CredentialMove[]): ChainStep {
  const source = step.source;
  if ((source.kind !== "operation" && source.kind !== "workflow") || source.passwordFields.length === 0) return step;
  if (step.body.kind !== "raw" || !isJson(step.body.contentType)) return step;
  const marked = withMarkers(step.body.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(marked.json);
  } catch {
    return step;
  }
  let changed = false;
  for (const path of source.passwordFields) {
    const segments = parseCapturePath(path);
    if (!segments.ok) continue;
    const value = valueAtPath(parsed, segments.segments);
    if (typeof value !== "string" || value === "") continue;
    const location: CredentialLocation = { kind: "body-field", path };
    const markers = value.match(MARKER) ?? [];
    if (markers.length > 0) {
      if (value.replace(MARKER, "").trim() === "") continue;
      throw new CredentialMixedLiteralError(step.id, location);
    }
    const valueName = nameFor(`${slug(path)}_${step.id}`);
    moves.push({ stepId: step.id, location, valueName, value });
    marked.raws.push(`{{${valueName}}}`);
    parsed = withValueAtPath(parsed, segments.segments, `@@APIPILOT_REF_${marked.raws.length - 1}@@`);
    changed = true;
  }
  if (!changed) return step;
  const indent = step.body.text.includes("\n") ? 2 : undefined;
  return { ...step, body: { ...step.body, text: withoutMarkers(JSON.stringify(parsed, null, indent), marked.outside, marked.raws) } };
}

/**
 * Moves every literal credential of `plan` out of it. `environment` is the target environment's name
 * and value names, or `null` when the plan has none; a literal with nowhere to go is refused.
 */
export function moveLiteralCredentials(plan: ChainPlan, environment: { name: string; valueNames: readonly string[] } | null): CredentialMoveResult {
  const taken = new Set<string>([...(environment?.valueNames ?? []), ...plan.secretNames, ...plan.chains.flatMap((chain) => chain.steps.flatMap((step) => namesUsedBy(step)))]);
  const moves: CredentialMove[] = [];
  const nameFor = (base: string) => uniqueName(base, taken);

  const chains = plan.chains.map((chain) => ({
    ...chain,
    steps: chain.steps.map((step) => {
      let headersChanged = false;
      const headers = step.headers.map((header) => {
        const move = headerMove(step.id, header);
        if (!move) return header;
        if (!environment) throw new CredentialNeedsEnvironmentError(step.id, { kind: "header", name: header.name });
        const valueName = nameFor(`${slug(move.header)}_${step.id}`);
        moves.push({ stepId: step.id, location: { kind: "header", name: header.name }, valueName, value: move.value });
        headersChanged = true;
        return { name: header.name, value: move.replacement(valueName) };
      });
      const withHeaders = headersChanged ? { ...step, headers } : step;
      const before = moves.length;
      const moved = movePasswordFields(withHeaders, nameFor, moves);
      if (moves.length > before && !environment) throw new CredentialNeedsEnvironmentError(step.id, moves[before].location);
      return moved;
    }),
  }));

  if (moves.length === 0) return { plan, moves };
  const secretNames = [...new Set([...plan.secretNames, ...moves.map((move) => move.valueName)])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { plan: { ...plan, chains, secretNames }, moves };
}
