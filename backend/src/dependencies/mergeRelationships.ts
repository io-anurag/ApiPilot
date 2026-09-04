import type {
  AIDependencyCandidate,
  ApiDependencyRelationship,
  AIProviderMode,
  DependencyConfidence,
} from "@apipilot/shared-domain";
import { relationshipId } from "./identifiers";

function consumerKey(relationship: ApiDependencyRelationship): string {
  const { consumer } = relationship;
  return `${consumer.operationPath}|${consumer.operationMethod}|${consumer.field}|${consumer.location ?? ""}`;
}

const CONFIDENCE_RANK: Record<ApiDependencyRelationship["confidence"], number> = {
  CONFIRMED: 0,
  LIKELY: 1,
  POSSIBLE: 2,
};

/** Deterministic evidence is preferred over AI-only corroboration (constitution II); an AI-only relationship scores 0. */
function evidenceSignalCount(relationship: ApiDependencyRelationship): number {
  const evidence = relationship.evidence;
  if (!evidence) return 0;
  return [
    evidence.nameMatch,
    evidence.typeMatch,
    evidence.formatMatch,
    evidence.resourceRelationship,
    evidence.tagAlignment,
  ].filter(Boolean).length;
}

/** Confidence rank, then evidence-signal count, then producer path/method/field (research.md). */
function compareCandidates(a: ApiDependencyRelationship, b: ApiDependencyRelationship): number {
  const confidenceDiff = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  if (confidenceDiff !== 0) return confidenceDiff;
  const evidenceDiff = evidenceSignalCount(b) - evidenceSignalCount(a);
  if (evidenceDiff !== 0) return evidenceDiff;
  if (a.producer.operationPath !== b.producer.operationPath) {
    return a.producer.operationPath.localeCompare(b.producer.operationPath);
  }
  if (a.producer.operationMethod !== b.producer.operationMethod) {
    return a.producer.operationMethod.localeCompare(b.producer.operationMethod);
  }
  return a.producer.field.localeCompare(b.producer.field);
}

/**
 * Resolves FR-013a: when more than one CONFIRMED/LIKELY relationship could supply the same
 * consuming field, deterministically picks exactly one producer per the tie-break in research.md.
 * The excluded candidates are returned rather than discarded, so they remain reportable as
 * manual-confirmation candidates.
 */
export function resolveProducerDisambiguation(relationships: ApiDependencyRelationship[]): {
  resolved: ApiDependencyRelationship[];
  excluded: ApiDependencyRelationship[];
} {
  const groups = new Map<string, ApiDependencyRelationship[]>();
  for (const relationship of relationships) {
    const key = consumerKey(relationship);
    const group = groups.get(key);
    if (group) group.push(relationship);
    else groups.set(key, [relationship]);
  }
  const resolved: ApiDependencyRelationship[] = [];
  const excluded: ApiDependencyRelationship[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      resolved.push(group[0]);
      continue;
    }
    const sorted = [...group].sort(compareCandidates);
    resolved.push(sorted[0]);
    excluded.push(...sorted.slice(1));
  }
  return { resolved, excluded };
}

/** AI-reported confidence threshold above which an AI-only relationship reaches LIKELY (data-model.md). */
const AI_ONLY_LIKELY_THRESHOLD = 0.85;

/**
 * Classifies an AI-only relationship (no deterministic corroboration): capped at LIKELY, never
 * CONFIRMED, since a single AI signal is still a single signal (research.md, constitution XV).
 */
export function classifyAIOnlyConfidence(aiConfidence: number): DependencyConfidence {
  return aiConfidence >= AI_ONLY_LIKELY_THRESHOLD ? "LIKELY" : "POSSIBLE";
}

/** Converts a validated AI candidate into a standalone AI-sourced relationship. */
export function candidateToAIRelationship(
  candidate: AIDependencyCandidate,
  response: { modelId: string; provider: AIProviderMode },
): ApiDependencyRelationship {
  return {
    id: relationshipId(candidate.producer, candidate.consumer),
    producer: candidate.producer,
    consumer: candidate.consumer,
    confidence: classifyAIOnlyConfidence(candidate.confidence),
    source: "ai",
    aiCorroboration: {
      aiModel: response.modelId,
      aiProvider: response.provider,
      aiConfidence: candidate.confidence,
      aiRationale: candidate.rationale,
    },
    explanation:
      `AI-suggested: '${candidate.consumer.field}' (${candidate.consumer.operationMethod} ` +
      `${candidate.consumer.operationPath}) is inferred to reference '${candidate.producer.field}' ` +
      `(${candidate.producer.operationMethod} ${candidate.producer.operationPath}). ${candidate.rationale}`,
  };
}

function relationshipFieldPairKey(relationship: ApiDependencyRelationship): string {
  const { producer, consumer } = relationship;
  return [
    producer.operationPath,
    producer.operationMethod,
    producer.field,
    consumer.operationPath,
    consumer.operationMethod,
    consumer.field,
    consumer.location ?? "",
  ].join("|");
}

/**
 * Merges deterministic and AI-derived relationships (FR-006a): when both passes independently
 * find the same producer/consumer field pair, they merge into one relationship that keeps the
 * deterministic classification and evidence as primary, recording the AI output as corroboration
 * that never changes the classification. An AI-only relationship (no deterministic match for that
 * pair) is kept as its own entry.
 */
export function mergeDeterministicAndAI(
  deterministic: ApiDependencyRelationship[],
  ai: ApiDependencyRelationship[],
): ApiDependencyRelationship[] {
  const merged = [...deterministic];
  const indexByKey = new Map(merged.map((relationship, index) => [relationshipFieldPairKey(relationship), index]));

  for (const aiRelationship of ai) {
    const key = relationshipFieldPairKey(aiRelationship);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(aiRelationship);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      source: "deterministic+ai",
      aiCorroboration: aiRelationship.aiCorroboration,
      explanation: `${existing.explanation} Corroborated by AI: ${aiRelationship.aiCorroboration?.aiRationale}`,
    };
  }

  return merged;
}
