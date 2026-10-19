import type { SecurityExportReply } from "@apipilot/shared-domain";
import { specificationRevision } from "../../apiCoverage/specRevision";
import { generateSecurityCollection, type ApprovedSecurityVersion } from "../../postman/generateSecurityCollection";
import { SecurityLabError, invalidRequest, noSpecification } from "../errors";
import { hasLiveApproval } from "../review/reviewService";
import { flagResolver, type ScenarioContext } from "../scenarios/scenarioService";

/**
 * `GET /export/postman` (specs/057 FR-063, contracts/security-lab-api.md). It collects the scenarios whose **current
 * version is approved and whose approval still matches its content**, leaves out any whose operation changed or went
 * away since it was generated (it cannot be exported faithfully), and hands the rest to the deterministic generator.
 * A refusal from the generator is returned with its own code, so the person learns why. Nothing is sent anywhere.
 */

export interface ExportQuery {
  baseUrl?: string;
  collectionName?: string;
}

export function parseExportQuery(raw: Record<string, unknown>): ExportQuery {
  const query: ExportQuery = {};
  if (raw.baseUrl !== undefined && raw.baseUrl !== "") {
    if (typeof raw.baseUrl !== "string") throw invalidRequest("'baseUrl' must be an absolute http or https URL.");
    let url: URL;
    try {
      url = new URL(raw.baseUrl);
    } catch {
      throw invalidRequest("'baseUrl' must be an absolute http or https URL.");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
      throw invalidRequest("'baseUrl' must be an http or https URL with no credentials.");
    }
    query.baseUrl = url.toString().replace(/\/$/, "");
  }
  if (raw.collectionName !== undefined && raw.collectionName !== "") {
    if (typeof raw.collectionName !== "string" || raw.collectionName.length > 100) throw invalidRequest("'collectionName' must be a string of at most 100 characters.");
    query.collectionName = raw.collectionName.trim();
  }
  return query;
}

export function exportPostman(context: ScenarioContext, query: ExportQuery): SecurityExportReply {
  const model = context.workflow?.apiModel;
  if (!model) throw noSpecification();
  const { repo, ownerId } = context;
  const resolve = flagResolver(context);

  const approved: ApprovedSecurityVersion[] = [];
  const excluded: SecurityExportReply["excluded"] = [];
  for (const head of repo.listHeads(ownerId, { reviewState: "approved" })) {
    const version = repo.getVersion(ownerId, head.id, head.currentVersion);
    if (!version || !hasLiveApproval(version) || !version.approval) continue;
    const flags = resolve(head, version);
    if (flags.orphaned) excluded.push({ scenarioId: head.id, reason: "orphaned" });
    else if (flags.stale) excluded.push({ scenarioId: head.id, reason: "stale" });
    else approved.push({ scenarioId: head.id, version: version.version, contentHash: version.contentHash, approvedContentHash: version.approval.contentHash, content: version.content });
  }

  if (approved.length === 0) {
    throw new SecurityLabError(
      "no_approved_scenarios",
      excluded.length > 0
        ? "Every approved scenario is out of date with the specification, so none can be exported. Regenerate and review them first."
        : "There are no approved scenarios to export. Approve at least one scenario first.",
      { excluded },
    );
  }

  const outcome = generateSecurityCollection(model, approved, { ...query, specificationRevision: specificationRevision(model) });
  if (!outcome.ok) {
    throw new SecurityLabError("export_failed", outcome.failure.message, { failureCode: outcome.failure.code, ...(outcome.failure.problems ? { problems: outcome.failure.problems } : {}) });
  }
  return { ...outcome.result, excluded };
}
