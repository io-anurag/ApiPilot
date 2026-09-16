import type {
  ApiDependencyRelationship,
  ApiModel,
  ApiOperation,
  ArtifactVariable,
  ExportOptions,
  ExportOutcome,
  GenerationLimitation,
  PostmanAuth,
  PostmanCollection,
  PostmanFolder,
  ProvenanceCounts,
  TestModel,
  TestScenario,
  WorkflowExportContext,
} from "@apipilot/shared-domain";
import { POSTMAN_COLLECTION_SCHEMA } from "@apipilot/shared-domain";
import { buildAuthCredentialRelationships } from "./authCredentialRelationships";
import { planAutomaticChains } from "./automaticChaining";
import { baseUrlVariable } from "./artifactVariables";
import { mapOperationAuth, planSchemeVariables, type SchemeVariablePlanEntry } from "./authMapping";
import { findCredentialProducers } from "./credentialProducers";
import { buildEnvironment } from "./environment";
import { groupAndName } from "./folders";
import { buildOAuth2SetupFolders } from "./oauth2TokenFetch";
import { collectionIdForScenarios } from "./identifiers";
import { compareCodeUnits } from "./ordering";
import { renderReadme } from "./readme";
import { buildRequestItem } from "./requestItem";
import { validateCollection } from "./validateCollection";
import { planApprovedWorkflows, workflowVariableName } from "./workflowRendering";
import { applyWorkflowSubstitutions } from "./workflowVariables";
import { createLogger } from "../logger";

const logger = createLogger("postman.generateCollection");

/**
 * Turns an approved TestModel plus its ApiModel into the three deliverable artifacts (FR-001).
 *
 * The transformation is entirely deterministic and uses no AI (FR-019), issues no request to
 * any API described by the specification (FR-023), and retains nothing (FR-024). Anything that
 * cannot be expressed faithfully is either recorded as a limitation or refused outright — it is
 * never quietly altered to fit.
 */

const DEFAULT_COLLECTION_NAME = "ApiPilot API tests";

/**
 * Keys that would carry multi-step workflow intent. The current TestScenario contract defines
 * none of them, so their presence means the input came from a model this generator has not been
 * taught to render; AP-008 owns that contract (FR-029, FR-030).
 */
const WORKFLOW_INTENT_KEYS = new Set([
  "steps",
  "workflow",
  "workflows",
  "workflowId",
  "workflowSteps",
  "dependsOn",
  "dependencies",
  "extract",
  "extractions",
  "extractedValues",
  "chain",
  "sequence",
  "stepOrder",
  "previousStep",
  "nextStep",
]);

function workflowIntentKey(testModel: TestModel): string | undefined {
  const model = testModel as unknown as Record<string, unknown>;
  const topLevel = Object.keys(model).find((key) => WORKFLOW_INTENT_KEYS.has(key));
  if (topLevel) return topLevel;
  for (const scenario of testModel.scenarios) {
    const key = Object.keys(scenario as unknown as Record<string, unknown>).find((name) =>
      WORKFLOW_INTENT_KEYS.has(name),
    );
    if (key) return key;
  }
  return undefined;
}

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Every relationship id belonging to a workflow a human has explicitly rejected (research.md D7,
 * FR-016) — an explicit human "no" always overrides automatic chaining, even for a relationship
 * that independently meets the CONFIRMED/LIKELY eligibility bar.
 */
function rejectedRelationshipIds(workflowContext?: WorkflowExportContext): Set<string> {
  const automatic = workflowContext?.automaticChaining;
  if (!automatic) return new Set();
  const ids = new Set<string>();
  for (const workflow of workflowContext!.workflows) {
    if (automatic.workflowDecisions[workflow.id]?.state !== "rejected") continue;
    for (const relationshipId of workflow.relationshipIds) ids.add(relationshipId);
  }
  return ids;
}

function resolveOperations(
  apiModel: ApiModel,
  testModel: TestModel,
): { scenario: TestScenario; operation: ApiOperation }[] | { unknown: string } {
  const byKey = new Map<string, ApiOperation>(
    apiModel.operations.map((operation) => [
      operationKey(operation.path, operation.method),
      operation,
    ]),
  );
  const pairs: { scenario: TestScenario; operation: ApiOperation }[] = [];
  for (const scenario of testModel.scenarios) {
    const key = operationKey(scenario.operationPath, scenario.operationMethod);
    const operation = byKey.get(key);
    if (!operation) return { unknown: key };
    pairs.push({ scenario, operation });
  }
  return pairs;
}

/**
 * Analysis issues the specification carried for the operations actually exported (FR-017).
 * Issues about operations no approved scenario targets are not this export's business.
 */
function analysisIssueLimitations(
  apiModel: ApiModel,
  pairs: { scenario: TestScenario; operation: ApiOperation }[],
): GenerationLimitation[] {
  const exportedPaths = [...new Set(pairs.map((pair) => pair.operation.path))];
  const seen = new Set<string>();
  const limitations: GenerationLimitation[] = [];
  for (const issue of apiModel.summary.issues) {
    if (!exportedPaths.some((path) => issue.location.includes(path))) continue;
    const key = `${issue.location} ${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    limitations.push({
      kind: "specification-analysis-issue",
      location: issue.location,
      message: `The specification analysis reported "${issue.kind}" for this operation: ${issue.message}`,
    });
  }
  return limitations;
}

function countByProvenance(scenarios: TestScenario[]): ProvenanceCounts {
  const counts: ProvenanceCounts = { RULE: 0, AI: 0 };
  for (const scenario of scenarios) counts[scenario.provenance.source] += 1;
  return counts;
}

function dedupeVariables(variables: ArtifactVariable[]): ArtifactVariable[] {
  const byName = new Map<string, ArtifactVariable>();
  for (const variable of variables) {
    const existing = byName.get(variable.name);
    // A supplied value wins over the placeholder declaration of the same variable.
    if (!existing || (existing.value === "" && variable.value !== "")) {
      byName.set(variable.name, variable);
    }
  }
  return [...byName.values()].sort((a, b) => compareCodeUnits(a.name, b.name));
}

/**
 * Auth is mapped once per operation, not once per scenario, so an operation's recorded
 * limitations appear once no matter how many scenarios target it.
 *
 * `plan` is computed once by the caller (`generateCollection`), before automatic chaining runs —
 * not recomputed here — so every stage of the export (producer discovery, auth-credential
 * relationship building, per-operation auth mapping, unresolved-scheme limitation reporting)
 * agrees on the same primacy/naming decisions (specs/023-auto-auth-credential-chaining).
 */
function authByOperation(
  apiModel: ApiModel,
  pairs: { scenario: TestScenario; operation: ApiOperation }[],
  plan: Map<string, SchemeVariablePlanEntry>,
): {
  byKey: Map<string, PostmanAuth | undefined>;
  variables: ArtifactVariable[];
  limitations: GenerationLimitation[];
  /** Every operation actually present in this export's approved scenarios, deduplicated —
   *  reused by unresolved-scheme limitation reporting to list the affected operations. */
  operations: ApiOperation[];
} {
  const byKey = new Map<string, PostmanAuth | undefined>();
  const variables: ArtifactVariable[] = [];
  const limitations: GenerationLimitation[] = [];
  const operations: ApiOperation[] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const key = operationKey(pair.operation.path, pair.operation.method);
    if (seen.has(key)) continue;
    seen.add(key);
    operations.push(pair.operation);
    const mapping = mapOperationAuth(pair.operation, apiModel.securitySchemes, plan);
    byKey.set(key, mapping.auth);
    variables.push(...mapping.variables);
    limitations.push(...mapping.limitations);
  }

  return { byKey, variables, limitations, operations };
}

/**
 * One aggregated limitation per scheme with no auth-credential relationship actually built for it
 * (specs/021-multi-credential-token-provisioning FR-007, specs/023-auto-auth-credential-chaining
 * FR-004) — never one per affected operation, so the same unresolved scheme is not reported
 * redundantly for every request that depends on it.
 *
 * Driven by `authRelationships` (field-level resolution), not merely by which schemes had a
 * discovered producer *operation* (`credentialProducers`): a producer operation can be found by
 * `findCredentialProducers`'s stem match yet still yield no relationship here, when its response
 * documents zero or more than one plausible credential field (FR-003/FR-004) — that case must
 * still report this limitation, not silently report nothing. The primary scheme is no longer
 * exempt (specs/023 Clarifications 2026-09-15 Q1): producer discovery now covers it too, so it can
 * now also end up unresolved.
 */
function unresolvedCredentialProducerLimitations(
  operations: ApiOperation[],
  plan: Map<string, SchemeVariablePlanEntry>,
  authRelationships: ApiDependencyRelationship[],
): GenerationLimitation[] {
  const resolvedSchemeKeys = new Set(
    authRelationships
      .filter((relationship) => relationship.consumer.location === "auth")
      .map((relationship) => relationship.consumer.field),
  );
  const limitations: GenerationLimitation[] = [];

  for (const [schemeKey, entry] of plan) {
    if (resolvedSchemeKeys.has(schemeKey)) continue;
    // An oauth2 clientCredentials scheme's token-fetch request is always synthesized whenever at
    // least one approved scenario requires it (AP-024, FR-004) — it can never be "unresolved" in
    // the sense this limitation models, unlike a bearer/apiKey scheme's discovered producer.
    if (entry.type === "oauth2") continue;

    const dependentLocations = operations
      .filter((operation) => operation.security[0]?.schemes[0]?.name === schemeKey)
      .map((operation) => `${operation.method.toUpperCase()} ${operation.path}`)
      .sort(compareCodeUnits);
    if (dependentLocations.length === 0) continue;

    const variableNames =
      entry.type === "basic"
        ? `${entry.variableNames.username}, ${entry.variableNames.password}`
        : entry.type === "bearer"
          ? entry.variableNames.token
          : entry.variableNames.apiKey;

    limitations.push({
      kind: "unresolved-credential-producer",
      location: `security scheme "${schemeKey}"`,
      message: `No operation in the specification could be identified as obtaining the "${schemeKey}" credential; populate {{${variableNames}}} manually. Affected operations: ${dependentLocations.join(", ")}.`,
    });
  }

  return limitations;
}

/**
 * Security scheme key → the credential variable name `authMapping.ts` already emits for it
 * (specs/023-auto-auth-credential-chaining research.md D6). Only `bearer`/`apiKey` schemes are
 * keyed — `basic` is excluded (FR-002a), consistent with `authCredentialRelationships.ts` never
 * building a relationship for one.
 */
function credentialVariableNamesFor(plan: Map<string, SchemeVariablePlanEntry>): Map<string, string> {
  const names = new Map<string, string>();
  for (const [schemeKey, entry] of plan) {
    if (entry.type === "bearer") names.set(schemeKey, entry.variableNames.token);
    else if (entry.type === "apiKey") names.set(schemeKey, entry.variableNames.apiKey);
  }
  return names;
}

/**
 * Turns an approved TestModel plus its ApiModel into a complete Postman collection artifact
 * (collection, environment, and readme), honoring the caller's `ExportOptions` (base URL,
 * collection name, supplied variable values). Refuses outright — rather than emitting a
 * partial or silently altered artifact — when the test model carries unsupported multi-step
 * workflow intent, is empty, references an unknown operation, supplies a value for an
 * undeclared variable, or fails the generator's own pre-delivery validation.
 */
export function generateCollection(
  apiModel: ApiModel,
  testModel: TestModel,
  options: ExportOptions = {},
  workflowContext?: WorkflowExportContext,
): ExportOutcome {
  const startedAt = Date.now();
  const workflowKey = workflowIntentKey(testModel);
  if (workflowKey !== undefined) {
    return {
      ok: false,
      failure: {
        code: "workflow_intent_unsupported",
        message: `The approved test model carries multi-step workflow intent ("${workflowKey}"), which this export does not render. Exporting the steps as unrelated requests would present a suite that cannot pass as a successful export.`,
      },
    };
  }

  if (testModel.scenarios.length === 0) {
    return {
      ok: false,
      failure: {
        code: "empty_approved_test_model",
        message:
          "The approved test model contains no scenarios, so there is nothing to export. Accept at least one scenario in review first.",
      },
    };
  }

  const resolved = resolveOperations(apiModel, testModel);
  if ("unknown" in resolved) {
    return {
      ok: false,
      failure: {
        code: "unknown_operation",
        message: `A scenario references the operation "${resolved.unknown}", which the supplied API model does not contain.`,
      },
    };
  }

  const workflowPlans = planApprovedWorkflows(apiModel, testModel, workflowContext);
  const renderedScenarioIds = workflowPlans.renderedScenarioIds;
  const unchainedStandaloneResolved = resolved.filter(
    ({ scenario }) => !renderedScenarioIds.has(scenario.id),
  );
  const workflowResolved = workflowPlans.plans.flatMap((plan) =>
    plan.limitation
      ? []
      : plan.steps.map((step) => ({
          scenario: step.scenario,
          operation: step.operation,
        })),
  );

  // The final emission order (path/method/category/scenario-id, per ordering.ts) never depends on
  // chaining decisions — chaining only ever rewrites `pathParameters` values, never operation
  // identity or category — so it is computed once, here, over the *unmodified* list and reused
  // both as automatic chaining's ordering guard (FR-015, research.md D6) and, unchanged, as the
  // actual folder structure below.
  const standaloneOrderRank = new Map<string, number>();
  groupAndName(unchainedStandaloneResolved).forEach((folder) => {
    folder.entries.forEach((entry) => standaloneOrderRank.set(entry.scenario.id, standaloneOrderRank.size));
  });

  // Computed here — before automatic chaining runs, not after — because auth-credential chaining
  // (specs/023-auto-auth-credential-chaining) needs the scheme plan and every auth-credential
  // relationship *as an input* to `planAutomaticChains`. Every one of these is a pure function of
  // `apiModel` alone (never the resolved scenario list), so nothing here depends on chaining's own
  // output; `authByOperation` below reuses this same `plan` for per-operation auth-block mapping.
  const plan = planSchemeVariables(apiModel.securitySchemes);
  const credentialProducers = findCredentialProducers(apiModel.operations, plan);
  const authRelationships = buildAuthCredentialRelationships(apiModel.operations, credentialProducers);
  const credentialVariableNames = credentialVariableNamesFor(plan);

  const automaticChaining = planAutomaticChains(unchainedStandaloneResolved, {
    graph: {
      relationships: [...(workflowContext?.automaticChaining?.graph.relationships ?? []), ...authRelationships],
    },
    cycles: workflowContext?.automaticChaining?.cycles ?? [],
    rejectedRelationshipIds: rejectedRelationshipIds(workflowContext),
    disabled: workflowContext?.automaticChaining === undefined || options.disableAutomaticChaining === true,
    standaloneOrderRank,
    credentialVariableNames,
  });
  const standaloneResolved = automaticChaining.scenarios;

  const auth = authByOperation(apiModel, [...standaloneResolved, ...workflowResolved], plan);
  const limitations: GenerationLimitation[] = [
    ...auth.limitations,
    ...analysisIssueLimitations(apiModel, resolved),
    ...workflowPlans.limitations,
    ...unresolvedCredentialProducerLimitations(auth.operations, plan, authRelationships),
  ];
  const variables: ArtifactVariable[] = [
    baseUrlVariable(options.baseUrl ?? ""),
    ...auth.variables,
  ];
  for (const chain of automaticChaining.chains) {
    variables.push({
      name: chain.variableName,
      purpose: `Value automatically captured from ${chain.producer.operationMethod.toUpperCase()} ${chain.producer.operationPath} ("${chain.producer.field}") for reuse by a dependent request`,
      secret: false,
      value: "",
      provenance: {
        workflowId: chain.chainId,
        relationshipId: chain.consumers[0]?.relationshipId,
        origin: "automatic-chain",
      },
    });
  }

  const standaloneFolders: PostmanFolder[] = groupAndName(standaloneResolved).map(
    (folder) => ({
      name: folder.name,
      item: folder.entries.map((entry) => {
        const built = buildRequestItem({
          scenario: entry.scenario,
          operation: entry.operation,
          requestName: entry.requestName,
          auth: auth.byKey.get(
            operationKey(entry.operation.path, entry.operation.method),
          ),
          workflowExtractions: automaticChaining.extractionsByProducerScenarioId.get(entry.scenario.id),
        });
        limitations.push(...built.limitations);
        variables.push(...built.variables);
        return built.item;
      }),
    }),
  );

  const workflowFolders: PostmanFolder[] = workflowPlans.plans
    .filter((plan) => !plan.limitation)
    .map((plan) => {
      for (const variable of plan.variables) {
        variables.push({
          name: workflowVariableName(plan.workflowId, variable.name),
          purpose: `Value handed from workflow ${plan.workflowId} to a later step`,
          secret: false,
          value: "",
          provenance: {
            workflowId: plan.workflowId,
            relationshipId: variable.relationshipId,
            origin: "approved-workflow",
          },
        });
      }
      return {
        name: `Workflow: ${plan.workflowId}`,
        item: plan.steps.map((step) => {
          const scenario = applyWorkflowSubstitutions(
            step.scenario,
            plan.workflowId,
            step.consumes,
          );
          const built = buildRequestItem({
            scenario,
            operation: step.operation,
            requestName: `${step.operation.method.toUpperCase()} ${step.operation.path} — workflow step ${step.position + 1}`,
            auth: auth.byKey.get(
              operationKey(step.operation.path, step.operation.method),
            ),
            workflowId: plan.workflowId,
            workflowStepPosition: step.position,
            workflowRelationshipIds: plan.variables.map(
              (variable) => variable.relationshipId,
            ),
            workflowExtractions: step.produces.map((variable) => ({
              workflowId: plan.workflowId,
              variableName: variable.name,
              responseField: variable.producerField,
            })),
          });
          limitations.push(...built.limitations);
          variables.push(...built.variables);
          return built.item;
        }),
      };
    });

  // Computed unconditionally — never gated by `options.disableAutomaticChaining` (FR-008): unlike
  // bearer/apiKey credential chaining, this is not a chain discovered between two approved
  // scenarios, but synthesized directly from the security scheme's own declaration.
  const oauth2SetupFolders = buildOAuth2SetupFolders(auth.operations, apiModel.securitySchemes, plan);
  const folders = [
    ...oauth2SetupFolders,
    ...[...workflowFolders, ...standaloneFolders].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    ),
  ];

  // One auth configuration shared by every request moves to the collection level; a mixture
  // stays on the individual requests (data-model.md).
  const allItems = folders.flatMap((folder) => folder.item);
  const authSignatures = new Set(
    allItems.map((item) => (item.request.auth ? JSON.stringify(item.request.auth) : "")),
  );
  const sharedAuth =
    authSignatures.size === 1 && !authSignatures.has("")
      ? allItems[0]?.request.auth
      : undefined;
  if (sharedAuth) {
    for (const folder of folders) {
      for (const item of folder.item) delete item.request.auth;
    }
  }

  const declaredVariables = dedupeVariables(variables);
  // Explicit engineer choice wins; otherwise the uploaded specification's own `info.title` names
  // the export, so a collection/environment reads as "Orders API" rather than a generic default —
  // falling back to the generic default only when the specification declares no usable title.
  const collectionName = options.collectionName ?? apiModel.info?.title ?? DEFAULT_COLLECTION_NAME;

  // A supplied value for a variable the collection does not reference is refused rather than
  // silently ignored, so the engineer learns the value would have had no effect.
  const supplied = options.variableValues ?? {};
  const undeclared = Object.keys(supplied)
    .sort(compareCodeUnits)
    .find((name) => !declaredVariables.some((variable) => variable.name === name));
  if (undeclared !== undefined) {
    return {
      ok: false,
      failure: {
        code: "unknown_variable",
        message: `The generated collection does not reference a variable named "${undeclared}", so no value can be applied to it.`,
      },
    };
  }
  const valuedVariables = declaredVariables.map((variable) =>
    supplied[variable.name] !== undefined
      ? { ...variable, value: supplied[variable.name] }
      : variable,
  );

  const collection: PostmanCollection = {
    info: {
      name: collectionName,
      _postman_id: collectionIdForScenarios(
        [
          ...workflowFolders.flatMap((folder) => folder.item.map((item) => item.id)),
          ...standaloneResolved.map((pair) => pair.scenario.id),
        ].sort(compareCodeUnits),
      ),
      schema: POSTMAN_COLLECTION_SCHEMA,
    },
    ...(sharedAuth ? { auth: sharedAuth } : {}),
    // No collection-level `variable` declaration: the environment artifact is the single place
    // every variable name and value is declared (FR-010), so the two artifacts never carry two
    // separate lists of the same names.
    item: folders,
  };

  const validation = validateCollection(collection, declaredVariables);
  if (!validation.valid) {
    return {
      ok: false,
      failure: {
        code: "collection_validation_failed",
        message: "The generated collection did not pass validation and was not returned.",
        problems: validation.problems,
      },
    };
  }

  const orderedLimitations = [...limitations].sort(
    (a, b) =>
      compareCodeUnits(a.kind, b.kind) ||
      compareCodeUnits(a.location, b.location) ||
      compareCodeUnits(a.workflowId ?? "", b.workflowId ?? "") ||
      (a.stepPosition ?? -1) - (b.stepPosition ?? -1) ||
      compareCodeUnits(a.relationshipId ?? "", b.relationshipId ?? "") ||
      compareCodeUnits(a.scenarioId ?? "", b.scenarioId ?? ""),
  );

  const withoutReadme = {
    collection,
    environment: buildEnvironment(collectionName, valuedVariables),
    validation,
    limitations: orderedLimitations,
    credentialProducers,
    summary: {
      requestCount: folders.reduce((count, folder) => count + folder.item.length, 0),
      folderCount: folders.length,
      byProvenance: countByProvenance([
        ...standaloneResolved.map((pair) => pair.scenario),
        ...workflowResolved.map((pair) => pair.scenario),
      ]),
      workflowCount: workflowPlans.approvedWorkflowCount,
      workflowRequestCount: workflowResolved.length,
      standaloneRequestCount: standaloneResolved.length,
      workflowVariableCount: workflowPlans.plans
        .filter((plan) => !plan.limitation)
        .reduce((count, plan) => count + plan.variables.length, 0),
      unsupportedWorkflowCount: workflowPlans.unsupportedWorkflowCount,
      omittedWorkflowCount: workflowPlans.omittedWorkflowCount,
      automaticChainCount: automaticChaining.chains.reduce(
        (count, chain) => count + chain.consumers.length,
        0,
      ),
    },
  };

  logger.info("collection_generated", {
    requestItemCount: withoutReadme.summary.requestCount,
    folderCount: withoutReadme.summary.folderCount,
    durationMs: Date.now() - startedAt,
  });

  return {
    ok: true,
    result: {
      ...withoutReadme,
      readme: renderReadme(withoutReadme, declaredVariables, automaticChaining.chains),
    },
  };
}
