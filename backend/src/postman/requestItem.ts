import type {
  ApiOperation,
  ArtifactVariable,
  GenerationLimitation,
  PostmanAuth,
  PostmanBody,
  PostmanHeader,
  PostmanRequestItem,
  PostmanUrl,
  TestScenario,
} from "@apipilot/shared-domain";
import { primaryRequestBodyContentType } from "../testDesign/requestHelpers";
import {
  credentialKindForField,
  credentialKindForHeader,
  isBearerTokenValue,
} from "../testDesign/sensitiveValueDetection";
import {
  BASE_URL_VARIABLE,
  credentialVariable,
  pathParameterVariable,
} from "./artifactVariables";
import { translateAssertions } from "./assertionScripts";
import { itemIdForScenario } from "./identifiers";
import { sortedEntries } from "./ordering";

/**
 * Converts one approved scenario into one runnable request (FR-002, FR-003).
 *
 * Every value comes from the approved scenario, including values that deliberately violate
 * the schema — that violation is the test intent. The address is always expressed through the
 * `{{baseUrl}}` variable, never a literal host (FR-008).
 */

const JSON_CONTENT_TYPE = /^application\/(json|[\w.+-]*\+json)$/i;
const TEXT_CONTENT_TYPE = /^text\//i;
const PATH_PARAMETER_SEGMENT = /^\{(.+)\}$/;

function toValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hasHeader(headers: PostmanHeader[], name: string): boolean {
  return headers.some((header) => header.key.toLowerCase() === name.toLowerCase());
}

/**
 * Replaces a detected credential with a variable reference so the request still runs (FR-013).
 * Review redacts the same values for display; only the replacement differs (research.md).
 *
 * FR-003 requires the approved request to be reproduced exactly, and FR-013 requires a detected
 * credential to become a variable reference. Where both apply to the same value, FR-013 governs:
 * a literal credential in a shared artifact is the harm FR-011 and SC-003 exist to prevent, and
 * the substitution preserves the request's test intent while the environment supplies the value.
 */
function substituteCredentialsInBody(
  value: unknown,
  declared: ArtifactVariable[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => substituteCredentialsInBody(entry, declared));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      const kind = credentialKindForField(key, nested);
      if (kind !== undefined) {
        declared.push(credentialVariable(kind));
        return [key, `{{${kind}}}`];
      }
      return [key, substituteCredentialsInBody(nested, declared)];
    }),
  );
}

/** Input to `buildRequestItem`: the approved scenario, the operation it targets, its assigned request name, and the auth mapped for that operation, if any. */
export interface BuildRequestItemInput {
  scenario: TestScenario;
  operation: ApiOperation;
  requestName: string;
  auth?: PostmanAuth;
}

/** Output of `buildRequestItem`: the built request item plus any limitations and variables its parts introduced. */
export interface RequestItemResult {
  item: PostmanRequestItem;
  limitations: GenerationLimitation[];
  variables: ArtifactVariable[];
}

interface BodyResult {
  body?: PostmanBody;
  contentType?: string;
  limitations: GenerationLimitation[];
}

function buildBody(
  scenario: TestScenario,
  operation: ApiOperation,
  location: string,
  declared: ArtifactVariable[],
): BodyResult {
  const approved = scenario.request.body;
  if (approved === undefined) return { limitations: [] };
  const body = substituteCredentialsInBody(approved, declared);

  const contentType = primaryRequestBodyContentType(operation);
  if (contentType === undefined) {
    return {
      body: {
        mode: "raw",
        raw: JSON.stringify(body, null, 2),
        options: { raw: { language: "json" } },
      },
      limitations: [
        {
          kind: "unsupported-content-type",
          scenarioId: scenario.id,
          location,
          message:
            "The specification declares no request body content type for this operation, so the approved body is sent without a Content-Type header.",
        },
      ],
    };
  }

  if (JSON_CONTENT_TYPE.test(contentType)) {
    return {
      body: {
        mode: "raw",
        raw: JSON.stringify(body, null, 2),
        options: { raw: { language: "json" } },
      },
      contentType,
      limitations: [],
    };
  }

  if (TEXT_CONTENT_TYPE.test(contentType) && typeof body === "string") {
    return {
      body: { mode: "raw", raw: body, options: { raw: { language: "text" } } },
      contentType,
      limitations: [],
    };
  }

  return {
    limitations: [
      {
        kind: "unsupported-content-type",
        scenarioId: scenario.id,
        location,
        message: `The approved request body uses "${contentType}", which this export cannot represent faithfully, so no body is emitted and the test intent is not altered to fit.`,
      },
    ],
  };
}

function buildUrl(
  scenario: TestScenario,
  operation: ApiOperation,
  location: string,
): { url: PostmanUrl; limitations: GenerationLimitation[]; variables: ArtifactVariable[] } {
  const limitations: GenerationLimitation[] = [];
  const variables: ArtifactVariable[] = [];
  const pathVariables: { key: string; value: string }[] = [];

  /** A credential that reached a URL value still becomes a variable reference (FR-013). */
  const urlValueText = (value: unknown): string => {
    if (isBearerTokenValue(value)) {
      variables.push(credentialVariable("token"));
      return "{{token}}";
    }
    return toValueText(value);
  };

  const segments = operation.path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const parameter = PATH_PARAMETER_SEGMENT.exec(segment);
      if (!parameter) return segment;
      const name = parameter[1];
      const approved = scenario.request.pathParameters[name];
      if (approved === undefined) {
        // No approved value: surface it as a variable to supply rather than emit a
        // malformed address (FR-012, spec edge case).
        pathVariables.push({ key: name, value: `{{${name}}}` });
        variables.push(pathParameterVariable(name));
        limitations.push({
          kind: "unresolved-path-parameter",
          scenarioId: scenario.id,
          location,
          message: `The approved scenario supplied no value for the "${name}" path parameter, so it is exposed as a variable to fill in.`,
        });
      } else {
        pathVariables.push({ key: name, value: urlValueText(approved) });
      }
      return `:${name}`;
    });

  const query = sortedEntries(scenario.request.queryParameters).map(([key, value]) => ({
    key,
    value: urlValueText(value),
  }));

  const pathText = segments.length > 0 ? `/${segments.join("/")}` : "";
  const queryText =
    query.length > 0
      ? `?${query.map((parameter) => `${parameter.key}=${parameter.value}`).join("&")}`
      : "";

  return {
    url: {
      raw: `{{${BASE_URL_VARIABLE}}}${pathText}${queryText}`,
      host: [`{{${BASE_URL_VARIABLE}}}`],
      path: segments,
      query,
      variable: pathVariables,
    },
    limitations,
    variables,
  };
}

/** Assembles the full request item (URL, headers, body, auth, assertions) for one scenario, collecting the limitations and variables its parts introduced along the way. */
export function buildRequestItem(input: BuildRequestItemInput): RequestItemResult {
  const { scenario, operation, requestName, auth } = input;
  const location = `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`;

  const credentialVariables: ArtifactVariable[] = [];
  const url = buildUrl(scenario, operation, location);
  const bodyResult = buildBody(scenario, operation, location, credentialVariables);
  const assertions = translateAssertions(scenario);

  const header: PostmanHeader[] = sortedEntries(scenario.request.headers).map(
    ([key, value]) => {
      const kind = credentialKindForHeader(key, value);
      if (kind === undefined) return { key, value: toValueText(value) };
      credentialVariables.push(credentialVariable(kind));
      return { key, value: `{{${kind}}}` };
    },
  );
  if (bodyResult.contentType !== undefined && !hasHeader(header, "content-type")) {
    header.push({ key: "Content-Type", value: bodyResult.contentType });
  }

  const item: PostmanRequestItem = {
    id: itemIdForScenario(scenario.id),
    name: requestName,
    request: {
      method: scenario.operationMethod.toUpperCase(),
      url: url.url,
      header,
      ...(bodyResult.body ? { body: bodyResult.body } : {}),
      ...(auth ? { auth } : {}),
    },
    ...(assertions.event ? { event: [assertions.event] } : {}),
  };

  return {
    item,
    limitations: [...url.limitations, ...bodyResult.limitations, ...assertions.limitations],
    variables: [...url.variables, ...credentialVariables],
  };
}