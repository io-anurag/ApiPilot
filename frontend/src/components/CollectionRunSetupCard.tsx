import type { ReactNode } from "react";
import { WRITE_EFFECT_LABELS } from "@apipilot/shared-domain";
import type { UploadedCollectionSummary } from "../services/externalCollectionsClient";
import type { CollectionRunSetup } from "../utils/collectionRunSetup";
import { BUTTON_STYLES } from "./controlStyles";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge } from "./StatusBadge";

function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="bg-surface-subtle px-3 py-2">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

/**
 * The Run step's right-hand panel, laid out like a performance plan's Run setup card (AP-040): whether
 * a run can start, the launch button, the last run in one line, the run's facts, the hosts it will
 * reach, the variables left unresolved, and a writes warning, so everything the run will do is read
 * in one place before it starts. Presentation only: starting is still the engineer's own click, and
 * the confirmations that gate a first run or a staging/production run are passed in (`gates`) and
 * shown here, unchanged.
 */
export function CollectionRunSetupCard({
  collection,
  setup,
  totalRequests,
  customOrder,
  inProgress,
  starting,
  startDisabled,
  onStart,
  lastRunText,
  onViewResults,
  loadTest,
  gates,
}: Readonly<{
  collection: UploadedCollectionSummary;
  setup: CollectionRunSetup;
  /** Every request in the collection, selected or not; 0 while it has not loaded. */
  totalRequests: number;
  customOrder: boolean;
  inProgress: boolean;
  starting: boolean;
  startDisabled: boolean;
  onStart: () => void;
  /** One line about the newest run ("5 Jan 2026, 10:00 · Completed"), or null when there is none. */
  lastRunText: string | null;
  /** Opens the Results step. */
  onViewResults?: () => void;
  /** The "load test instead" part (plan button and the plans made from collections). */
  loadTest?: ReactNode;
  /** Confirmation prompts and the start error. */
  gates: ReactNode;
}>) {
  const loaded = totalRequests > 0;
  const ready = setup.blockedReason === null && !inProgress;
  let headline = "Not ready to run yet";
  if (inProgress) headline = "Run in progress";
  else if (ready) headline = `Ready to run on ${collection.name} (${collection.tier})`;
  const selectedCount = loaded ? setup.selected.length : 0;
  const delay = collection.requestDelayMs > 0 ? `${collection.requestDelayMs} ms` : "None";

  return (
    <aside
      data-testid="external-collection-launch-card"
      className={`space-y-0 overflow-hidden rounded-xl border bg-surface lg:sticky lg:top-4 lg:max-h-screen lg:overflow-y-auto ${ready ? "border-success-600" : "border-border"}`}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-lg font-bold ${ready ? "border-success-600 bg-success-600/15 text-text-primary" : "border-border bg-surface-strong text-muted"}`}
          >
            {ready ? "✓" : "–"}
          </span>
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-base font-semibold text-text-primary">{headline}</h3>
            {setup.blockedReason && !inProgress && (
              <p className="text-left text-sm font-medium text-text-primary hyphens-none" data-testid="run-blocked">
                {setup.blockedReason}
              </p>
            )}
            {!collection.confirmedAt && (
              <p className="text-left text-xs text-muted hyphens-none">
                This collection is unverified, so you will be asked to confirm before its first run.
              </p>
            )}
            {lastRunText && (
              <p className="text-left text-xs text-muted hyphens-none" data-testid="run-launch-last-run">
                Last run: {lastRunText}
                {onViewResults && (
                  <>
                    {" · "}
                    <button type="button" className={BUTTON_STYLES.ghost} onClick={onViewResults}>
                      View results
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled}
          className={`${BUTTON_STYLES.primary} w-full py-2`}
        >
          {starting ? "Starting…" : "Start run"}
        </button>
        {/* The confirmations answer the Start run click, so they sit right under it, not at the end. */}
        {gates && <div className="space-y-3 empty:hidden">{gates}</div>}
        <p className="text-left text-xs text-muted hyphens-none">
          Each selected request is sent once, in the order shown. Nothing is sent until you start the run.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border" data-testid="run-launch-facts">
        <Fact label="Requests">{loaded ? `${selectedCount} of ${totalRequests} selected` : "All"}</Fact>
        <Fact label="Order">{customOrder ? "Custom order" : "Collection order"}</Fact>
        <Fact label="Tier">{collection.tier}</Fact>
        <Fact label="Delay between requests">{delay}</Fact>
      </dl>

      {loaded && (
        <div className="space-y-3 border-t border-border p-4 text-sm">
          <section aria-labelledby="run-hosts-title" className="space-y-1">
            <h4 id="run-hosts-title" className="text-xs font-semibold uppercase text-muted">
              Hosts
            </h4>
            {setup.hosts.length > 0 ? (
              <ul className="space-y-0.5" data-testid="run-hosts">
                {setup.hosts.map((host) => (
                  <li key={host}>
                    <code className="break-all font-mono text-xs">{host}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-left text-xs text-muted hyphens-none">None, as no request is selected.</p>
            )}
          </section>
          <section aria-labelledby="run-variables-title" className="space-y-1">
            <h4 id="run-variables-title" className="text-xs font-semibold uppercase text-muted">
              Variables
            </h4>
            {setup.unresolvedVariables.length > 0 ? (
              <p className="text-left text-xs text-text-primary hyphens-none" data-testid="run-unresolved">
                <StatusBadge label="Unresolved" tone="warning" /> {setup.unresolvedVariables.length} without a
                value:{" "}
                <span className="font-mono">{setup.unresolvedVariables.join(", ")}</span>. Set them under Variables
                in Review requests.
              </p>
            ) : (
              <p className="text-left text-xs text-muted hyphens-none">Every variable the selected requests use has a value.</p>
            )}
          </section>
        </div>
      )}

      {loaded &&
        (setup.writes.length > 0 ? (
          <div
            role="note"
            data-testid="run-writes"
            className="space-y-2 border-t border-warning-600 bg-warning-600/10 p-4 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label="Writes" tone="warning" />
              <strong>
                {setup.writes.length} {setup.writes.length === 1 ? "request changes" : "requests change"} data on{" "}
                {collection.name}.
              </strong>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Write requests per method">
              {setup.writesByMethod.map((entry) => (
                <li key={entry.method} className="inline-flex items-center gap-1">
                  <HttpMethodBadge method={entry.method} />
                  <span className="font-mono text-xs">× {entry.count}</span>
                </li>
              ))}
            </ul>
            <ul className="max-h-40 space-y-1 overflow-y-auto" aria-label="Write requests">
              {setup.writes.map((write) => (
                <li key={write.requestId} className="flex flex-wrap items-baseline gap-x-2">
                  <HttpMethodBadge method={write.method} />
                  <span className="text-xs font-semibold">{WRITE_EFFECT_LABELS[write.method]}</span>
                  <span className="min-w-0 break-all text-xs">{write.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="border-t border-border p-4 text-left text-sm hyphens-none" data-testid="run-writes">
            <StatusBadge label="Read only" tone="success" /> The selected requests only read data.
          </p>
        ))}

      {loadTest && <div className="space-y-2 border-t border-border p-4">{loadTest}</div>}
    </aside>
  );
}
