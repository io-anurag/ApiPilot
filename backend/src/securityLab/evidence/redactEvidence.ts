import type { EvidenceRecord } from "@apipilot/shared-domain";
import { CredentialCollector, redactJsonValue } from "../../apiInput/redaction";
import { REDACTED, redactBody, redactHeaders, redactUrl, scanOutput } from "../../failureAnalysis/redaction";
import { EVIDENCE_BODY_EXCERPT_BYTES } from "../config";
import type { OutboundRequest, SendOutcome } from "../execution/types";
import { selectResponseHeaders } from "./excerpt";

/**
 * Builds an `EvidenceRecord` with every secret already removed (specs/057 research R14, FR-048 to FR-052, SC-009).
 * Redaction runs **here**, when the record is constructed, so no later stage (storage, a route, a report) ever holds an
 * unredacted value. It composes the product's existing helpers, which key on header and field names and on the shape
 * of a value, and then masks by **literal match** every credential value the run resolved, wherever it appears: a
 * header, the URL, a body, an error message, a redirect target. Bodies are bounded and flagged truncated.
 */

export interface EvidenceInput {
  readonly index: number;
  readonly sentAt: string;
  readonly request: OutboundRequest;
  readonly outcome: SendOutcome;
  /** Every credential value the run resolved, in every encoded form. Used for literal masking only. */
  readonly secrets: readonly string[];
}

/**
 * Values that are credentials by their shape alone, wherever they sit in text: a JWT, a Basic header value and a
 * cloud access key id. The name-based redaction cannot see these in a field called `note`. Each pattern is linear.
 */
const SHAPED_IN_TEXT: readonly RegExp[] = [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, /\bBasic\s+[A-Za-z0-9+/=]{8,}/g, /\bAKIA[A-Z0-9]{16}\b/g];

/** Masks every known credential by literal match, then every credential-shaped value. */
function mask(text: string, secrets: readonly string[]): string {
  return SHAPED_IN_TEXT.reduce((current, pattern) => current.replace(pattern, REDACTED), scanOutput(text, secrets));
}

/** A JSON body with credential-named fields and credential-shaped values replaced, structure kept. Anything else is returned as it came. */
function redactStructured(text: string): string {
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(text) as unknown, new CredentialCollector()));
  } catch {
    return text;
  }
}

function excerptOf(text: string, secrets: readonly string[]): { text: string; truncated: boolean } {
  const excerpt = redactBody(redactStructured(text), EVIDENCE_BODY_EXCERPT_BYTES);
  return { text: mask(excerpt.text, secrets), truncated: excerpt.truncated };
}

export function buildEvidenceRecord(input: EvidenceInput): EvidenceRecord {
  const { request, outcome, secrets } = input;
  const requestHeaders = Object.fromEntries(
    redactHeaders(Object.entries(request.headers).map(([key, value]) => ({ key, value }))).value.map(({ key, value }) => [key, mask(value, secrets)]),
  );
  const requestBody = request.body === undefined ? undefined : excerptOf(request.body, secrets);
  const responseBody = outcome.bodyText === "" ? undefined : excerptOf(outcome.bodyText, secrets);

  return {
    index: input.index,
    sentAt: input.sentAt,
    durationMs: outcome.durationMs,
    method: request.method,
    urlRedacted: mask(redactUrl(request.url).value, secrets),
    requestHeadersRedacted: requestHeaders,
    ...(requestBody ? { requestBodyExcerpt: requestBody.text } : {}),
    destination: {
      host: outcome.destination.host,
      port: outcome.destination.port,
      addressClass: outcome.destination.addressClass ?? "public",
      verdict: outcome.destination.verdict,
      ...(outcome.destination.reason ? { reason: outcome.destination.reason } : {}),
    },
    redirects: outcome.redirects.map((redirect) => ({
      toRedacted: mask(redirect.to, secrets),
      verdict: redirect.verdict,
      ...(redirect.reason ? { reason: redirect.reason } : {}),
    })),
    ...(outcome.status === undefined ? {} : { responseStatus: outcome.status }),
    responseHeadersSelected: selectResponseHeaders(outcome.headers, secrets),
    ...(responseBody ? { responseBodyExcerpt: responseBody.text } : {}),
    truncated: outcome.truncated || (responseBody?.truncated ?? false) || (requestBody?.truncated ?? false),
    ...(outcome.error ? { error: { category: outcome.error.category } } : {}),
  };
}
