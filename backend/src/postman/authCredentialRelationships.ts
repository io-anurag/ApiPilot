import type {
  ApiDependencyRelationship,
  ApiOperation,
  CredentialProducerCandidate,
} from "@apipilot/shared-domain";
import { consumerFieldSchemas, producerFieldSchemas } from "../dependencies/fieldExtraction";
import { relationshipId } from "../dependencies/identifiers";

/**
 * OpenAPI `format` values that mark a string field as structured, typed resource data rather than
 * an opaque secret (FR-003 addendum). A UUID, a timestamp, or an email address is exactly as
 * "string-typed" as a bearer token in OpenAPI terms, but none of them is a credential — keeping
 * them in the plausible set only manufactures ambiguity a real credential-issuing response (an id,
 * a label, timestamps, and the actual secret alongside each other) does not actually have.
 */
const STRUCTURED_STRING_FORMATS = new Set([
  "uuid",
  "date-time",
  "date",
  "time",
  "email",
  "uri",
  "url",
  "hostname",
  "ipv4",
  "ipv6",
  "byte",
  "binary",
]);

/**
 * Builds one `ApiDependencyRelationship` per (resolved scheme, consuming operation) pair
 * (specs/023-auto-auth-credential-chaining FR-002, FR-003). For each producer candidate
 * (`credentialProducers`, from the now primary-scheme-inclusive `findCredentialProducers`), the
 * producer operation's documented 2xx response is inspected for a plausible credential field via
 * `producerFieldSchemas`, the same helper `deterministicMatching.ts` already uses for ordinary
 * schema-field relationships. A field only qualifies as plausible when it is (FR-003):
 *
 * - string-typed,
 * - not shaped like structured resource data (`STRUCTURED_STRING_FORMATS`, no `enum`), and
 * - not something the client already supplied on this same operation's own request (a field the
 *   producer only echoes back was never "issued" — a genuine credential is generated server-side
 *   and appears solely in the response).
 *
 * Exactly one qualifying field becomes the relationship's producer field; zero or 2+ means no
 * relationship is built for that scheme (FR-004) — the caller (`generateCollection.ts`) is
 * responsible for reporting the resulting gap via the existing `unresolved-credential-producer`
 * limitation.
 *
 * Deliberately does not reuse `deterministicMatching.ts`'s name-based matching
 * (`fieldsNameMatch`) or its CONFIRMED/LIKELY/POSSIBLE confidence classification (Clarifications
 * 2026-09-14): a login response's token field is rarely named after the security scheme key, and
 * every relationship this function builds is already uniquely and deterministically resolved by
 * construction (one producer candidate, one plausible field, one scheme), so it is always
 * `CONFIRMED` (research.md D2) rather than a probabilistic match — there is no signal-based
 * evidence to attach, so `evidence`/`aiCorroboration` are left absent.
 */
export function buildAuthCredentialRelationships(
  operations: ApiOperation[],
  credentialProducers: CredentialProducerCandidate[],
): ApiDependencyRelationship[] {
  const operationByKey = new Map(
    operations.map((operation) => [`${operation.method.toUpperCase()} ${operation.path}`, operation]),
  );
  const relationships: ApiDependencyRelationship[] = [];

  for (const candidate of credentialProducers) {
    const producerOperation = operationByKey.get(
      `${candidate.producerOperationMethod.toUpperCase()} ${candidate.producerOperationPath}`,
    );
    if (!producerOperation) continue;

    const ownRequestFieldNames = consumerFieldSchemas(producerOperation);
    const plausibleFields = [...producerFieldSchemas(producerOperation).entries()].filter(
      ([field, schema]) =>
        schema.type === "string" &&
        !schema.enum &&
        !(schema.format && STRUCTURED_STRING_FORMATS.has(schema.format)) &&
        !ownRequestFieldNames.has(field),
    );
    if (plausibleFields.length !== 1) continue;
    const [producerField] = plausibleFields[0];

    const producer = {
      operationPath: candidate.producerOperationPath,
      operationMethod: candidate.producerOperationMethod,
      field: producerField,
    };

    for (const operation of operations) {
      if (operation.security[0]?.schemes[0]?.name !== candidate.schemeKey) continue;

      const consumer = {
        operationPath: operation.path,
        operationMethod: operation.method,
        field: candidate.schemeKey,
        location: "auth" as const,
      };

      relationships.push({
        id: relationshipId(producer, consumer),
        producer,
        consumer,
        confidence: "CONFIRMED",
        source: "deterministic",
        explanation:
          `${producer.operationMethod} ${producer.operationPath} returns '${producer.field}', the ` +
          `sole plausible credential field on an otherwise-unauthenticated operation's response; ` +
          `${consumer.operationMethod} ${consumer.operationPath} declares the "${candidate.schemeKey}" ` +
          `security scheme as its (first) requirement.`,
      });
    }
  }

  return relationships;
}
