import type { ApiOperation, SchemaConstraint, SecurityMutation } from "@apipilot/shared-domain";
import { deleteAtPath, primaryRequestBodySchema, setAtPath } from "../../testDesign/requestHelpers";
import { INJECTION_PROBES, PROPERTY_VALUES } from "../execution/probes";
import { parseTarget, type RequestTarget } from "./requestTarget";
import { violationFor } from "./violations";

/**
 * What each value-changing mutation does to a request (specs/057 research R6, contracts/security-scenario-contract.md).
 * There is **one** definition, used both when a run builds the request it sends and when the Postman export builds the
 * item it writes, so a scenario means the same thing in both. Every mutation names a part of the request the
 * specification defines (a body path, a query or header name, a path parameter) and takes its value from the existing
 * value generators or from a fixed set; none carries a URL, a host or a free-form value. Credential mutations
 * (`auth.*`, `identity.swap`) are not here: how a credential is expressed differs between sending and exporting.
 */

/** The parts of a request a mutation can change. Mutated in place; callers pass a copy they own. */
export interface MutableRequest {
  pathParameters: Record<string, unknown>;
  queryParameters: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: unknown;
  method: string;
}

export interface MutationHooks {
  /** The value to put in the path for another identity's resource, or undefined when none is available. */
  readonly pathIdValue: (mutation: Extract<SecurityMutation, { kind: "path-id.substitute" }>) => string | undefined;
}

export type MutationFailureCode = "test_data_missing" | "target_not_found" | "mutation_unsupported";

export type MutationOutcome =
  | { readonly ok: true; readonly repeat: number }
  | { readonly ok: false; readonly code: MutationFailureCode; readonly message: string };

const failure = (code: MutationFailureCode, message: string): MutationOutcome => ({ ok: false, code, message });

function targetOf(mutation: Extract<SecurityMutation, { path: string }>): RequestTarget | undefined {
  return parseTarget(mutation.path);
}

/** The schema of a mutation target, from the operation, or undefined when the specification has no such input. */
export function schemaAt(operation: ApiOperation, target: RequestTarget): SchemaConstraint | undefined {
  if (target.location === "body") {
    let schema = primaryRequestBodySchema(operation);
    for (const segment of target.name.split(".")) {
      schema = schema?.properties[segment];
      if (!schema) return undefined;
    }
    return schema;
  }
  const location = target.location === "header" ? ["header", "cookie"] : [target.location];
  return operation.parameters.find((parameter) => parameter.name === target.name && location.includes(parameter.location))?.schema;
}

function setTarget(request: MutableRequest, target: RequestTarget, value: unknown): void {
  if (target.location === "body") request.body = setAtPath(request.body, target.name, value);
  else if (target.location === "query") request.queryParameters[target.name] = value;
  else if (target.location === "path") request.pathParameters[target.name] = value;
  else request.headers[target.name] = value;
}

function omitTarget(request: MutableRequest, target: RequestTarget): void {
  if (target.location === "body") request.body = deleteAtPath(request.body, target.name);
  else if (target.location === "query") delete request.queryParameters[target.name];
  else if (target.location === "path") delete request.pathParameters[target.name];
  else delete request.headers[target.name];
}

/** Applies every value-changing mutation, in order, to `request`. Returns the repeat count, or why a mutation could not be applied. */
export function applyRequestMutations(request: MutableRequest, operation: ApiOperation, mutations: readonly SecurityMutation[], hooks: MutationHooks): MutationOutcome {
  let repeat = 1;
  for (const mutation of mutations) {
    switch (mutation.kind) {
      case "auth.omit":
      case "auth.invalid-token":
      case "auth.malformed":
      case "auth.expired":
      case "identity.swap":
        break; // credential mutations are applied by the caller, once the scheme and identity are known
      case "path-id.substitute": {
        const value = hooks.pathIdValue(mutation);
        if (value === undefined) {
          return failure("test_data_missing", `There is no value for "${mutation.parameter}" for a resource owned by the "${mutation.ownerIdentity}" identity.`);
        }
        request.pathParameters[mutation.parameter] = value;
        break;
      }
      case "body.add-property": {
        const name = mutation.path === "" ? mutation.name : `${mutation.path}.${mutation.name}`;
        request.body = setAtPath(request.body, name, PROPERTY_VALUES[mutation.valueKind]);
        break;
      }
      case "field.violate-constraint": {
        const target = targetOf(mutation);
        const schema = target && schemaAt(operation, target);
        const violation = schema && violationFor(schema, mutation.constraint);
        if (!target || !violation) return failure("target_not_found", `The specification declares no ${mutation.constraint} constraint at ${mutation.path}.`);
        if (violation.kind === "omit") omitTarget(request, target);
        else setTarget(request, target, violation.value);
        break;
      }
      case "input.injection-probe": {
        const target = targetOf(mutation);
        if (!target || !schemaAt(operation, target)) return failure("target_not_found", `The specification declares no input at ${mutation.path}.`);
        setTarget(request, target, INJECTION_PROBES[mutation.probeId]);
        break;
      }
      case "method.probe":
        request.method = mutation.method;
        break;
      case "request.repeat":
        repeat = mutation.count;
        break;
      default:
        return failure("mutation_unsupported", `This version of Security Lab cannot apply a "${(mutation as { kind: string }).kind}" mutation.`);
    }
  }
  return { ok: true, repeat };
}
