import type {
  ApiModel,
  ApiOperation,
  ArtifactVariable,
  ExportFailure,
  ExportOutcome,
  GenerationLimitation,
  PostmanAuth,
  PostmanCollection,
  PostmanFolder,
  PostmanRequestItem,
  SecurityScenarioContent,
  TestScenario,
} from "@apipilot/shared-domain";
import { POSTMAN_COLLECTION_SCHEMA, TAXONOMY_EDITION } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { operationKeyOf } from "../securityLab/analysis/effectiveSecurity";
import { getCategory } from "../securityLab/registry/categories";
import { contentHashOf } from "../securityLab/scenarios/scenarioIdentity";
import { applyRequestMutations, type MutableRequest } from "../securityLab/scenarios/requestMutations";
import { cloneRequest } from "../testDesign/requestHelpers";
import { baseUrlVariable } from "./artifactVariables";
import { mapOperationAuth, planSchemeVariables } from "./authMapping";
import { buildEnvironment } from "./environment";
import { sanitizeFolderName } from "./folders";
import { collectionIdForScenarios } from "./identifiers";
import { compareCodeUnits } from "./ordering";
import { renderReadme } from "./readme";
import { buildRequestItem } from "./requestItem";
import { applyAuthOverlay, ownedResourceVariableName } from "./securityOverlay";
import { securityAssertions } from "./securityAssertionScripts";
import { validateCollection } from "./validateCollection";

const logger = createLogger("postman.generateSecurityCollection");

/**
 * Turns approved security scenario versions into a Postman collection (specs/057 contracts/postman-security-amendment.md,
 * FR-063, SC-004, SC-009, SC-014). It is an additive sibling of `generateCollection`: it reuses the same item builder,
 * auth mapping, identifiers, environment, README and validator, and changes none of them, so every existing export is
 * byte-for-byte what it was.
 *
 * Only an **approved version whose approval still matches its content** is exported. Credentials are variables only: a
 * scenario that sends as another identity or with an expired credential points at secret variables the person fills
 * in, and nothing resembling a credential value is ever written. A scenario that cannot be expressed faithfully is not
 * approximated: it is left out of the collection and listed as a limitation with its id and the reason. Deterministic
 * and AI-free: the same approved set gives an equivalent collection and environment.
 */

export interface ApprovedSecurityVersion {
  readonly scenarioId: string;
  readonly version: number;
  /** The content hash stored with the version. */
  readonly contentHash: string;
  /** The content hash the approval was given for. */
  readonly approvedContentHash: string;
  readonly content: SecurityScenarioContent;
}

export interface SecurityExportOptions {
  readonly baseUrl?: string;
  readonly collectionName?: string;
  /** The specification revision the scenarios were generated from, stated in each request's description. */
  readonly specificationRevision?: string;
}

const DEFAULT_COLLECTION_NAME = "ApiPilot security tests";
const PROBE_METHODS: ReadonlySet<string> = new Set(["HEAD", "OPTIONS", "TRACE"]);

function failure(code: ExportFailure["code"], message: string, problems?: string[]): ExportOutcome {
  return { ok: false, failure: { code, message, ...(problems ? { problems } : {}) } };
}

function dedupeVariables(variables: ArtifactVariable[]): ArtifactVariable[] {
  const byName = new Map<string, ArtifactVariable>();
  for (const variable of variables) {
    const existing = byName.get(variable.name);
    if (!existing || (existing.value === "" && variable.value !== "")) byName.set(variable.name, variable);
  }
  return [...byName.values()].sort((a, b) => compareCodeUnits(a.name, b.name));
}

function describe(version: ApprovedSecurityVersion, options: SecurityExportOptions): string {
  const { content } = version;
  const taxonomy = content.taxonomy.map((entry) => `${entry.id} (${entry.relation})`).join(", ");
  return [
    `Security Lab scenario ${version.scenarioId}, version ${version.version}.`,
    `Taxonomy ${TAXONOMY_EDITION}: ${taxonomy}.`,
    `Expected: ${content.expected.statement}`,
    `Produced by Security Lab${options.specificationRevision ? `, specification revision ${options.specificationRevision}` : ""}.`,
  ].join("\n");
}

function limitation(kind: GenerationLimitation["kind"], version: ApprovedSecurityVersion, message: string): GenerationLimitation {
  return { kind, scenarioId: version.scenarioId, location: version.content.operationKey, message };
}

/** The scenario as the shared item builder understands it. Assertions are added afterwards from the security templates. */
function viewOf(version: ApprovedSecurityVersion, request: MutableRequest): TestScenario {
  return {
    id: `${version.scenarioId}-v${version.version}`,
    operationPath: version.content.operationPath,
    operationMethod: request.method,
    // Unused here: the request name, folder and order are Security Lab's own. The type needs a value.
    category: "positive",
    request: { pathParameters: request.pathParameters, queryParameters: request.queryParameters, headers: request.headers, ...(request.body === undefined ? {} : { body: request.body }) },
    assertions: [],
    provenance: { source: "RULE", rule: version.content.provenance.ruleId ?? "security-lab", description: version.content.title, duplicateOfRules: [] },
  };
}

function credentialNamesOf(variables: readonly ArtifactVariable[]): Set<string> {
  return new Set(variables.filter((variable) => variable.secret).map((variable) => variable.name));
}

/** OAuth 2 operations are sent as a bearer token the person supplies, as a run does, so no token-fetch request is needed. */
function asBearerTokenAuth(auth: PostmanAuth | undefined): { auth: PostmanAuth | undefined; variables: ArtifactVariable[] } {
  if (auth?.type !== "oauth2") return { auth, variables: [] };
  return {
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }] },
    variables: [{ name: "accessToken", purpose: "OAuth 2 access token you obtained yourself. ApiPilot does not perform the OAuth flow.", secret: true, value: "" }],
  };
}

export function generateSecurityCollection(apiModel: ApiModel, approved: readonly ApprovedSecurityVersion[], options: SecurityExportOptions = {}): ExportOutcome {
  const startedAt = Date.now();
  if (approved.length === 0) return failure("empty_approved_set", "There are no approved security scenarios, so there is nothing to export. Approve at least one scenario first.");

  for (const version of approved) {
    if (contentHashOf(version.content) !== version.contentHash || version.approvedContentHash !== version.contentHash) {
      return failure("unapproved_version", `Scenario ${version.scenarioId} version ${version.version} is not approved as it now stands, so it was not exported. Review and approve it again.`);
    }
  }

  const operations = new Map<string, ApiOperation>(apiModel.operations.map((operation) => [operationKeyOf(operation), operation]));
  for (const version of approved) {
    if (!operations.has(version.content.operationKey)) {
      return failure("unknown_operation", `A scenario references the operation "${version.content.operationKey}", which the specification does not contain.`);
    }
  }

  const ordered = [...approved].sort(
    (a, b) =>
      compareCodeUnits(a.content.categoryId, b.content.categoryId) ||
      compareCodeUnits(a.content.operationKey, b.content.operationKey) ||
      compareCodeUnits(a.scenarioId, b.scenarioId) ||
      a.version - b.version,
  );

  const plan = planSchemeVariables(apiModel.securitySchemes);
  const authByOperation = new Map<string, { auth: PostmanAuth | undefined; variables: ArtifactVariable[]; limitations: GenerationLimitation[] }>();
  const limitations: GenerationLimitation[] = [];
  const variables: ArtifactVariable[] = [baseUrlVariable(options.baseUrl ?? "")];
  const folders = new Map<string, PostmanRequestItem[]>();
  const exportedIds: string[] = [];

  for (const version of ordered) {
    const { content } = version;
    const operation = operations.get(content.operationKey) as ApiOperation;

    if (content.mutations.some((mutation) => mutation.kind === "request.repeat")) {
      limitations.push(limitation("security-repeat-not-expressible", version, "This scenario repeats one request to see whether a rate limit engages. A collection item sends one request, so it is not exported."));
      continue;
    }
    if (content.conditions.some((condition) => condition.kind === "persisted.field-unchanged")) {
      limitations.push(limitation("security-persisted-state-not-expressible", version, "This scenario checks that a property was not stored, which needs a follow-up read this export cannot express, so it is not exported."));
      continue;
    }
    const assertions = securityAssertions(content.conditions);
    if (assertions.notExpressed.length > 0) {
      const kinds = [...new Set(assertions.notExpressed.map((condition) => condition.kind))].join(", ");
      limitations.push(
        limitation(
          "security-condition-not-expressible",
          version,
          assertions.event
            ? `Some expected behavior has no assertion template here (${kinds}), so the request is exported with its other assertions only.`
            : `Its expected behavior has no assertion template here (${kinds}), and a request with no assertion proves nothing, so it is not exported.`,
        ),
      );
    }
    if (!assertions.event) continue;

    // Value-changing mutations first, by the same code a run uses.
    const base = cloneRequest(content.baseRequest);
    const request: MutableRequest = { pathParameters: base.pathParameters, queryParameters: base.queryParameters, headers: base.headers, body: base.body, method: content.operationMethod.toUpperCase() };
    const applied = applyRequestMutations(request, operation, content.mutations, {
      pathIdValue: (mutation) => {
        const name = ownedResourceVariableName(mutation.ownerIdentity, mutation.parameter);
        variables.push({ name, purpose: `The "${mutation.parameter}" of a resource owned by the "${mutation.ownerIdentity}" identity. Supply a real id from your test data.`, secret: false, value: "" });
        return `{{${name}}}`;
      },
    });
    if (!applied.ok) return failure("collection_validation_failed", "A security scenario could not be built from the current specification and was not exported.", [`${version.scenarioId}: ${applied.message}`]);
    if (PROBE_METHODS.has(request.method)) request.body = undefined;

    let operationAuth = authByOperation.get(content.operationKey);
    if (!operationAuth) {
      const mapped = mapOperationAuth(operation, apiModel.securitySchemes, plan);
      const bearer = asBearerTokenAuth(mapped.auth);
      operationAuth = { auth: bearer.auth, variables: [...mapped.variables, ...bearer.variables], limitations: mapped.limitations };
      authByOperation.set(content.operationKey, operationAuth);
      limitations.push(...operationAuth.limitations);
      variables.push(...operationAuth.variables);
    }

    const category = getCategory(content.categoryId);
    const built = buildRequestItem({ scenario: viewOf(version, request), operation, requestName: `[${category.name}] ${content.title}`, auth: operationAuth.auth });
    // The shared builder reports "no expected outcome" for a scenario with no assertions; these have their own, below.
    limitations.push(...built.limitations.filter((entry) => entry.kind !== "no-expected-outcome"));
    variables.push(...built.variables);

    const credentials = credentialNamesOf([...built.variables, ...operationAuth.variables]);
    const overlay = applyAuthOverlay(built.item, content.mutations, credentials);
    variables.push(...overlay.variables);

    const item: PostmanRequestItem = {
      ...overlay.item,
      request: { ...overlay.item.request, description: describe(version, options) },
      event: [assertions.event],
      // The request traces to the scenario itself; its id also carries the version.
      provenance: { scenarioId: version.scenarioId },
    };
    const folder = sanitizeFolderName(category.name);
    folders.set(folder, [...(folders.get(folder) ?? []), item]);
    exportedIds.push(`${version.scenarioId}-v${version.version}`);
  }

  if (exportedIds.length === 0 && limitations.length === 0) return failure("empty_approved_set", "Nothing could be exported.");

  const collectionName = options.collectionName ?? (apiModel.info?.title ? `${apiModel.info.title} security tests` : DEFAULT_COLLECTION_NAME);
  const folderList: PostmanFolder[] = [...folders.entries()].sort(([a], [b]) => compareCodeUnits(a, b)).map(([name, item]) => ({ name, item }));
  const declared = dedupeVariables(variables);

  const collection: PostmanCollection = {
    info: { name: collectionName, _postman_id: collectionIdForScenarios([...exportedIds].sort(compareCodeUnits)), schema: POSTMAN_COLLECTION_SCHEMA },
    item: folderList,
  };
  const validation = validateCollection(collection, declared);
  if (!validation.valid) {
    return failure("collection_validation_failed", "The generated collection did not pass validation and was not returned.", validation.problems);
  }

  const orderedLimitations = [...limitations].sort(
    (a, b) => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.location, b.location) || compareCodeUnits(a.scenarioId ?? "", b.scenarioId ?? ""),
  );
  const withoutReadme = {
    collection,
    environment: buildEnvironment(collectionName, declared),
    validation,
    limitations: orderedLimitations,
    credentialProducers: [],
    summary: {
      requestCount: exportedIds.length,
      folderCount: folderList.length,
      byProvenance: { RULE: exportedIds.length, AI: 0 },
      workflowCount: 0,
      workflowRequestCount: 0,
      standaloneRequestCount: exportedIds.length,
      workflowVariableCount: 0,
      unsupportedWorkflowCount: 0,
      omittedWorkflowCount: 0,
      automaticChainCount: 0,
    },
  };

  logger.info("security_collection_generated", { requestItemCount: exportedIds.length, notExported: approved.length - exportedIds.length, durationMs: Date.now() - startedAt });
  return { ok: true, result: { ...withoutReadme, readme: renderReadme(withoutReadme, declared) } };
}
