import { collectionStepLabel, type CollectionReferenceLocation } from "@apipilot/shared-domain";
import type { Collection } from "postman-collection";
import { convertedCaptures, bindReferences, type DraftReference, type DraftStep } from "../../collection/bindCollectionPlan";
import { classifyCredentialRequests } from "../../collection/credentialRequests";
import { baseUrlVariableOf, BASE_URL, withBaseUrl } from "../../collection/collectionValues";
import { readCollectionRequests, type CollectionRequestSource, type CollectionScript } from "../../collection/readCollectionRequests";
import { recognizeScript, type ScriptRecognition } from "../../collection/recognizeScript";
import { intersectStatuses } from "../../collection/statusAssertions";
import { SUPPORTED_DYNAMIC_VARIABLES } from "../../collection/dynamicValues";
import type { AuthTemplate, RequestTemplate } from "../../plan/stepRequest";
import type { SeedInput, SeedStep } from "./assembleSeededPlan";
import { basicAuthItem } from "./seedFromSpecification";
import { referenceName, toChainRequest, withValidReferences } from "./toChainStep";

/**
 * Seeding from a stored collection (specs/037-request-chain-performance FR-024, FR-025; research
 * R17). The collection is read, never run: requests through the `postman-collection` SDK, test
 * scripts as text against AP-036's closed grammar (FR-005). Each top-level folder becomes a chain,
 * and the requests at the root form one, ordered by their first selected request. Each step sends
 * what the functional run sends, with inherited auth written as a header or query row. Recognised
 * setters become extractors, recognised status assertions the expected statuses, and a request whose
 * captured values feed only later requests' authentication runs once before load (AP-036 FR-027,
 * classified by use only). Everything else is listed in the seeding report with its source.
 */
const ROOT = "\u0000root";

function authTemplate(source: CollectionRequestSource): AuthTemplate {
  const fields = source.auth.fields;
  if (source.auth.type === "bearer") return { kind: "bearer", token: fields.token ?? "" };
  if (source.auth.type === "basic") return { kind: "basic", username: fields.username ?? "", password: fields.password ?? "" };
  if (source.auth.type === "apikey") return { kind: "apikey", in: fields.in === "query" ? "query" : "header", key: fields.key ?? "", value: fields.value ?? "" };
  return { kind: "none" };
}

function templateOf(source: CollectionRequestSource, baseUrlVariable: string | null): RequestTemplate {
  const template: RequestTemplate = {
    method: source.method,
    url: withBaseUrl(source.url, baseUrlVariable),
    headers: source.headers,
    auth: authTemplate(source),
  };
  if (source.body?.kind === "form") return { ...template, body: source.body.pairs.map((pair) => `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`).join("&"), bodyKind: "form" };
  if (source.body) return { ...template, body: source.body.text, bodyKind: source.body.kind };
  return template;
}

/** Each `{{name}}` an earlier request's capture may fill, with where it is used (as AP-036's `referencesOf`). */
function referencesOf(step: SeedStep): Map<string, DraftReference> {
  const references = new Map<string, DraftReference>();
  const add = (text: string, location: CollectionReferenceLocation, authorization: boolean) => {
    for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const name = match[1];
      if (name === BASE_URL || name.startsWith("$")) continue;
      const entry = references.get(name) ?? { name, locations: new Set<CollectionReferenceLocation>(), authOnly: true };
      entry.locations.add(location);
      entry.authOnly = entry.authOnly && authorization;
      references.set(name, entry);
    }
  };
  add(step.request.url, "url", false);
  for (const row of step.request.query) add(`${row.name} ${row.value}`, "url", false);
  for (const header of step.request.headers) add(header.value, "header", header.name.toLowerCase() === "authorization");
  if (step.request.body.kind === "raw") add(step.request.body.text, "body", false);
  if (step.request.body.kind === "form") for (const field of step.request.body.fields) add(`${field.name} ${field.value}`, "body", false);
  return references;
}

function line(value: number | null): string {
  return value === null ? "" : ` (line ${value})`;
}

export function seedFromCollection(stored: { id: string; name: string }, collection: Collection, orderedRequestIds: readonly string[], name: string, now: string): Omit<SeedInput, "environment"> {
  const reads = readCollectionRequests(collection, orderedRequestIds, { supportedDynamicVariables: SUPPORTED_DYNAMIC_VARIABLES });
  const items: SeedInput["report"]["items"] = [];
  const kept: CollectionRequestSource[] = [];
  for (const read of reads) {
    if (read.kind === "request") {
      kept.push(read.source);
      continue;
    }
    const label = collectionStepLabel(read.leftOut);
    const unsupported = read.leftOut.reason === "unsupported-dynamic-variable" || read.leftOut.reason === "unknown-dynamic-variable";
    items.push({
      kind: unsupported ? "unsupported-dynamic-variable" : "left-out-request",
      sourceLabel: label,
      detail: unsupported ? `The request uses ${read.leftOut.detail ?? "a dynamic variable"}, which ApiPilot does not generate, so it was left out.` : `Left out: ${read.leftOut.reason}${read.leftOut.detail ? ` (${read.leftOut.detail})` : ""}.`,
    });
  }

  const recognitions = new Map<string, ScriptRecognition>();
  const recognize = (script: CollectionScript): ScriptRecognition => {
    const key = `${script.ownerKey}\u0000${script.event}\u0000${script.text}`;
    let recognition = recognitions.get(key);
    if (!recognition) {
      recognition = recognizeScript(script.text);
      recognitions.set(key, recognition);
    }
    return recognition;
  };

  const baseUrlVariable = baseUrlVariableOf(kept.map((source) => source.url));
  const reported = new Set<string>();
  const secretNames: string[] = [];
  const steps = kept.map((source, index) => {
    const label = collectionStepLabel(source.ref);
    for (const script of source.scripts) {
      const ownerKey = `${script.ownerKey}\u0000${script.event}`;
      if (script.event === "prerequest") {
        if (script.text.trim() !== "" && !reported.has(ownerKey)) items.push({ kind: "pre-request-script", sourceLabel: script.owner.kind === "request" ? label : script.owner.kind === "folder" ? script.owner.folderName : "The collection", detail: "The pre-request script was not carried over; it never runs in a performance test." });
        reported.add(ownerKey);
        continue;
      }
      if (reported.has(ownerKey)) continue;
      reported.add(ownerKey);
      for (const finding of recognize(script).findings) {
        items.push({ kind: "unrecognised-statement", sourceLabel: script.owner.kind === "request" ? label : script.owner.kind === "folder" ? script.owner.folderName : "The collection", detail: `A test statement was not carried over${line(finding.line)}: ${finding.kind}.` });
      }
    }
    const converted = toChainRequest(templateOf(source, baseUrlVariable), `${source.auth.owner?.kind === "folder" ? source.auth.owner.folderName : "collection"}_basic`);
    if (converted.basicValueName) {
      secretNames.push(converted.basicValueName);
      items.push(basicAuthItem(label, converted.basicValueName));
    }
    const captures = convertedCaptures(source.scripts, recognize).captures;
    const statuses = intersectStatuses(source.scripts.filter((script) => script.event === "test").flatMap((script) => recognize(script).assertions.map((assertion) => assertion.codes)));
    const step: SeedStep = {
      name: source.ref.name || label,
      request: converted.request,
      expectedStatuses: statuses,
      extractors: captures.map((capture) => ({ name: referenceName(capture.name), source: capture.source.kind === "body" ? { kind: "body", path: capture.source.path } : { kind: "header", name: capture.source.name } })),
      runs: "every-iteration",
      source: { kind: "collection", collectionId: stored.id, collectionName: stored.name, itemId: source.ref.itemId, label },
    };
    return { step, draft: { id: `r${index}`, itemId: source.ref.itemId, captures: captures.map((capture) => ({ ...capture, name: referenceName(capture.name) })), references: new Map() } as DraftStep, folder: source.folderIds[0] ?? ROOT, folderName: source.ref.folderPath[0] ?? stored.name };
  });

  // AP-036 FR-027 (research R8): a request whose captured values feed only later requests' auth runs once before load.
  const drafts = steps.map((entry) => ({ ...entry.draft, references: referencesOf(entry.step) }));
  const credential = classifyCredentialRequests(drafts, bindReferences(drafts, new Map()));
  for (const entry of steps) if (credential.has(entry.draft.id)) entry.step.runs = "once-before-load";

  const chains = new Map<string, { name: string; steps: SeedStep[] }>();
  for (const entry of steps) {
    const chain = chains.get(entry.folder) ?? { name: entry.folder === ROOT ? stored.name : entry.folderName, steps: [] };
    chain.steps.push(entry.step);
    chains.set(entry.folder, chain);
  }
  return {
    name,
    chains: [...chains.values()].map((chain) => ({ ...chain, steps: chain.steps.map((step) => ({ ...step, request: { ...step.request, url: withValidReferences(step.request.url) } })) })),
    secretNames,
    now,
    report: { source: { kind: "collection", collectionId: stored.id, collectionName: stored.name }, seededAt: now, items },
  };
}
