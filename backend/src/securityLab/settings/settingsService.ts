import { getSecurityRunRepository } from "../../persistence/securityRunRepository";
import { invalidRequest } from "../errors";

/**
 * The owner's Security Lab settings (specs/057 FR-009, contracts/security-lab-api.md "Analysis and registry"): the
 * sensitive field names the user configured. Retained work, keyed by owner. The names are recorded as
 * user-provided and used for matching only; they are never treated as specification fact, and the list holds
 * names, never values.
 */

export const MAX_CONFIGURED_FIELDS = 100;
export const MAX_FIELD_NAME_LENGTH = 100;
/** A field or property name as it appears in a schema: word characters and the separators a JSON path uses. */
const FIELD_NAME = /^[\w.$@\-[\]]+$/;

export interface Settings {
  sensitiveFields: string[];
}

export function getSettings(ownerId: string): Settings {
  return { sensitiveFields: getSecurityRunRepository().getSensitiveFields(ownerId) };
}

/** Validates a request body into a clean, de-duplicated list, or throws `invalid_request` naming the problem. */
export function parseSettings(body: unknown): Settings {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidRequest("Request must be an object with a 'sensitiveFields' array of field names.");
  }
  const raw = (body as Record<string, unknown>).sensitiveFields;
  if (!Array.isArray(raw)) throw invalidRequest("'sensitiveFields' must be an array of field names.");
  if (raw.length > MAX_CONFIGURED_FIELDS) throw invalidRequest(`'sensitiveFields' may hold at most ${MAX_CONFIGURED_FIELDS} names.`);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") throw invalidRequest("Every sensitive field name must be a string.");
    const name = entry.trim();
    if (name === "" || name.length > MAX_FIELD_NAME_LENGTH || !FIELD_NAME.test(name)) {
      throw invalidRequest(
        `'${name.slice(0, 40)}' is not a valid field name: use up to ${MAX_FIELD_NAME_LENGTH} letters, digits, dots, dashes, underscores or brackets.`,
      );
    }
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      names.push(name);
    }
  }
  return { sensitiveFields: names };
}

export function putSettings(ownerId: string, body: unknown, now: Date): Settings {
  const settings = parseSettings(body);
  getSecurityRunRepository().setSensitiveFields(ownerId, settings.sensitiveFields, now.toISOString());
  return settings;
}
