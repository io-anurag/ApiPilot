import type { CollectionPlanInfo, ConversionFinding, FindingOwner } from "@apipilot/shared-domain";
import { collectionStepLabel } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../../controlStyles";
import { StatusBadge } from "../../StatusBadge";
import { FINDING_KIND_LABEL, leftOutReasonText } from "../performanceViewModel";

/**
 * AP-036 FR-018 (specs/036-collection-performance-test research R14, R20): the conversion review,
 * the gate before a script can be generated. It states that the requests and scripts were not
 * generated or verified by ApiPilot, and lists, grouped by where each script lives and counted,
 * every statement not converted, every pre-request script, every note, and every request left out.
 * Marking it reviewed records what was reviewed; a later conversion change asks again (R14).
 */
export const REVIEW_TITLE_ID = "conversion-review-title";

const NOTE_KINDS: ReadonlySet<ConversionFinding["kind"]> = new Set(["scope-precedence", "url-encoding", "credential-header", "contradictory-assertions"]);

function ownerKey(owner: FindingOwner): string {
  if (owner.kind === "collection") return "collection";
  return owner.kind === "folder" ? `folder:${owner.folderId}` : `request:${owner.itemId}`;
}

function ownerName(owner: FindingOwner, requestName: (itemId: string) => string): string {
  if (owner.kind === "collection") return "The collection";
  if (owner.kind === "folder") return `Folder ${owner.folderName}`;
  return `Request ${requestName(owner.itemId)}`;
}

function where(finding: ConversionFinding): string {
  const script = finding.event === "prerequest" ? "Pre-request script" : finding.event === "test" ? "Test script" : null;
  const line = finding.line !== null ? `line ${finding.line}${finding.column !== null ? `, column ${finding.column}` : ""}` : null;
  return [script, line].filter(Boolean).join(", ");
}

function FindingItem({ finding, stepLabel }: Readonly<{ finding: ConversionFinding; stepLabel: (stepId: string) => string }>) {
  const location = where(finding);
  return (
    <li className="space-y-0.5 border-t border-border py-2 first:border-t-0" data-testid="conversion-finding">
      <p className="text-sm">
        <span className="font-medium">{FINDING_KIND_LABEL[finding.kind]}</span>
        {finding.detail && <span className="text-muted"> · {finding.detail}</span>}
      </p>
      {location && <p className="text-xs text-muted">{location}</p>}
      {finding.excerpt && <code className="block overflow-x-auto rounded bg-chrome px-2 py-1 font-mono text-xs whitespace-pre dark:bg-white/5">{finding.excerpt}</code>}
      {finding.stepIds.length > 0 && <p className="text-xs text-muted">Applies to {finding.stepIds.map(stepLabel).join(", ")}</p>}
    </li>
  );
}

export function ConversionReview({
  collection,
  busy,
  stepLabel,
  itemLabel,
  onMarkReviewed,
}: Readonly<{
  collection: CollectionPlanInfo;
  busy: boolean;
  stepLabel: (stepId: string) => string;
  /** A collection request's name, by its item id. */
  itemLabel: (itemId: string) => string;
  onMarkReviewed: () => void;
}>) {
  const statements = collection.findings.filter((finding) => !NOTE_KINDS.has(finding.kind));
  const notes = collection.findings.filter((finding) => NOTE_KINDS.has(finding.kind));
  const groups = new Map<string, { owner: FindingOwner; findings: ConversionFinding[] }>();
  for (const finding of statements) {
    const key = ownerKey(finding.owner);
    const group = groups.get(key) ?? { owner: finding.owner, findings: [] };
    group.findings.push(finding);
    groups.set(key, group);
  }
  const { reviewed } = collection.review;
  return (
    <section aria-labelledby={REVIEW_TITLE_ID} className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid="conversion-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={REVIEW_TITLE_ID} tabIndex={-1} className="rounded text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            Conversion review
          </h3>
          <p className="max-w-3xl text-sm">
            The requests and scripts of {collection.collectionName} were not generated or verified by ApiPilot. Its scripts were read, never run: only the statements below
            the grammar recognises became captures and expected statuses. Literal values other than credentials are written into the script as data. Under load, a value is
            captured only when its step receives an expected status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label={reviewed ? "Reviewed" : "Not reviewed"} tone={reviewed ? "success" : "warning"} />
          <button type="button" className={BUTTON_STYLES.primary} disabled={busy || reviewed} onClick={onMarkReviewed}>
            Mark as reviewed
          </button>
        </div>
      </div>

      <details open={!reviewed} className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          Not converted <span className="font-mono text-xs text-muted">{statements.length}</span>
        </summary>
        <div className="space-y-2 px-3 pb-3">
          {statements.length === 0 ? (
            <p className="text-sm text-muted">Every statement of every script that applies to a step was converted.</p>
          ) : (
            [...groups.values()].map((group) => (
              <details key={ownerKey(group.owner)} open className="rounded-md border border-border bg-chrome px-3 py-1 dark:bg-white/5">
                <summary className="cursor-pointer py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  {ownerName(group.owner, itemLabel)} <span className="font-mono text-xs text-muted">{group.findings.length}</span>
                </summary>
                <ul>
                  {group.findings.map((finding, index) => (
                    <FindingItem key={`${finding.kind}-${finding.line ?? "none"}-${index}`} finding={finding} stepLabel={stepLabel} />
                  ))}
                </ul>
              </details>
            ))
          )}
        </div>
      </details>

      {notes.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            Notes <span className="font-mono text-xs text-muted">{notes.length}</span>
          </summary>
          <ul className="px-3 pb-3">
            {notes.map((finding, index) => (
              <FindingItem key={`${finding.kind}-${finding.detail ?? ""}-${index}`} finding={finding} stepLabel={stepLabel} />
            ))}
          </ul>
        </details>
      )}

      {collection.leftOut.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            Left out <span className="font-mono text-xs text-muted">{collection.leftOut.length}</span>
          </summary>
          <ul className="space-y-1 px-3 pb-3 text-sm">
            {collection.leftOut.map((request) => (
              <li key={request.itemId}>
                <span className="font-mono text-xs">{request.method}</span> {collectionStepLabel(request)}{" "}
                <span className="text-muted">· {leftOutReasonText(request)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

