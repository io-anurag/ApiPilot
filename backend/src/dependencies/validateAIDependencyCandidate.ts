import type {
  AIDependencyCandidate,
  AIDependencyValidationFinding,
  ApiModel,
} from "@apipilot/shared-domain";
import { extractConsumerFields, extractProducerFields } from "./fieldExtraction";
import { isDependencyCandidateShape } from "./parseAIDependencyResponse";

/** Shape validation: the candidate must match the supported structure with a confidence in range. */
export function validateAIDependencyCandidateShape(value: unknown): AIDependencyValidationFinding[] {
  const candidateId =
    isRecord(value) && typeof value.candidateId === "string" ? value.candidateId : "unknown";
  const findings: AIDependencyValidationFinding[] = [];
  if (!isDependencyCandidateShape(value)) {
    findings.push({
      code: "invalid-shape",
      message: "Candidate does not match the supported structure",
      candidateId,
    });
    return findings;
  }
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    findings.push({
      code: "invalid-shape",
      message: "Candidate confidence must be between 0 and 1",
      candidateId,
      path: "confidence",
    });
  }
  return findings;
}

/**
 * Semantic validation against the ApiModel: rejects a candidate that references an operation or
 * field the ApiModel does not contain (FR-008), so an AI-suggested relationship can never be
 * treated as usable unless the specification can actually support it.
 */
export function validateAIDependencyCandidateSemantics(
  candidate: AIDependencyCandidate,
  apiModel: ApiModel,
): AIDependencyValidationFinding[] {
  const findings: AIDependencyValidationFinding[] = [];

  const producerOperation = apiModel.operations.find(
    (op) =>
      op.path === candidate.producer.operationPath &&
      op.method.toUpperCase() === candidate.producer.operationMethod.toUpperCase(),
  );
  if (!producerOperation) {
    findings.push({
      code: "operation-not-found",
      message: "Candidate producer references an unknown API operation",
      candidateId: candidate.candidateId,
      path: "producer.operationPath",
    });
  } else if (!extractProducerFields(producerOperation).some((f) => f.field === candidate.producer.field)) {
    findings.push({
      code: "field-not-found",
      message: "Candidate producer references an unknown response field",
      candidateId: candidate.candidateId,
      path: "producer.field",
    });
  }

  const consumerOperation = apiModel.operations.find(
    (op) =>
      op.path === candidate.consumer.operationPath &&
      op.method.toUpperCase() === candidate.consumer.operationMethod.toUpperCase(),
  );
  if (!consumerOperation) {
    findings.push({
      code: "operation-not-found",
      message: "Candidate consumer references an unknown API operation",
      candidateId: candidate.candidateId,
      path: "consumer.operationPath",
    });
  } else if (
    !extractConsumerFields(consumerOperation, apiModel.securitySchemes).some(
      (f) => f.field === candidate.consumer.field && f.location === candidate.consumer.location,
    )
  ) {
    findings.push({
      code: "field-not-found",
      message: "Candidate consumer references an unknown request field",
      candidateId: candidate.candidateId,
      path: "consumer.field",
    });
  }

  return findings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
