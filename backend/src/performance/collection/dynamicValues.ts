import type { DynamicToken } from "../k6/renderScript";
import type { RequestTemplate } from "../plan/stepRequest";

/**
 * AP-036 (specs/036-collection-performance-test research R9, FR-013): the Postman dynamic variables a
 * collection plan generates at run time, and the rewriting of each occurrence to its own
 * `{{apipilot_dyn_<k>}}` token, so every occurrence gets its own value. The values come from the
 * script's fixed runtime; nothing here generates one. Pure.
 */
export const SUPPORTED_DYNAMIC_VARIABLES: ReadonlySet<string> = new Set([
  "$guid",
  "$randomUUID",
  "$timestamp",
  "$isoTimestamp",
  "$randomInt",
  "$randomFirstName",
  "$randomLastName",
  "$randomFullName",
  "$randomUserName",
  "$randomEmail",
  "$randomPhoneNumber",
  "$randomAlphaNumeric",
  "$randomBoolean",
]);

export const DYNAMIC_TOKEN_PREFIX = "apipilot_dyn_";
const DYNAMIC_REFERENCE = /\{\{(\$[^{}]+)\}\}/g;

/** A plan-wide counter of dynamic-variable occurrences, in the order templates are rewritten. */
export interface DynamicCounter {
  tokens: DynamicToken[];
}

function rewrite(text: string, counter: DynamicCounter): string {
  return text.replace(DYNAMIC_REFERENCE, (_match, name: string) => {
    const token = `${DYNAMIC_TOKEN_PREFIX}${counter.tokens.length}`;
    counter.tokens.push({ token, kind: name });
    return `{{${token}}}`;
  });
}

/**
 * Rewrites every dynamic variable of one template, in the order URL, headers, body, auth (R9). The
 * caller rewrites credential requests first, then journey steps, in plan order.
 */
export function rewriteDynamicValues(template: RequestTemplate, counter: DynamicCounter): RequestTemplate {
  const url = rewrite(template.url, counter);
  const headers = template.headers.map((header) => ({ key: rewrite(header.key, counter), value: rewrite(header.value, counter) }));
  const body = template.body === undefined ? undefined : rewrite(template.body, counter);
  const { auth } = template;
  const rewrittenAuth =
    auth.kind === "bearer"
      ? { ...auth, token: rewrite(auth.token, counter) }
      : auth.kind === "basic"
        ? { ...auth, username: rewrite(auth.username, counter), password: rewrite(auth.password, counter) }
        : auth.kind === "apikey"
          ? { ...auth, key: rewrite(auth.key, counter), value: rewrite(auth.value, counter) }
          : auth;
  return { ...template, url, headers, ...(body === undefined ? {} : { body }), auth: rewrittenAuth };
}
