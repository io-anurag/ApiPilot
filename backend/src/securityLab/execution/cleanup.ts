import type { ApiModel, ApiOperation, CleanupResult, CleanupStrategy, SecurityProfile, SecurityScenarioContent } from "@apipilot/shared-domain";
import { operationKeyOf } from "../analysis/effectiveSecurity";
import { ROLE_ANY } from "../scenarios/prerequisites";
import { buildSecurityRequest, type CredentialLookup } from "./buildSecurityRequest";
import { describeBlock } from "./guardedSender";
import type { DestinationPolicy } from "./destinationPolicy";
import type { Sender, SendOutcome } from "./types";

/**
 * Cleanup of data a run created (specs/057 FR-045, FR-046, contracts/execution-safety-rules.md section 5).
 *
 * The only strategy that sends anything is `delete-created-via-spec`: for a `POST` that returned a success and a
 * body holding the configured id field, the **documented** `DELETE` operation for that resource is built from the
 * model and sent through the same sender and destination policy as every other request. ApiPilot never guesses a
 * delete route. When the specification has none, or the id cannot be read, the cleanup is `failed` with what was
 * left behind and how to remove it by hand, so a failed cleanup is always visible in the run result.
 */

export interface CleanupPlan {
  /** Whether a scenario of this operation can create something the strategy cleans up. */
  readonly applicable: boolean;
  readonly deleteOperation?: ApiOperation;
  /** The single path parameter of the delete operation, which takes the created id. */
  readonly parameter?: string;
}

const NOT_APPLICABLE: CleanupPlan = { applicable: false };

/** The documented `DELETE {collection}/{id}` for a `POST {collection}`, or undefined when the specification has none. */
export function findDeleteOperation(apiModel: ApiModel, create: Pick<ApiOperation, "path">): { operation: ApiOperation; parameter: string } | undefined {
  const prefix = `${create.path.replace(/\/$/, "")}/`;
  for (const operation of apiModel.operations) {
    if (operation.method.toUpperCase() !== "DELETE" || !operation.path.startsWith(prefix)) continue;
    const rest = operation.path.slice(prefix.length);
    const match = /^\{([^/{}]+)\}$/.exec(rest);
    if (match) return { operation, parameter: match[1] };
  }
  return undefined;
}

/** What a scenario's cleanup would cost and use, decided before the run so the plan can count it. */
export function planCleanup(apiModel: ApiModel, content: SecurityScenarioContent, strategy: CleanupStrategy): CleanupPlan {
  if (strategy.strategy !== "delete-created-via-spec" || content.operationMethod.toUpperCase() !== "POST") return NOT_APPLICABLE;
  if (content.mutations.some((mutation) => mutation.kind === "method.probe")) return NOT_APPLICABLE;
  const create = apiModel.operations.find((operation) => operationKeyOf(operation) === content.operationKey);
  const found = create && findDeleteOperation(apiModel, create);
  return found ? { applicable: true, deleteOperation: found.operation, parameter: found.parameter } : { applicable: true };
}

/** Reads a dotted path out of a JSON body, as text. Undefined when the body is not JSON or the field is missing or not a scalar. */
export function readIdField(bodyText: string, idField: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  for (const segment of idField.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export interface CreatedResource {
  readonly scenarioId: string;
  readonly content: SecurityScenarioContent;
  /** The role of the identity that created it, so the delete is sent as the same kind of caller. */
  readonly role: string;
  readonly responseBody: string;
}

export interface CleanupDeps {
  readonly sender: Sender;
  readonly apiModel: ApiModel;
  readonly profile: SecurityProfile;
  readonly baseUrl: string;
  readonly policy: DestinationPolicy;
  readonly credential: CredentialLookup;
  readonly timeoutMs: number;
  /** Reserves one request from the budget. Cleanup draws on the allowance the plan set aside for it. */
  readonly reserve: () => boolean;
  readonly reserveHop: () => boolean;
}

const left = (content: SecurityScenarioContent) => `A resource created by ${content.operationKey}`;

/** A scenario content for the delete, used only to reuse the request builder. It is never stored. */
function deleteContent(create: SecurityScenarioContent, operation: ApiOperation, parameter: string, id: string, role: string): SecurityScenarioContent {
  return {
    operationKey: operationKeyOf(operation),
    operationMethod: "DELETE",
    operationPath: operation.path,
    categoryId: create.categoryId,
    taxonomy: [],
    title: `Clean up ${create.operationKey}`,
    objective: "Remove a resource the run created.",
    rationale: "Cleanup of data created by a security scenario.",
    prerequisites: [],
    requiredIdentities: [{ role, label: "The identity that created the resource" }],
    baseRequest: { pathParameters: { [parameter]: id }, queryParameters: {}, headers: {} },
    mutations: [],
    expected: { kind: "allowed", statement: "Cleanup request.", basis: "product-rule" },
    conditions: [],
    impact: "",
    suggestedSeverity: "info",
    destructive: { flag: true, reasons: ["DELETE"] },
    plannedRequestCount: 1,
    limitations: [],
    manualInputs: [],
    provenance: { operationKey: operationKeyOf(operation), specElementPointer: `/operations/${operationKeyOf(operation)}` },
  };
}

function failed(resource: CreatedResource, action: string, detail: string, leftBehind: string, manualRemoval: string): CleanupResult {
  return { scenarioId: resource.scenarioId, action, state: "failed", detail, leftBehind, manualRemoval };
}

/** Runs the cleanup of every created resource, once, and reports each outcome. Never throws. */
export async function runCleanup(deps: CleanupDeps, strategy: CleanupStrategy, created: readonly CreatedResource[]): Promise<CleanupResult[]> {
  if (strategy.strategy !== "delete-created-via-spec") return [];
  const results: CleanupResult[] = [];

  for (const resource of created) {
    const create = deps.apiModel.operations.find((operation) => operationKeyOf(operation) === resource.content.operationKey);
    const found = create && findDeleteOperation(deps.apiModel, create);
    const action = found ? `DELETE ${found.operation.path}` : `Remove what ${resource.content.operationKey} created`;

    if (!found) {
      results.push(
        failed(
          resource,
          action,
          "The specification documents no DELETE operation for this resource, so ApiPilot cannot remove it.",
          left(resource.content),
          "Remove it in the target system by hand. ApiPilot does not guess a delete route.",
        ),
      );
      continue;
    }
    const id = readIdField(resource.responseBody, strategy.idField);
    if (id === undefined) {
      results.push(
        failed(
          resource,
          action,
          `The response did not contain the id field "${strategy.idField}", so the resource to delete is unknown.`,
          left(resource.content),
          `Find the resource that ${resource.content.operationKey} created and remove it in the target system.`,
        ),
      );
      continue;
    }

    const built = buildSecurityRequest({
      content: deleteContent(resource.content, found.operation, found.parameter, id, resource.role || ROLE_ANY),
      apiModel: deps.apiModel,
      profile: deps.profile,
      baseUrl: deps.baseUrl,
      credential: deps.credential,
    });
    const target = `${found.operation.path.replace(`{${found.parameter}}`, "<id>")}`;
    if (!built.ok) {
      results.push(failed(resource, action, built.message, left(resource.content), `Remove it with DELETE ${target} in the target system.`));
      continue;
    }
    if (!deps.reserve()) {
      results.push(failed(resource, action, "The request budget was used up before the cleanup could be sent.", left(resource.content), `Remove it with DELETE ${target} in the target system.`));
      continue;
    }

    const outcome: SendOutcome = await deps.sender.send(built.request, {
      policy: deps.policy,
      tlsPolicy: deps.profile.tlsPolicy,
      timeoutMs: deps.timeoutMs,
      reserveHop: deps.reserveHop,
    });
    if (outcome.error || outcome.status === undefined) {
      const why = outcome.error?.category === "blocked" ? describeBlock(outcome.destination.reason) : `The request failed (${outcome.error?.category ?? "no response"}).`;
      results.push(failed(resource, action, why, left(resource.content), `Remove it with DELETE ${target} in the target system.`));
    } else if ((outcome.status >= 200 && outcome.status < 300) || outcome.status === 404) {
      results.push({ scenarioId: resource.scenarioId, action, state: "done", detail: outcome.status === 404 ? "The resource was already gone (404)." : `Deleted (${outcome.status}).` });
    } else {
      results.push(failed(resource, action, `The delete was refused with status ${outcome.status}.`, left(resource.content), `Remove it with DELETE ${target} in the target system.`));
    }
  }
  return results;
}
