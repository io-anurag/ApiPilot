import type {
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
} from "@apipilot/shared-domain";
import { POSTMAN_COLLECTION_SCHEMA } from "@apipilot/shared-domain";
import { baseUrlVariable } from "./artifactVariables";
import { mapOperationAuth } from "./authMapping";
import { buildEnvironment } from "./environment";
import { groupAndName } from "./folders";
import { collectionIdForScenarios } from "./identifiers";
import { compareCodeUnits } from "./ordering";
import { renderReadme } from "./readme";
import { buildRequestItem } from "./requestItem";
import { validateCollection } from "./validateCollection";

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
 */
function authByOperation(
  apiModel: ApiModel,
  pairs: { scenario: TestScenario; operation: ApiOperation }[],
): { byKey: Map<string, PostmanAuth | undefined>; variables: ArtifactVariable[]; limitations: GenerationLimitation[] } {
  const byKey = new Map<string, PostmanAuth | undefined>();
  const variables: ArtifactVariable[] = [];
  const limitations: GenerationLimitation[] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const key = operationKey(pair.operation.path, pair.operation.method);
    if (seen.has(key)) continue;
    seen.add(key);
    const mapping = mapOperationAuth(pair.operation, apiModel.securitySchemes);
    byKey.set(key, mapping.auth);
    variables.push(...mapping.variables);
    limitations.push(...mapping.limitations);
  }

  return { byKey, variables, limitations };
}

export function generateCollection(
  apiModel: ApiModel,
  testModel: TestModel,
  options: ExportOptions = {},
): ExportOutcome {
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

  const auth = authByOperation(apiModel, resolved);
  const limitations: GenerationLimitation[] = [
    ...auth.limitations,
    ...analysisIssueLimitations(apiModel, resolved),
  ];
  const variables: ArtifactVariable[] = [
    baseUrlVariable(options.baseUrl ?? ""),
    ...auth.variables,
  ];

  const folders: PostmanFolder[] = groupAndName(resolved).map((folder) => ({
    name: folder.name,
    item: folder.entries.map((entry) => {
      const built = buildRequestItem({
        scenario: entry.scenario,
        operation: entry.operation,
        requestName: entry.requestName,
        auth: auth.byKey.get(operationKey(entry.operation.path, entry.operation.method)),
      });
      limitations.push(...built.limitations);
      variables.push(...built.variables);
      return built.item;
    }),
  }));

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
  const collectionName = options.collectionName ?? DEFAULT_COLLECTION_NAME;

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
        resolved.map((pair) => pair.scenario.id).sort(compareCodeUnits),
      ),
      schema: POSTMAN_COLLECTION_SCHEMA,
    },
    ...(sharedAuth ? { auth: sharedAuth } : {}),
    // Declared with empty values so the collection imports and runs without the environment
    // file present, and so no value ever lives in the collection artifact (FR-011).
    variable: declaredVariables.map((variable) => ({ key: variable.name, value: "" })),
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
      compareCodeUnits(a.scenarioId ?? "", b.scenarioId ?? ""),
  );

  const withoutReadme = {
    collection,
    environment: buildEnvironment(collectionName, valuedVariables),
    validation,
    limitations: orderedLimitations,
    summary: {
      requestCount: testModel.scenarios.length,
      folderCount: folders.length,
      byProvenance: countByProvenance(testModel.scenarios),
    },
  };

  return {
    ok: true,
    result: { ...withoutReadme, readme: renderReadme(withoutReadme, declaredVariables) },
  };
}