import type { ReactNode } from "react";
import { WRITE_EFFECT_LABELS } from "@apipilot/shared-domain";
import type { UploadedCollectionSummary } from "../services/externalCollectionsClient";
import { authLabel, formatMinimumTime, type CollectionRunSetup } from "../utils/collectionRunSetup";
import { BUTTON_STYLES } from "./controlStyles";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge } from "./StatusBadge";

function Fact({ label, children, className = "" }: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  return (
    <div className={`bg-surface-subtle px-3 py-2 ${className}`}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

/**
 * The Run step's setup, laid out like a performance plan's Run setup card (AP-040), in two parts. The
 * launch part (whether a run can start, the launch button, the last run in one line, the run's facts,
 * how it feeds API Test Coverage and the load-test alternative) sits full width at the top. The details
 * part (the hosts it will reach, the variables left unresolved and a writes warning) follows it, above
 * the run order, so everything the run will do is read before it starts. Presentation only: starting
 * is still the engineer's own click, and the first-run confirmation for an unverified collection is
 * passed in (`gates`) and shown here, unchanged.
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
  coverage,
  gates,
  part,
  onOpenVariables,
}: Readonly<{
  /** Which part to draw; the Run step draws each in its own place. */
  part: "launch" | "details";
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
  /** The "load test instead" part (plan button and the plans made from collections); drawn by the launch part. */
  loadTest?: ReactNode;
  /** How the run feeds API Test Coverage; drawn by the launch part. */
  coverage?: ReactNode;
  /** Opens where the variables' values are set (the Review requests step); the variable names and the hint link to it. */
  onOpenVariables?: () => void;
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

  if (part === "details") {
    if (!loaded) return null;
    return (
      <aside data-testid="external-collection-run-details" aria-label="Run details" className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
        {loaded && (
          <div className="space-y-4 p-4 text-sm">
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
            {loaded && (
              <section aria-labelledby="run-glance-title" className="space-y-2">
                <h4 id="run-glance-title" className="text-xs font-semibold uppercase text-muted">
                  At a glance
                </h4>
                <dl className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-5" data-testid="run-glance">
                  <Fact label="Authentication">
                    <span className="flex flex-col text-sm" data-testid="run-auth">
                      {setup.auth.length === 0
                        ? "None"
                        : setup.auth.map((entry) => (
                            <span key={entry.type}>
                              {authLabel(entry.type)} × {entry.count}
                            </span>
                          ))}
                    </span>
                  </Fact>
                  <Fact label="Test scripts">
                    {setup.withTests} of {selectedCount} requests
                  </Fact>
                  <Fact label="Edited by you">
                    {setup.edited} of {selectedCount} requests
                  </Fact>
                  <Fact label="Least time">
                    {setup.minimumDurationMs === null ? (
                      <span className="text-sm font-normal text-muted">Depends on the responses</span>
                    ) : (
                      <span data-testid="run-least-time">{formatMinimumTime(setup.minimumDurationMs)} of delay</span>
                    )}
                  </Fact>
                  {setup.folders.length > 0 && (
                    <Fact label="Requests per folder">
                      <ul className="space-y-0.5 text-sm font-normal" aria-label="Selected requests per folder" data-testid="run-folders">
                        {setup.folders.map((folder) => (
                          <li key={folder.folderPath.join("/")} className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-text-primary">{folder.folderPath.length === 0 ? "Collection root" : folder.folderPath.join(" / ")}</span>
                            <span className="font-mono text-muted">× {folder.count}</span>
                          </li>
                        ))}
                      </ul>
                    </Fact>
                  )}
                </dl>
              </section>
            )}
            <section aria-labelledby="run-variables-title" className="space-y-2">
              <h4 id="run-variables-title" className="text-xs font-semibold uppercase text-muted">
                Variables
              </h4>
              {setup.unresolvedVariables.length > 0 ? (
                <p className="text-left text-xs text-text-primary hyphens-none" data-testid="run-unresolved">
                  <StatusBadge label="Unresolved" tone="warning" /> {setup.unresolvedVariables.length} without a
                  value:{" "}
                  <span className="font-mono">{setup.unresolvedVariables.join(", ")}</span>. Set them under Variables
                  in{" "}
                  {onOpenVariables ? (
                    <button type="button" onClick={onOpenVariables} className="text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">
                      Review requests
                    </button>
                  ) : (
                    "Review requests"
                  )}
                  .
                </p>
              ) : (
                <p className="text-left text-xs text-muted hyphens-none">
                  {setup.variables.length === 0
                    ? "The selected requests use no variables."
                    : "Every variable the selected requests use has a value."}
                </p>
              )}
              {setup.variables.length > 0 && (
                <div className="max-h-64 max-w-full overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-xs" data-testid="run-variables">
                    <caption className="sr-only">Variables the selected requests use, without their values</caption>
                    <thead className="sticky top-0 bg-chrome text-muted">
                      <tr>
                        <th scope="col" className="px-3 py-1.5 font-semibold">Variable</th>
                        <th scope="col" className="px-3 py-1.5 font-semibold">Used in</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-semibold">Requests</th>
                        <th scope="col" className="px-3 py-1.5 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {setup.variables.map((variable) => (
                        <tr key={variable.name}>
                          <th scope="row" className="px-3 py-1 font-mono font-normal">
                            {onOpenVariables ? (
                              <button type="button" onClick={onOpenVariables} aria-label={`Set ${variable.name} in Review requests`} className="text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">{`{{${variable.name}}}`}</button>
                            ) : (
                              `{{${variable.name}}}`
                            )}
                          </th>
                          <td className="px-3 py-1 text-muted">{variable.usedIn.join(", ")}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{variable.requestCount}</td>
                          <td className="px-3 py-1">
                            <StatusBadge
                              label={variable.resolved ? (variable.source === "environment" ? "From environment" : "Collection default") : "No value"}
                              tone={variable.resolved ? "success" : "warning"}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {loaded &&
          (setup.writes.length > 0 ? (
            <div role="note" data-testid="run-writes" className="space-y-3 border-t border-warning-600 bg-warning-600/10 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label="Writes" tone="warning" />
                  <strong>
                    {setup.writes.length} {setup.writes.length === 1 ? "request changes" : "requests change"} data on{" "}
                    {collection.name}.
                  </strong>
                </div>
                <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Write requests per method">
                  {setup.writesByMethod.map((entry) => (
                    <li key={entry.method} className="inline-flex items-center gap-1">
                      <HttpMethodBadge method={entry.method} />
                      <span className="font-mono text-xs">× {entry.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* Fixed columns, so the badges and labels line up whatever their width. */}
              <div className="max-h-72 max-w-full overflow-auto rounded-md border border-warning-600/40 bg-surface">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Write requests the run will send</caption>
                  <thead className="sticky top-0 bg-surface-subtle text-muted">
                    <tr>
                      <th scope="col" className="w-24 px-3 py-1.5 font-semibold">Method</th>
                      <th scope="col" className="w-24 px-3 py-1.5 font-semibold">Effect</th>
                      <th scope="col" className="px-3 py-1.5 font-semibold">Request</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {setup.writes.map((write) => (
                      <tr key={write.requestId}>
                        <td className="px-3 py-1.5">
                          <HttpMethodBadge method={write.method} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{WRITE_EFFECT_LABELS[write.method]}</td>
                        <td className="break-words px-3 py-1.5">{write.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="border-t border-border p-4 text-left text-sm hyphens-none" data-testid="run-writes">
              <StatusBadge label="Read only" tone="success" /> The selected requests only read data.
            </p>
          ))}

      </aside>
    );
  }

  return (
    <aside
      data-testid="external-collection-launch-card"
      className={`space-y-0 overflow-hidden rounded-xl border bg-surface ${ready ? "border-success-600" : "border-border"}`}
    >
      {/* Two vertical halves on a wide screen so every part fits without a tall card: the launch controls and facts on the left, how the run feeds coverage and the load-test alternative on the right. */}
      <div className={`grid ${coverage || loadTest ? "lg:grid-cols-2" : ""}`}>
        <div className="min-w-0">
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
        </div>
        {(coverage || loadTest) && (
          <div className="min-w-0 border-t border-border lg:border-l lg:border-t-0">
            {coverage && <div className="p-4">{coverage}</div>}
            {loadTest && <div className={`space-y-2 p-4 ${coverage ? "border-t border-border" : ""}`}>{loadTest}</div>}
          </div>
        )}
      </div>
    </aside>
  );
}
