import type { ReactNode } from "react";
import { WRITE_EFFECT_LABELS } from "@apipilot/shared-domain";
import type { UploadedCollectionSummary } from "../services/externalCollectionsClient";
import { authLabel, formatMinimumTime, type CollectionRunSetup } from "../utils/collectionRunSetup";
import { BUTTON_STYLES } from "./controlStyles";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { Banner } from "./patterns/Banner";
import { Card } from "./patterns/Card";
import { KeyValueGrid } from "./patterns/KeyValueGrid";
import { Pill } from "./patterns/Pill";
import { TABLE_STYLES } from "./patterns/tableStyles";

const SECTION_HEADING = "text-xs font-semibold uppercase tracking-wider text-muted";
const LINK_STYLE =
  "text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300";

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
      <aside data-testid="external-collection-run-details" aria-label="Run details" className="min-w-0">
        <Card className="space-y-4 text-sm">
          <section aria-labelledby="run-hosts-title" className="space-y-1">
            <h4 id="run-hosts-title" className={SECTION_HEADING}>
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
          <section aria-labelledby="run-glance-title" className="space-y-2">
            <h4 id="run-glance-title" className={SECTION_HEADING}>
              At a glance
            </h4>
            <KeyValueGrid
              testId="run-glance"
              items={[
                {
                  label: "Authentication",
                  value: (
                    <span className="flex flex-col text-sm" data-testid="run-auth">
                      {setup.auth.length === 0
                        ? "None"
                        : setup.auth.map((entry) => (
                            <span key={entry.type}>
                              {authLabel(entry.type)} × {entry.count}
                            </span>
                          ))}
                    </span>
                  ),
                },
                { label: "Test scripts", value: `${setup.withTests} of ${selectedCount} requests` },
                { label: "Edited by you", value: `${setup.edited} of ${selectedCount} requests` },
                {
                  label: "Least time",
                  value:
                    setup.minimumDurationMs === null ? (
                      <span className="text-sm font-normal text-text-secondary">Depends on the responses</span>
                    ) : (
                      <span data-testid="run-least-time">{formatMinimumTime(setup.minimumDurationMs)} of delay</span>
                    ),
                },
                ...(setup.folders.length > 0
                  ? [
                      {
                        label: "Requests per folder",
                        value: (
                          <ul className="space-y-0.5 text-sm font-normal" aria-label="Selected requests per folder" data-testid="run-folders">
                            {setup.folders.map((folder) => (
                              <li key={folder.folderPath.join("/")} className="flex items-baseline justify-between gap-2">
                                <span className="font-medium text-text-primary">{folder.folderPath.length === 0 ? "Collection root" : folder.folderPath.join(" / ")}</span>
                                <span className="font-mono text-text-secondary">× {folder.count}</span>
                              </li>
                            ))}
                          </ul>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </section>
          <section aria-labelledby="run-variables-title" className="space-y-2">
            <h4 id="run-variables-title" className={SECTION_HEADING}>
              Variables
            </h4>
            {setup.unresolvedVariables.length > 0 ? (
              <p className="text-left text-xs text-text-primary hyphens-none" data-testid="run-unresolved">
                <Pill tone="warn">Unresolved</Pill> {setup.unresolvedVariables.length} without a
                value:{" "}
                <span className="font-mono">{setup.unresolvedVariables.join(", ")}</span>. Set them under Variables
                in{" "}
                {onOpenVariables ? (
                  <button type="button" onClick={onOpenVariables} className={LINK_STYLE}>
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
              <div
                role="region"
                aria-label="Variables table"
                // Focusable so a keyboard user can scroll a wide or long table.
                tabIndex={0}
                className={`${TABLE_STYLES.scroll} max-h-64 overflow-y-auto border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
              >
                <table className={TABLE_STYLES.table} data-testid="run-variables">
                  <caption className="sr-only">Variables the selected requests use, without their values</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={`${TABLE_STYLES.th} sticky top-0`}>Variable</th>
                      <th scope="col" className={`${TABLE_STYLES.th} sticky top-0`}>Used in</th>
                      <th scope="col" className={`${TABLE_STYLES.th} sticky top-0 text-right`}>Requests</th>
                      <th scope="col" className={`${TABLE_STYLES.th} sticky top-0`}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setup.variables.map((variable) => (
                      <tr key={variable.name}>
                        <th scope="row" className={`${TABLE_STYLES.tdMono} text-left font-normal`}>
                          {onOpenVariables ? (
                            <button type="button" onClick={onOpenVariables} aria-label={`Set ${variable.name} in Review requests`} className={LINK_STYLE}>{`{{${variable.name}}}`}</button>
                          ) : (
                            `{{${variable.name}}}`
                          )}
                        </th>
                        <td className={`${TABLE_STYLES.td} text-xs text-text-secondary`}>{variable.usedIn.join(", ")}</td>
                        <td className={`${TABLE_STYLES.td} text-right tabular-nums`}>{variable.requestCount}</td>
                        <td className={TABLE_STYLES.td}>
                          <Pill tone={variable.resolved ? "ok" : "warn"}>
                            {variable.resolved ? (variable.source === "environment" ? "From environment" : "Collection default") : "No value"}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {setup.writes.length > 0 ? (
            <div role="note" data-testid="run-writes">
              <Banner
                tone="warning"
                title={`${setup.writes.length} ${setup.writes.length === 1 ? "request changes" : "requests change"} data on ${collection.name}.`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <Pill tone="warn">Writes</Pill>
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
                  <div
                    role="region"
                    aria-label="Write requests table"
                    // Focusable so a keyboard user can scroll a wide or long table.
                    tabIndex={0}
                    className={`${TABLE_STYLES.scroll} max-h-96 overflow-y-auto border border-border bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
                  >
                    <table className={TABLE_STYLES.table}>
                      <caption className="sr-only">Write requests the run will send</caption>
                      <thead>
                        <tr>
                          <th scope="col" className={`${TABLE_STYLES.th} sticky top-0 w-24`}>Method</th>
                          <th scope="col" className={`${TABLE_STYLES.th} sticky top-0 w-24`}>Effect</th>
                          <th scope="col" className={`${TABLE_STYLES.th} sticky top-0`}>Request</th>
                        </tr>
                      </thead>
                      <tbody>
                        {setup.writes.map((write) => (
                          <tr key={write.requestId}>
                            <td className={TABLE_STYLES.td}>
                              <HttpMethodBadge method={write.method} />
                            </td>
                            <td className={`${TABLE_STYLES.td} whitespace-nowrap font-semibold`}>{WRITE_EFFECT_LABELS[write.method]}</td>
                            <td className={`${TABLE_STYLES.td} break-words`}>{write.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Banner>
            </div>
          ) : (
            <p className="text-left text-sm text-text-primary hyphens-none" data-testid="run-writes">
              <Pill tone="ok">Read only</Pill> The selected requests only read data.
            </p>
          )}
        </Card>
      </aside>
    );
  }

  return (
    <aside data-testid="external-collection-launch-card" className="min-w-0">
      <Card>
        {/* Two vertical halves on a wide screen so every part fits without a tall card: the launch controls and facts on the left, how the run feeds coverage and the load-test alternative on the right. */}
        <div className={`grid gap-5 ${coverage || loadTest ? "lg:grid-cols-2" : ""}`}>
          <div className="min-w-0 space-y-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${ready ? "bg-accent text-on-accent" : "bg-surface-strong text-muted"}`}
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

            <KeyValueGrid
              testId="run-launch-facts"
              items={[
                { label: "Requests", value: loaded ? `${selectedCount} of ${totalRequests} selected` : "All" },
                { label: "Order", value: customOrder ? "Custom order" : "Collection order" },
                { label: "Tier", value: collection.tier },
                { label: "Delay between requests", value: delay },
              ]}
            />
          </div>
          {(coverage || loadTest) && (
            <div className="min-w-0 space-y-4 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              {coverage && <div>{coverage}</div>}
              {loadTest && <div className={`space-y-2 ${coverage ? "border-t border-border pt-4" : ""}`}>{loadTest}</div>}
            </div>
          )}
        </div>
      </Card>
    </aside>
  );
}
