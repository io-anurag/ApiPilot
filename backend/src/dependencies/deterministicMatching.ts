import type {
  ApiDependencyRelationship,
  ApiModel,
  DependencyConfidence,
  DeterministicDependencyEvidence,
  FieldRef,
  SchemaConstraint,
} from "@apipilot/shared-domain";
import {
  consumerFieldSchemas,
  extractConsumerFields,
  extractProducerFields,
  producerFieldSchemas,
} from "./fieldExtraction";
import { relationshipId } from "./identifiers";

/** Normalizes a dotted field path to its final segment, lowercased, for name comparison. */
function normalizedStem(fieldPath: string): string {
  const segments = fieldPath.split(".");
  return (segments.at(-1) ?? fieldPath).toLowerCase();
}

/**
 * Whether `raw` looks like an identifier field: exactly "id", a snake_case "..._id" suffix, or a
 * camelCase "...Id" suffix. The camelCase check is deliberately case-sensitive on the "I" so an
 * ordinary word that merely ends in lowercase "id" (e.g. "valid") is never mistaken for one.
 */
function isIdLikeName(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (lower === "id") return true;
  if (lower.endsWith("_id")) return true;
  return /[a-zA-Z0-9]Id$/.test(raw);
}

/**
 * Field-name match after normalization (research.md): exact match on the final dotted segment,
 * case-insensitive; or one side is the bare "id" and the other is any identifier-shaped field
 * (e.g. producer "id" vs consumer "userId") — the canonical REST create-then-use idiom this
 * feature's own worked example relies on. Two different "...Id"-suffixed names never match each
 * other, since neither is the bare "id" that anchors the rule.
 */
export function fieldsNameMatch(producerField: string, consumerField: string): boolean {
  const producerStem = normalizedStem(producerField);
  const consumerStem = normalizedStem(consumerField);
  if (producerStem === consumerStem) return true;
  const producerLastRaw = producerField.split(".").at(-1) ?? producerField;
  const consumerLastRaw = consumerField.split(".").at(-1) ?? consumerField;
  if (!isIdLikeName(producerLastRaw) || !isIdLikeName(consumerLastRaw)) return false;
  return producerStem === "id" || consumerStem === "id";
}

function pathSegments(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment.length > 0 && !(segment.startsWith("{") && segment.endsWith("}")));
}

function isPrefix(shorter: string[], longer: string[]): boolean {
  if (shorter.length > longer.length) return false;
  return shorter.every((segment, index) => segment === longer[index]);
}

/**
 * Whether two operation paths have a resource/path relationship (research.md): after stripping
 * `{param}` segments, one path's static segments form a prefix of the other's.
 */
export function computeResourceRelationship(pathA: string, pathB: string): boolean {
  const a = pathSegments(pathA);
  const b = pathSegments(pathB);
  return isPrefix(a, b) || isPrefix(b, a);
}

/** Whether two operations share at least one declared tag. */
export function computeTagAlignment(tagsA: readonly string[], tagsB: readonly string[]): boolean {
  return tagsA.some((tag) => tagsB.includes(tag));
}

function schemaTypeMatch(a: SchemaConstraint | undefined, b: SchemaConstraint | undefined): boolean {
  return Boolean(a?.type) && a?.type === b?.type;
}

function schemaFormatMatch(a: SchemaConstraint | undefined, b: SchemaConstraint | undefined): boolean {
  return Boolean(a?.format) && a?.format === b?.format;
}

/**
 * Classifies a relationship's confidence from its deterministic evidence, per data-model.md's
 * fixed, exhaustive table. Returns null when there is no name match at all — deterministic
 * matching reports nothing in that case, though the AI pass may still find it (FR-003, SC-002,
 * constitution XV).
 */
export function classifyDeterministicEvidence(
  evidence: DeterministicDependencyEvidence,
): DependencyConfidence | null {
  if (!evidence.nameMatch) return null;
  if (evidence.resourceRelationship) {
    return evidence.typeMatch || evidence.formatMatch ? "CONFIRMED" : "LIKELY";
  }
  const otherSignalCount = [evidence.typeMatch, evidence.formatMatch, evidence.tagAlignment].filter(
    Boolean,
  ).length;
  return otherSignalCount >= 2 ? "LIKELY" : "POSSIBLE";
}

function explainEvidence(
  evidence: DeterministicDependencyEvidence,
  producer: FieldRef,
  consumer: FieldRef,
): string {
  const signals: string[] = ["matching field name"];
  if (evidence.typeMatch) signals.push("matching data type");
  if (evidence.formatMatch) signals.push("matching format");
  if (evidence.resourceRelationship) signals.push("shared resource path");
  if (evidence.tagAlignment) signals.push("shared tag");
  return (
    `${producer.operationMethod} ${producer.operationPath} returns '${producer.field}'; ` +
    `${consumer.operationMethod} ${consumer.operationPath} consumes it as ${consumer.location} ` +
    `field '${consumer.field}' (${signals.join(", ")}).`
  );
}

/**
 * Computes every deterministic candidate relationship across an ApiModel's operations
 * (FR-001-FR-004), independent of any AI provider.
 */
export function computeDeterministicRelationships(apiModel: ApiModel): ApiDependencyRelationship[] {
  const relationships: ApiDependencyRelationship[] = [];
  for (const producerOp of apiModel.operations) {
    const producerFields = extractProducerFields(producerOp);
    if (producerFields.length === 0) continue;
    const producerSchemas = producerFieldSchemas(producerOp);
    for (const consumerOp of apiModel.operations) {
      if (consumerOp === producerOp) continue;
      const consumerFields = extractConsumerFields(consumerOp, apiModel.securitySchemes);
      if (consumerFields.length === 0) continue;
      const consumerSchemas = consumerFieldSchemas(consumerOp);
      const resourceRelationship = computeResourceRelationship(producerOp.path, consumerOp.path);
      const tagAlignment = computeTagAlignment(producerOp.tags, consumerOp.tags);
      for (const producer of producerFields) {
        for (const consumer of consumerFields) {
          if (!fieldsNameMatch(producer.field, consumer.field)) continue;
          const evidence: DeterministicDependencyEvidence = {
            nameMatch: true,
            typeMatch: schemaTypeMatch(
              producerSchemas.get(producer.field),
              consumerSchemas.get(consumer.field),
            ),
            formatMatch: schemaFormatMatch(
              producerSchemas.get(producer.field),
              consumerSchemas.get(consumer.field),
            ),
            resourceRelationship,
            tagAlignment,
          };
          const confidence = classifyDeterministicEvidence(evidence);
          if (!confidence) continue;
          relationships.push({
            id: relationshipId(producer, consumer),
            producer,
            consumer,
            confidence,
            source: "deterministic",
            evidence,
            explanation: explainEvidence(evidence, producer, consumer),
          });
        }
      }
    }
  }
  return relationships;
}
