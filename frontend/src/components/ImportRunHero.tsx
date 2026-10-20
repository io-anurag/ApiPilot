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
 * The Import & Run Collection header. Full on the Collection step, where it frames the import panel
 * (`aside`) beside the headline, centred in the viewport like the Upload screen; on later steps the
 * same header shrinks to its eyebrow and headline so the work starts at the top of the screen
 * instead of below a full-height hero (AP-042).
 */
export function ImportRunHero({
  compact,
  aside,
  extra,
  footer,
}: Readonly<{
  compact: boolean;
  aside?: ReactNode;
  /** Shown under the feature list on the full header only (AP-046: the coverage entry). */
  extra?: ReactNode;
  /** Shown across the bottom of the full header only (the step trail). */
  footer?: ReactNode;
}>) {
  return (
    <header
      data-testid="import-run-hero"
      data-compact={compact}
      className={compact ? undefined : "relative isolate overflow-hidden"}
    >
      <div
        className={
          compact
            ? "py-1"
            : "grid min-h-[calc(100vh-9rem)] grid-cols-1 content-center items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_30rem] lg:gap-x-16"
        }
      >
        {!compact && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[32rem] -translate-x-1/3 -translate-y-1/4 rounded-full bg-brand-500/10 blur-3xl"
          />
        )}
        <div className={compact ? "space-y-1" : "flex min-w-0 flex-col gap-8"}>
          <div className={compact ? "space-y-1" : "space-y-4"}>
            {compact ? (
              <p className="inline-flex items-center gap-2 rounded bg-lime-pale px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider text-brand-700">
                Bring your own collection
              </p>
            ) : (
              <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                <span aria-hidden="true" className="h-3 w-1 rounded-full bg-brand-500" />
                <span>Bring your own collection</span>
              </p>
            )}
            <h2
              className={
                compact
                  ? "font-display text-2xl font-semibold tracking-tight text-text-primary"
                  : "max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight text-text-primary sm:text-5xl"
              }
            >
              Run an existing collection against your API
            </h2>
            {!compact && (
              <p className="max-w-2xl text-base leading-7 text-muted">
                Import a Postman collection and environment without first uploading an OpenAPI
                specification. Review its requests, choose an order, and explicitly trigger each
                run.
              </p>
            )}
          </div>
          {!compact && (
            <dl className="flex max-w-2xl flex-wrap gap-x-6 gap-y-4">
              {FEATURES.map(({ label, description, icon }, index) => (
                <div
                  key={label}
                  className={`flex min-w-[130px] flex-1 flex-col gap-1.5 ${index > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""}`}
                >
                  <EntryFeatureIcon name={icon} />
                  <dt className="font-mono text-xs text-brand-700 dark:text-brand-300">{label}</dt>
                  <dd className="text-xs text-muted">{description}</dd>
                </div>
              ))}
            </dl>
          )}
          {!compact && extra && <div>{extra}</div>}
        </div>
        {/* Kept mounted when compact (hidden, not removed) so the aside's form state survives. */}
        {aside && <div className={compact ? "hidden" : "min-w-0"}>{aside}</div>}
        {!compact && footer && <div className="col-span-full border-t border-border pt-4">{footer}</div>}
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
