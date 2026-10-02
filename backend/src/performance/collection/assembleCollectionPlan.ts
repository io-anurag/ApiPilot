import type {
  BodyPathSegment,
  Capture,
  CollectionAddedBinding,
  CollectionPlanInfo,
  CollectionReferenceLocation,
  ConversionFinding,
  CredentialRequestView,
  EnvironmentTier,
  ExpectedStatus,
  FindingOwner,
  LeftOutRequest,
  LoadProfile,
  PerformanceJourney,
  PerformancePlan,
  PerformanceStep,
  PerformanceThreshold,
  PreviewReference,
  StepAuth,
  UserSuppliedValueRequirement,
  ValueBinding,
} from "@apipilot/shared-domain";
import { parseStoredCollection } from "../../externalCollections/uploadedCollectionParsing";
import { createLogger } from "../../logger";
import { compareCodeUnits } from "../../postman/ordering";
import type { DynamicToken, RenderedTokenSource } from "../k6/renderScript";
import { finalizePlan } from "../plan/buildPlan";
import { canonicalJson, collectionJourneyIdFor, collectionStepIdFor, sha256Hex } from "../plan/identifiers";
import { startingProfile } from "../plan/loadProfiles";
import type { StepCapture } from "../plan/planStepRequest";
import { captureKeyOf, templateReferences, type AuthTemplate, type RequestTemplate } from "../plan/stepRequest";
import { bindReferences, convertedCaptures, type AddedBinding, type DraftReference, type DraftStep, type StepBinding } from "./bindCollectionPlan";
import {
  BASE_URL,
  baseUrlVariableOf,
  credentialHeaderRule,
  isLiteral,
  leadingVariable,
  literalAuthName,
  literalHeaderName,
  literalHost,
  LITERAL_PREFIX,
  renderFormBody,
  urlPathReferences,
  withBaseUrl,
} from "./collectionValues";
import { classifyCredentialRequests, credentialDependencies } from "./credentialRequests";
import { DYNAMIC_TOKEN_PREFIX, rewriteDynamicValues, type DynamicCounter } from "./dynamicValues";
import { collectionReferences, pathOfUrl, readCollectionRequests, type CollectionRequestSource, type CollectionScript } from "./readCollectionRequests";
import { recognizeScript, type ScriptRecognition } from "./recognizeScript";
import { intersectStatuses } from "./statusAssertions";

const logger = createLogger("performance.collectionPlan");

/**
 * AP-036 (specs/036-collection-performance-test research R6 to R15, R19): a collection plan, built
 * from a snapshot of the stored collection and the engineer's choices. Pure over its inputs: the
 * same collection content, selection, order and choices always give the same plan and the same
 * renderer inputs (FR-023). Nothing here reads a variable value; literal credentials are replaced
 * by the names the plan lists (FR-015).
 */
export const MAX_COLLECTION_STEPS = 100;
export const TOKEN_KEY_PREFIX = "apipilot_t_";

export interface CollectionSource {
  id: string;
  name: string;
  tier: EnvironmentTier;
  /** The stored collection JSON the plan is built from. */
  json: string;
}

/** Data-model `CollectionPlanChoices`: what the engineer chose; everything else is derived. */
export interface CollectionPlanChoices {
  orderedRequestIds: string[];
  excludedRequestIds: string[];
  /** The journey's step order, as the last plan had it; new steps keep their run-order place. */
  stepOrder?: string[];
  /** Expected-status codes the engineer set, by step or credential-request id. */
  expectedStatusCodes: Map<string, string[]>;
  thinkTimeMs: number;
  loadProfile: LoadProfile;
  thresholds: PerformanceThreshold[];
  /** FR-019: captures the engineer added, by step id, `origin: {kind: "user"}`. */
  addedCaptures: Map<string, Capture[]>;
  /** FR-019: references the engineer bound to an earlier capture, by step id. */
  addedBindings: Map<string, AddedBinding[]>;
  /** Research R14: the conversion digest the engineer marked reviewed. */
  reviewedConversionDigest: string | null;
}

export function defaultCollectionChoices(orderedRequestIds: readonly string[]): CollectionPlanChoices {
  return {
    orderedRequestIds: [...orderedRequestIds],
    excludedRequestIds: [],
    expectedStatusCodes: new Map(),
    thinkTimeMs: 0,
    loadProfile: startingProfile("smoke"),
    thresholds: [],
    addedCaptures: new Map(),
    addedBindings: new Map(),
    reviewedConversionDigest: null,
  };
}

/** One step or credential request as the script and the preview read it. */
export interface AssembledRequest {
  step: PerformanceStep;
  credential: boolean;
  template: RequestTemplate;
  needs: string[];
  captures: StepCapture[];
  tokenSchemes: string[];
  dependsOn: string[];
  /** Every `{{name}}` of the template, by where its value comes from. Never a value. */
  references: Map<string, PreviewReference>;
  /** The step's own `{{name}}`s an earlier capture may fill (FR-019), sorted. */
  referenceNames: string[];
}

/** Research R12, R17: where a literal credential sits in the collection. Never the literal. */
export type LiteralLocation = { kind: "auth"; itemId: string; field: string } | { kind: "header"; itemId: string; header: string };

export interface CollectionAssembly {
  plan: PerformancePlan;
  /** Journey steps and credential requests, by id. */
  requests: Map<string, AssembledRequest>;
  tokenSources: RenderedTokenSource[];
  dynamic: DynamicToken[];
  literals: Map<string, LiteralLocation>;
  /** The added bindings that still apply. */
  appliedBindings: CollectionAddedBinding[];
  /** Credential requests and journey steps in the order bindings were made. */
  order: string[];
}

export interface AssembleOptions {
  supportedDynamicVariables: ReadonlySet<string>;
  /** Research R13: the stored collection's state, derived when the plan is read. */
  collectionState?: CollectionPlanInfo["collectionState"];
}

export function tokenKeyOf(credentialStepId: string, captureName: string): string {
  return `${TOKEN_KEY_PREFIX}${credentialStepId.replace(/^s_/, "")}_${captureName}`;
}

interface Draft {
  id: string;
  source: CollectionRequestSource;
  template: RequestTemplate;
  references: Map<string, DraftReference>;
  captures: Capture[];
  converted: ReturnType<typeof convertedCaptures>;
  collectionCodes: string[];
  assertionSets: string[][];
  /** Names that fill an auth field or a credential header (FR-014). */
  secretNames: Set<string>;
  credentialHeaders: { header: string; rule: string }[];
}

const OWNER_RANK: Readonly<Record<FindingOwner["kind"], number>> = { collection: 0, folder: 1, request: 2 };

function segmentsData(segments: readonly BodyPathSegment[]): (string | number)[] {
  return segments.map((segment) => ("index" in segment ? segment.index : segment.field));
}

function stepCapture(key: string, capture: Capture): StepCapture {
  return { key, name: capture.name, source: capture.source.kind === "body" ? { body: segmentsData(capture.source.segments) } : { header: capture.source.name } };
}

function uniqueSorted(names: Iterable<string>): string[] {
  return [...new Set(names)].sort(compareCodeUnits);
}

function contentTypeDefault(source: CollectionRequestSource): string | null {
  const body = source.body;
  if (!body) return null;
  if (body.kind === "form") return "application/x-www-form-urlencoded";
  if (body.language === "json") return "application/json";
  if (body.language === "text") return "text/plain";
  return null;
}

/**
 * The request as the script sends it, before bindings (FR-003, R11, R12): the base-URL variable as
 * `{{baseUrl}}`, literal credentials replaced by their names, a form body encoded, and the
 * `Content-Type` Postman adds for a body of a stated language.
 */
function templateOf(source: CollectionRequestSource, baseUrlVariable: string | null, literals: Map<string, LiteralLocation>) {
  const secretNames = new Set<string>();
  const credentialHeaders: { header: string; rule: string }[] = [];
  const markSecret = (text: string) => collectionReferences(text).forEach((name) => secretNames.add(name));
  const headers = source.headers.map((header) => {
    const rule = credentialHeaderRule(header.key);
    if (!rule) return header;
    credentialHeaders.push({ header: header.key, rule });
    if (!isLiteral(header.value)) {
      markSecret(header.value);
      return header;
    }
    const name = literalHeaderName(source.ref.itemId, header.key);
    literals.set(name, { kind: "header", itemId: source.ref.itemId, header: header.key });
    return { key: header.key, value: `{{${name}}}` };
  });
  const contentType = contentTypeDefault(source);
  if (contentType && !headers.some((header) => header.key.toLowerCase() === "content-type")) headers.push({ key: "Content-Type", value: contentType });

  const field = (name: string, text: string) => {
    if (!isLiteral(text)) {
      markSecret(text);
      return text;
    }
    const literal = literalAuthName(source.auth.owner, name);
    literals.set(literal, { kind: "auth", itemId: source.ref.itemId, field: name });
    return `{{${literal}}}`;
  };
  const fields = source.auth.fields;
  let auth: AuthTemplate = { kind: "none" };
  if (source.auth.type === "bearer") auth = { kind: "bearer", token: field("token", fields.token ?? "") };
  if (source.auth.type === "basic") auth = { kind: "basic", username: field("username", fields.username ?? ""), password: field("password", fields.password ?? "") };
  if (source.auth.type === "apikey") auth = { kind: "apikey", in: fields.in === "query" ? "query" : "header", key: fields.key ?? "", value: field("value", fields.value ?? "") };

  const template: RequestTemplate = { method: source.method, url: withBaseUrl(source.url, baseUrlVariable), headers, auth };
  if (source.body?.kind === "form") {
    template.body = renderFormBody(source.body.pairs);
    template.bodyKind = "form";
  } else if (source.body) {
    template.body = source.body.text;
    template.bodyKind = source.body.kind;
  }
  return { template, secretNames, credentialHeaders };
}

/** Every `{{name}}` a request uses, without the leading base-URL variable. */
function referencedNames(request: CollectionRequestSource, leading: string | null): string[] {
  const texts = [
    leading === null ? request.url : request.url.slice(leading.length + 4),
    ...request.headers.flatMap((header) => [header.key, header.value]),
    ...Object.values(request.auth.fields),
    ...(request.body?.kind === "form" ? request.body.pairs.flatMap((pair) => [pair.key, pair.value]) : request.body ? [request.body.text] : []),
  ];
  return texts.flatMap(collectionReferences);
}

/** A name another step's capture may fill: not the base URL, a literal's name or a dynamic variable. */
function isBindable(name: string): boolean {
  return name !== BASE_URL && !name.startsWith(LITERAL_PREFIX) && !name.startsWith("$");
}

function authTexts(auth: AuthTemplate): string[] {
  if (auth.kind === "bearer") return [auth.token];
  if (auth.kind === "basic") return [auth.username, auth.password];
  if (auth.kind === "apikey") return [auth.key, auth.value];
  return [];
}

function referencesOf(template: RequestTemplate): Map<string, DraftReference> {
  const references = new Map<string, DraftReference>();
  const add = (text: string, location: CollectionReferenceLocation, authorization: boolean) => {
    for (const name of collectionReferences(text)) {
      if (!isBindable(name)) continue;
      const entry = references.get(name) ?? { name, locations: new Set<CollectionReferenceLocation>(), authOnly: true };
      entry.locations.add(location);
      entry.authOnly = entry.authOnly && (location === "auth" || authorization);
      references.set(name, entry);
    }
  };
  add(template.url, "url", false);
  for (const header of template.headers) {
    const authorization = header.key.toLowerCase() === "authorization";
    add(header.key, "header", authorization);
    add(header.value, "header", authorization);
  }
  if (template.body !== undefined) add(template.body, "body", false);
  for (const text of authTexts(template.auth)) add(text, "auth", false);
  return references;
}

function mapTemplate(template: RequestTemplate, map: (text: string) => string): RequestTemplate {
  const { auth } = template;
  const mappedAuth: AuthTemplate =
    auth.kind === "bearer"
      ? { ...auth, token: map(auth.token) }
      : auth.kind === "basic"
        ? { ...auth, username: map(auth.username), password: map(auth.password) }
        : auth.kind === "apikey"
          ? { ...auth, key: map(auth.key), value: map(auth.value) }
          : auth;
  return {
    ...template,
    url: map(template.url),
    headers: template.headers.map((header) => ({ key: map(header.key), value: map(header.value) })),
    ...(template.body === undefined ? {} : { body: map(template.body) }),
    auth: mappedAuth,
  };
}

function templateNames(template: RequestTemplate): string[] {
  return [template.url, ...template.headers.flatMap((header) => [header.key, header.value]), ...(template.body === undefined ? [] : [template.body]), ...authTexts(template.auth)].flatMap(
    templateReferences,
  );
}

/** The journey's order: the engineer's order for the steps it names, each other step in its run-order place. */
function orderDrafts(drafts: readonly Draft[], stepOrder: readonly string[] | undefined): Draft[] {
  if (!stepOrder || stepOrder.length === 0) return [...drafts];
  const named = new Set(stepOrder);
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const queue = stepOrder.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  return drafts.map((draft) => (named.has(draft.id) ? queue.shift()! : draft));
}

function findingSortKey(finding: ConversionFinding, position: ReadonlyMap<string, number>): [number, number, string, number, string] {
  const first = Math.min(...finding.stepIds.map((id) => position.get(id) ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  const ownerId = finding.owner.kind === "folder" ? finding.owner.folderId : finding.owner.kind === "request" ? finding.owner.itemId : "";
  return [first, OWNER_RANK[finding.owner.kind], ownerId, finding.line ?? 0, finding.kind];
}

function compareFindings(position: ReadonlyMap<string, number>) {
  return (a: ConversionFinding, b: ConversionFinding) => {
    const left = findingSortKey(a, position);
    const right = findingSortKey(b, position);
    return left[0] - right[0] || left[1] - right[1] || compareCodeUnits(left[2], right[2]) || left[3] - right[3] || compareCodeUnits(left[4], right[4]);
  };
}

function statusesOf(codes: readonly string[], collectionCodes: readonly string[]): ExpectedStatus[] {
  const fromCollection = new Set(collectionCodes);
  return codes.map((code) => ({ code, source: fromCollection.has(code) ? "collection" : "user" }));
}

/** Research R14: a digest of what the conversion produced, without the engineer's settings. */
function conversionDigestOf(info: Omit<CollectionPlanInfo, "review" | "collectionState" | "addedBindings" | "excludedRequestIds" | "excludedRequests">, steps: readonly PerformanceStep[], credential: readonly PerformanceStep[]): string {
  const converted = (step: PerformanceStep) => ({
    id: step.id,
    request: step.collectionRequest,
    method: step.method,
    path: step.path,
    captures: (step.captures ?? []).filter((capture) => capture.origin?.kind === "collection-script"),
    bindings: (step.bindings ?? []).filter((binding) => {
      const producer = [...steps, ...credential].find((candidate) => candidate.id === binding.captureStepId);
      return producer?.captures?.some((capture) => capture.name === binding.captureName && capture.origin?.kind === "collection-script");
    }),
  });
  return sha256Hex(
    canonicalJson({
      leftOut: info.leftOut,
      baseUrlVariable: info.baseUrlVariable,
      hosts: info.hosts,
      generatedValueCount: info.generatedValueCount,
      findings: [...info.findings].map((finding) => ({ ...finding, stepIds: [...finding.stepIds].sort(compareCodeUnits) })).sort((a, b) => compareCodeUnits(canonicalJson(a), canonicalJson(b))),
      credentialRequests: credential.map(converted).sort((a, b) => compareCodeUnits(a.id, b.id)),
      steps: steps.map(converted).sort((a, b) => compareCodeUnits(a.id, b.id)),
    }),
  );
}

export function assembleCollectionPlan(source: CollectionSource, choices: CollectionPlanChoices, options: AssembleOptions): CollectionAssembly {
  const collection = parseStoredCollection(source.json);
  const reads = readCollectionRequests(collection, choices.orderedRequestIds, options);
  const readSources = reads.flatMap((read) => (read.kind === "request" ? [read.source] : []));
  const baseUrlVariable = baseUrlVariableOf(readSources.map((read) => read.url));

  // R4, R12: the reasons that need every request's URL first.
  const leftOut: LeftOutRequest[] = [];
  const kept: CollectionRequestSource[] = [];
  for (const read of reads) {
    if (read.kind === "left-out") {
      leftOut.push(read.leftOut);
      continue;
    }
    const request = read.source;
    const leading = leadingVariable(request.url);
    const outFor = (reason: LeftOutRequest["reason"], detail: string) => leftOut.push({ ...request.ref, method: request.method, path: pathOfUrl(request.url), reason, detail });
    if (leading !== null && leading !== baseUrlVariable) outFor("other-host-variable", leading);
    // R12: `{{baseUrl}}` is the environment's base URL; a collection whose base-URL variable has
    // another name cannot also use `baseUrl` for something else.
    else if (baseUrlVariable !== BASE_URL && referencedNames(request, leading).includes(BASE_URL)) outFor("reserved-name", BASE_URL);
    else kept.push(request);
  }
  const excluded = new Set(choices.excludedRequestIds);
  const active = kept.filter((request) => !excluded.has(request.ref.itemId));

  // R5: each script is recognised once per assembly, whichever steps it applies to.
  const recognitions = new Map<string, ScriptRecognition>();
  const recognize = (script: CollectionScript) => {
    const key = `${script.ownerKey}\u0000${script.event}\u0000${script.text}`;
    let recognition = recognitions.get(key);
    if (!recognition) {
      recognition = recognizeScript(script.text);
      recognitions.set(key, recognition);
    }
    return recognition;
  };

  const literals = new Map<string, LiteralLocation>();
  const drafts = active.map((request): Draft => {
    const id = collectionStepIdFor(request.ref.itemId);
    const { template, secretNames, credentialHeaders } = templateOf(request, baseUrlVariable, literals);
    const converted = convertedCaptures(request.scripts, recognize);
    const assertionSets = request.scripts.filter((script) => script.event === "test").flatMap((script) => recognize(script).assertions.map((assertion) => assertion.codes));
    const added = (choices.addedCaptures.get(id) ?? []).filter((capture) => !converted.captures.some((existing) => existing.name === capture.name));
    return {
      id,
      source: request,
      template,
      references: referencesOf(template),
      captures: [...converted.captures, ...added],
      converted,
      collectionCodes: intersectStatuses(assertionSets),
      assertionSets,
      secretNames,
      credentialHeaders,
    };
  });

  const ordered = orderDrafts(drafts, choices.stepOrder);
  const draftSteps: DraftStep[] = ordered.map((draft) => ({ id: draft.id, itemId: draft.source.ref.itemId, captures: draft.captures, references: draft.references }));
  const bindings = bindReferences(draftSteps, choices.addedBindings);
  const credential = classifyCredentialRequests(draftSteps, bindings);
  const credentialOrder = ordered.filter((draft) => credential.has(draft.id)).map((draft) => draft.id);
  const position = new Map(ordered.map((draft, index) => [draft.id, index]));
  const byId = new Map(ordered.map((draft) => [draft.id, draft]));

  const keyOf = (binding: StepBinding) => (credential.has(binding.captureStepId) ? tokenKeyOf(binding.captureStepId, binding.captureName) : captureKeyOf(binding.captureStepId, binding.captureName));

  // R6, R8: references become capture or token keys; then R9: dynamic variables, credential requests first.
  const bound = new Map(
    ordered.map((draft) => {
      const keys = new Map((bindings.get(draft.id) ?? []).map((binding) => [binding.name, keyOf(binding)]));
      const template = mapTemplate(draft.template, (text) => text.replace(/\{\{([^{}]+)\}\}/g, (match, name: string) => (keys.has(name) ? `{{${keys.get(name)}}}` : match)));
      return [draft.id, template] as const;
    }),
  );
  const counter: DynamicCounter = { tokens: [] };
  for (const draft of [...ordered.filter((draft) => credential.has(draft.id)), ...ordered.filter((draft) => !credential.has(draft.id))]) {
    bound.set(draft.id, rewriteDynamicValues(bound.get(draft.id)!, counter));
  }
  const dynamicKinds = new Map(counter.tokens.map((token) => [token.token, token.kind]));

  const secretNames = new Set(ordered.flatMap((draft) => [...draft.secretNames]));
  const ownNeeds = new Map(
    ordered.map((draft) => [
      draft.id,
      uniqueSorted(templateNames(bound.get(draft.id)!).filter((name) => !name.startsWith(TOKEN_KEY_PREFIX) && !name.startsWith("apipilot_c_") && !name.startsWith(DYNAMIC_TOKEN_PREFIX))),
    ]),
  );

  const requests = new Map<string, AssembledRequest>();
  for (const draft of ordered) {
    const isCredential = credential.has(draft.id);
    const stepBindings = bindings.get(draft.id) ?? [];
    const tokenSchemes = isCredential ? [] : credentialDependencies(draft.id, bindings, credential, credentialOrder);
    const needs = uniqueSorted([...ownNeeds.get(draft.id)!, ...tokenSchemes.flatMap((scheme) => ownNeeds.get(scheme) ?? [])]);
    const codes = choices.expectedStatusCodes.get(draft.id) ?? draft.collectionCodes;
    const authBinding = stepBindings.find((binding) => credential.has(binding.captureStepId) && draft.references.get(binding.name)?.authOnly === true);
    const auth: StepAuth = authBinding
      ? { kind: "chained-login", schemeName: authBinding.captureStepId }
      : { kind: "collection-auth", schemeName: draft.source.auth.type === "none" ? "noauth" : draft.source.auth.type };
    const valueBindings: ValueBinding[] = stepBindings.map((binding) => ({
      target: { kind: "reference", name: binding.name, locations: [...draft.references.get(binding.name)!.locations].sort(compareCodeUnits) },
      captureStepId: binding.captureStepId,
      captureName: binding.captureName,
      state: "active",
    }));
    const path = pathOfUrl(draft.source.url);
    const step: PerformanceStep = {
      id: draft.id,
      operationKey: `${draft.source.method} ${path}`,
      method: draft.source.method,
      path,
      scenarioId: `collection:${draft.source.ref.itemId}`,
      scenarioDescription: draft.source.ref.name,
      scenarioChoice: "collection-request",
      tieBrokenByLowestId: false,
      consumes: [],
      produces: [],
      variableBindings: [],
      dependency: null,
      expectedStatuses: statusesOf(codes, draft.collectionCodes),
      auth,
      requiredValues: needs,
      collectionRequest: draft.source.ref,
      ...(draft.captures.length > 0 ? { captures: draft.captures } : {}),
      ...(valueBindings.length > 0 ? { bindings: valueBindings } : {}),
    };

    const references = new Map<string, PreviewReference>();
    const bindingByKey = new Map(stepBindings.map((binding) => [keyOf(binding), binding]));
    for (const name of new Set(templateNames(bound.get(draft.id)!))) {
      const binding = bindingByKey.get(name);
      if (name.startsWith(DYNAMIC_TOKEN_PREFIX) && dynamicKinds.has(name)) references.set(name, { kind: "generated-value", name, variable: dynamicKinds.get(name)! });
      else if (binding && credential.has(binding.captureStepId)) references.set(name, { kind: "credential", name, schemeName: binding.captureStepId });
      else if (binding) {
        const producer = byId.get(binding.captureStepId)!;
        const capture = producer.captures.find((candidate) => candidate.name === binding.captureName)!;
        const reference = draft.references.get(binding.name)!;
        references.set(name, { kind: "capture", name, captureName: binding.captureName, producerStepId: binding.captureStepId, source: capture.source, secret: reference.locations.has("auth") || draft.secretNames.has(binding.name) });
      } else references.set(name, { kind: "environment", name, secret: name.startsWith(LITERAL_PREFIX) || secretNames.has(name) });
    }

    requests.set(draft.id, {
      step,
      credential: isCredential,
      template: bound.get(draft.id)!,
      needs,
      captures: draft.captures.map((capture) => stepCapture(isCredential ? tokenKeyOf(draft.id, capture.name) : captureKeyOf(draft.id, capture.name), capture)),
      tokenSchemes,
      dependsOn: [...new Set(stepBindings.filter((binding) => !credential.has(binding.captureStepId)).map((binding) => binding.captureStepId))].sort(
        (a, b) => position.get(a)! - position.get(b)!,
      ),
      references,
      referenceNames: [...draft.references.keys()].sort(compareCodeUnits),
    });
  }

  const journeySteps = ordered.filter((draft) => !credential.has(draft.id)).map((draft) => requests.get(draft.id)!.step);
  const credentialSteps = credentialOrder.map((id) => requests.get(id)!.step);

  // FR-014: the values the environment provides, by name.
  const requirements = new Map<string, UserSuppliedValueRequirement>();
  for (const draft of ordered) {
    for (const name of ownNeeds.get(draft.id)!) {
      const source = name === BASE_URL ? "base-url" : name.startsWith(LITERAL_PREFIX) ? "collection-literal" : "collection-variable";
      const existing = requirements.get(name) ?? { name, secret: source === "collection-literal" || (source === "collection-variable" && secretNames.has(name)), neededBySteps: [], source };
      existing.neededBySteps.push(draft.id);
      requirements.set(name, existing);
    }
  }

  // R5, R6, R7, R11, R12, FR-009, FR-010: the review's items.
  const findings: ConversionFinding[] = [];
  const scriptSteps = new Map<string, { script: CollectionScript; stepIds: string[] }>();
  for (const draft of ordered) {
    for (const script of draft.source.scripts) {
      const key = `${script.ownerKey}\u0000${script.event}`;
      const entry = scriptSteps.get(key) ?? { script, stepIds: [] };
      entry.stepIds.push(draft.id);
      scriptSteps.set(key, entry);
    }
  }
  for (const { script, stepIds } of scriptSteps.values()) {
    if (script.event === "prerequest") {
      if (script.text.trim().length > 0) findings.push({ kind: "prerequest-not-converted", owner: script.owner, event: "prerequest", stepIds, line: null, column: null, excerpt: null, detail: null });
      continue;
    }
    for (const finding of recognize(script).findings) findings.push({ ...finding, owner: script.owner, event: "test", stepIds });
  }
  const scopeNotes = new Map<string, ConversionFinding>();
  for (const draft of ordered) {
    for (const superseded of draft.converted.superseded) findings.push({ ...superseded, stepIds: [draft.id] });
    if (draft.assertionSets.length > 0 && draft.collectionCodes.length === 0) {
      findings.push({
        kind: "contradictory-assertions",
        owner: { kind: "request", itemId: draft.source.ref.itemId },
        event: "test",
        stepIds: [draft.id],
        line: null,
        column: null,
        excerpt: null,
        detail: draft.assertionSets.map((set) => set.join("/")).join(" and "),
      });
    }
    for (const capture of draft.converted.captures) {
      const origin = capture.origin;
      if (origin?.kind !== "collection-script" || (origin.scope !== "collectionVariables" && origin.scope !== "globals")) continue;
      const key = canonicalJson({ owner: origin.owner, line: origin.line, name: capture.name });
      const note = scopeNotes.get(key) ?? { kind: "scope-precedence", owner: origin.owner, event: "test", stepIds: [], line: origin.line, column: null, excerpt: null, detail: capture.name };
      note.stepIds.push(draft.id);
      scopeNotes.set(key, note);
    }
    for (const header of draft.credentialHeaders) {
      findings.push({ kind: "credential-header", owner: { kind: "request", itemId: draft.source.ref.itemId }, event: null, stepIds: [draft.id], line: null, column: null, excerpt: null, detail: `${header.header} (${header.rule})` });
    }
  }
  findings.push(...scopeNotes.values());
  const urlNames = ordered.map((draft) => ({ id: draft.id, names: urlPathReferences(draft.source.url).filter((name) => !name.startsWith("$")) })).filter((entry) => entry.names.length > 0);
  if (urlNames.length > 0) {
    findings.push({
      kind: "url-encoding",
      owner: { kind: "collection" },
      event: null,
      stepIds: urlNames.map((entry) => entry.id),
      line: null,
      column: null,
      excerpt: null,
      detail: uniqueSorted(urlNames.flatMap((entry) => entry.names)).join(", "),
    });
  }
  findings.sort(compareFindings(position));

  const credentialRequests: CredentialRequestView[] = credentialSteps.map((step) => ({
    stepId: step.id,
    request: { ...step.collectionRequest!, method: step.method, path: step.path },
    expectedStatuses: step.expectedStatuses,
    captures: step.captures ?? [],
    usedBy: (step.captures ?? [])
      .map((capture) => ({
        captureName: capture.name,
        stepIds: ordered.filter((draft) => (bindings.get(draft.id) ?? []).some((binding) => binding.captureStepId === step.id && binding.captureName === capture.name)).map((draft) => draft.id),
      }))
      .filter((use) => use.stepIds.length > 0),
    requiredValues: ownNeeds.get(step.id)!,
  }));

  const appliedBindings: CollectionAddedBinding[] = ordered
    .flatMap((draft) => (bindings.get(draft.id) ?? []).filter((binding) => binding.addedByUser).map((binding) => ({ stepId: draft.id, name: binding.name, captureStepId: binding.captureStepId, captureName: binding.captureName })))
    .sort((a, b) => compareCodeUnits(a.stepId, b.stepId) || compareCodeUnits(a.name, b.name));

  const infoBase = {
    collectionId: source.id,
    collectionName: source.name,
    collectionTier: source.tier,
    collectionDigest: sha256Hex(source.json),
    orderedRequestIds: [...choices.orderedRequestIds],
    leftOut,
    credentialRequests,
    findings,
    baseUrlVariable,
    hosts: uniqueSorted(ordered.flatMap((draft) => literalHost(draft.source.url) ?? [])),
    generatedValueCount: counter.tokens.length,
  };
  const conversionDigest = conversionDigestOf(infoBase, journeySteps, credentialSteps);
  const collectionInfo: CollectionPlanInfo = {
    ...infoBase,
    collectionState: options.collectionState ?? "current",
    excludedRequestIds: uniqueSorted(choices.excludedRequestIds.filter((id) => kept.some((request) => request.ref.itemId === id))),
    excludedRequests: kept.filter((request) => excluded.has(request.ref.itemId)).map((request) => ({ ...request.ref, method: request.method, path: pathOfUrl(request.url) })),
    addedBindings: appliedBindings,
    review: { reviewed: choices.reviewedConversionDigest === conversionDigest, conversionDigest },
  };

  const journeys: PerformanceJourney[] =
    journeySteps.length === 0 ? [] : [{ id: collectionJourneyIdFor(source.id), source: { kind: "collection", collectionId: source.id, collectionName: source.name }, steps: journeySteps }];
  const stepIds = new Set(journeySteps.map((step) => step.id));
  const finalized = finalizePlan({
    source: "collection",
    excludedOperationKeys: [],
    omitted: [],
    journeys,
    thinkTimeMs: choices.thinkTimeMs,
    loadProfile: choices.loadProfile,
    thresholds: choices.thresholds.filter((threshold) => threshold.scope.kind === "run" || stepIds.has(threshold.scope.stepId)),
    userSuppliedValues: [...requirements.values()].sort((a, b) => compareCodeUnits(a.name, b.name)),
    uniqueValueFields: [],
    upstreamFingerprint: sha256Hex(canonicalJson({ collectionDigest: infoBase.collectionDigest, orderedRequestIds: choices.orderedRequestIds })),
    credentialProducerOperationKeys: [],
    bodyEdits: [],
    bodyEditNotices: [],
    discardedBodyEdits: [],
    parameterEdits: [],
    discardedParameterEdits: [],
    collection: collectionInfo,
  });
  // R8: a credential request needs an expected status too, before the journey's steps.
  const plan: PerformancePlan = {
    ...finalized,
    stepsNeedingExpectedStatus: [...credentialSteps.filter((step) => step.expectedStatuses.length === 0).map((step) => step.id), ...finalized.stepsNeedingExpectedStatus],
  };

  const tokenSources: RenderedTokenSource[] = credentialOrder.map((id) => {
    const request = requests.get(id)!;
    return { scheme: id, kind: "collection-request", request: request.template, needs: request.needs, captures: request.captures, expected: request.step.expectedStatuses.map((status) => status.code) };
  });

  logger.info("collection_plan_assembled", {
    collectionPlanSteps: journeySteps.length,
    leftOutCount: leftOut.length,
    findingCount: findings.length,
    credentialRequestCount: credentialSteps.length,
  });
  return { plan, requests, tokenSources, dynamic: counter.tokens, literals, appliedBindings, order: ordered.map((draft) => draft.id) };
}
