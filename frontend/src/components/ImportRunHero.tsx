import type { ReactNode } from "react";
import type { UploadedCollectionSummary } from "../services/externalCollectionsClient";
import { EntryFeatureIcon, type EntryFeatureIconName } from "./EntryFeatureIcon";
import { BUTTON_STYLES } from "./controlStyles";
import { Card } from "./patterns/Card";
import { Pill } from "./patterns/Pill";

const FEATURES = [
  { label: "IMPORT", description: "Use a collection you already trust", icon: "import" },
  { label: "REVIEW", description: "Edit requests before execution", icon: "review" },
  { label: "CONTROL", description: "Choose exactly what runs", icon: "control" },
] as const satisfies ReadonlyArray<{
  label: string;
  description: string;
  icon: EntryFeatureIconName;
}>;

/**
 * The Import & Run Collection header. Full on the Collection step, where it frames the import card
 * (`aside`); on later steps the same header shrinks to its eyebrow and headline so the work starts
 * at the top of the screen instead of below a full-height hero (AP-042).
 */
export function ImportRunHero({
  compact,
  aside,
  extra,
}: Readonly<{
  compact: boolean;
  aside?: ReactNode;
  /** Shown under the feature list on the full header only (AP-046: the coverage entry). */
  extra?: ReactNode;
}>) {
  return (
    <header data-testid="import-run-hero" data-compact={compact}>
      <div className={compact ? "py-1" : "grid items-start gap-4 xl:grid-cols-2"}>
        <div className={compact ? "space-y-1" : "flex min-w-0 flex-col gap-4"}>
          <div className={compact ? "space-y-1" : "space-y-2"}>
            <p className="inline-flex items-center gap-2 rounded bg-lime-pale px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider text-brand-700">
              Bring your own collection
            </p>
            <h2
              className={
                compact
                  ? "font-display text-2xl font-semibold tracking-tight text-text-primary"
                  : "max-w-3xl font-display text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl"
              }
            >
              Run an existing collection against your API
            </h2>
            {!compact && (
              <p className="max-w-2xl text-sm text-text-secondary">
                Import a Postman collection and environment without first uploading an OpenAPI
                specification. Review its requests, choose an order, and explicitly trigger each
                run.
              </p>
            )}
          </div>
          {!compact && (
            <dl className="grid gap-3 sm:grid-cols-3">
              {FEATURES.map(({ label, description, icon }) => (
                <div key={label} className="flex min-w-0 flex-col gap-1 rounded-xl bg-surface-subtle p-3">
                  <dt className="flex items-center gap-2 font-mono text-xs font-semibold text-text-primary">
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mint">
                      <EntryFeatureIcon name={icon} />
                    </span>
                    {label}
                  </dt>
                  <dd className="text-xs text-text-secondary">{description}</dd>
                </div>
              ))}
            </dl>
          )}
          {!compact && extra && <div>{extra}</div>}
        </div>
        {/* Kept mounted when compact (hidden, not removed) so the aside's form state survives. */}
        {aside && <div className={compact ? "hidden" : "min-w-0"}>{aside}</div>}
      </div>
    </header>
  );
}

/** Which collection the later steps are working on, with a way back to pick another. */
export function ImportRunCollectionBar({
  collection,
  requestCount,
  folderCount,
  variableCount,
  onChange,
}: Readonly<{
  collection: UploadedCollectionSummary;
  /** Undefined until the collection view has loaded. */
  requestCount?: number;
  folderCount?: number;
  variableCount?: number;
  onChange: () => void;
}>) {
  const counts =
    requestCount === undefined
      ? undefined
      : `${requestCount} request${requestCount === 1 ? "" : "s"} · ${folderCount ?? 0} folder${folderCount === 1 ? "" : "s"} · ${variableCount ?? 0} variable${variableCount === 1 ? "" : "s"}`;
  return (
    <Card data-testid="import-run-collection-bar" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="font-semibold text-text-primary">{collection.name}</span>
      <Pill tone="line">{collection.tier}</Pill>
      {!collection.confirmedAt && <Pill tone="warn">Unverified</Pill>}
      {counts && <span className="text-xs text-muted">{counts}</span>}
      <button type="button" onClick={onChange} className={`ml-auto ${BUTTON_STYLES.ghost}`}>
        Change collection
      </button>
    </Card>
  );
}
