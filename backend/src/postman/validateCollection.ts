import type {
  ArtifactVariable,
  PostmanCollection,
  PostmanRequestItem,
  ValidationReport,
} from "@apipilot/shared-domain";
import { POSTMAN_COLLECTION_SCHEMA } from "@apipilot/shared-domain";
import {
  credentialKindForField,
  credentialKindForHeader,
  isBearerTokenValue,
} from "../testDesign/sensitiveValueDetection";
import { compareCodeUnits } from "./ordering";

/**
 * Pre-delivery validation of the collection ApiPilot emits (FR-014).
 *
 * This checks the *subset* the generator produces rather than the official v2.1.0 JSON Schema,
 * which research.md records as a deliberate trade-off: it catches generator defects with no
 * dependency and no network access. Problems name a location and an expectation only — never a
 * payload, specification content, or a variable value (FR-025).
 */

const VARIABLE_REFERENCE = /\{\{([^}]+)\}\}/g;
const ONLY_VARIABLE_REFERENCE = /^\{\{[^}]+\}\}$/;
const LITERAL_HOST = /https?:\/\//i;
const BASE_URL_REFERENCE = "{{baseUrl}}";

function referencedVariables(text: string): string[] {
  return [...text.matchAll(VARIABLE_REFERENCE)].map((match) => match[1]);
}

function isVariableReference(value: unknown): boolean {
  return typeof value === "string" && ONLY_VARIABLE_REFERENCE.test(value.trim());
}

/** Walks a parsed body, reporting credential-named fields that carry a literal value. */
function credentialLiteralsInBody(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => credentialLiteralsInBody(entry, `${path}[${index}]`, problems));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (credentialKindForField(key, nested) !== undefined && !isVariableReference(nested)) {
      problems.push(`${here} carries a credential value that is not a variable reference`);
    } else {
      credentialLiteralsInBody(nested, here, problems);
    }
  }
}

function validateRequestItem(
  request: PostmanRequestItem,
  location: string,
  declared: Set<string>,
  seenItemIds: Set<string>,
  problems: string[],
): void {
  if (!request.id) problems.push(`${location}.id is required`);
  if (seenItemIds.has(request.id)) problems.push(`${location}.id is not unique`);
  seenItemIds.add(request.id);
  if (!request.name) problems.push(`${location}.name is required`);
  if (!request.request?.method) problems.push(`${location}.request.method is required`);

  const url = request.request?.url;
  if (!url) {
    problems.push(`${location}.request.url is required`);
    return;
  }
  if (!url.raw.startsWith(BASE_URL_REFERENCE)) {
    problems.push(`${location}.request.url.raw does not begin with ${BASE_URL_REFERENCE}`);
  }
  if (url.host.length !== 1 || url.host[0] !== BASE_URL_REFERENCE) {
    problems.push(`${location}.request.url.host must be exactly ["${BASE_URL_REFERENCE}"]`);
  }
  if (LITERAL_HOST.test(url.raw)) {
    problems.push(`${location}.request.url.raw contains a literal host`);
  }

  const references = [
    ...referencedVariables(url.raw),
    ...url.variable.flatMap((variable) => referencedVariables(variable.value)),
    ...url.query.flatMap((parameter) => referencedVariables(parameter.value)),
    ...request.request.header.flatMap((header) => referencedVariables(header.value)),
  ];
  for (const name of references) {
    if (!declared.has(name)) {
      problems.push(`${location}.request references undeclared variable "${name}"`);
    }
  }

  for (const header of request.request.header) {
    if (
      credentialKindForHeader(header.key, header.value) !== undefined &&
      !isVariableReference(header.value)
    ) {
      problems.push(
        `${location}.request.header["${header.key}"] carries a credential value that is not a variable reference`,
      );
    }
  }

  for (const variable of url.variable) {
    if (isBearerTokenValue(variable.value)) {
      problems.push(
        `${location}.request.url.variable["${variable.key}"] carries a credential value that is not a variable reference`,
      );
    }
  }

  if (request.request.body) {
    if (request.request.body.mode !== "raw") {
      problems.push(`${location}.request.body.mode supports only "raw"`);
    }
    try {
      credentialLiteralsInBody(
        JSON.parse(request.request.body.raw),
        `${location}.request.body`,
        problems,
      );
    } catch {
      // A non-JSON raw body carries no field names to inspect; the header and URL checks
      // above still apply.
    }
  }

  if (request.event && request.event.some((event) => event.listen !== "test")) {
    problems.push(`${location}.event supports only the "test" listener`);
  }
}

export function validateCollection(
  collection: PostmanCollection,
  declaredVariables: ArtifactVariable[],
): ValidationReport {
  const problems: string[] = [];
  const declared = new Set(declaredVariables.map((variable) => variable.name));

  if (!collection.info?.name) problems.push("info.name is required and must be non-empty");
  if (!collection.info?._postman_id) problems.push("info._postman_id is required");
  if (collection.info?.schema !== POSTMAN_COLLECTION_SCHEMA) {
    problems.push("info.schema must name the v2.1.0 collection format");
  }

  const declaredKeys = collection.variable.map((variable) => variable.key);
  for (const name of declared) {
    if (!declaredKeys.includes(name)) {
      problems.push(`collection.variable is missing the declared variable "${name}"`);
    }
  }
  for (const variable of collection.variable) {
    if (variable.value !== "") {
      problems.push(
        `collection.variable["${variable.key}"].value must be empty; values belong in the environment`,
      );
    }
  }

  const folderNames = collection.item.map((folder) => folder.name);
  for (let index = 1; index < folderNames.length; index += 1) {
    if (compareCodeUnits(folderNames[index - 1], folderNames[index]) >= 0) {
      problems.push(`item[${index}] is out of the defined folder order`);
    }
  }

  const seenItemIds = new Set<string>();
  collection.item.forEach((folder, folderIndex) => {
    const location = `item[${folderIndex}]`;
    if (!folder.name) problems.push(`${location}.name is required`);
    if (folder.item.length === 0) problems.push(`${location} must contain at least one request`);
    folder.item.forEach((request, requestIndex) => {
      validateRequestItem(
        request,
        `${location}.item[${requestIndex}]`,
        declared,
        seenItemIds,
        problems,
      );
    });
  });

  return { valid: problems.length === 0, problems };
}