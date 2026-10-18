import { useMemo, useState } from "react";
import type { ObservationClass, SecurityObservation } from "@apipilot/shared-domain";
import { EmptyState } from "../EmptyState";
import { FactOriginBadge } from "../FactOriginBadge";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Pagination } from "../Pagination";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { classificationVariant } from "./securityViewModel";

const PAGE_SIZES = [10, 25, 50] as const;

/** Splits `"GET /orders/{id}"` back into a method and a path for display. */
function splitKey(key: string): { method: string; path: string } {
  const space = key.indexOf(" ");
  return { method: key.slice(0, space), path: key.slice(space + 1) };
}

const BASIS_LABEL: Record<string, string> = {
  "format-password": "declared format: password",
  "write-only": "declared writeOnly",
  "user-configured": "configured by you",
  "name-match": "name match only",
  method: "method",
  "path-token": "path segment",
  "identifier-parameter": "identifier parameter",
};

/**
 * Specification-analysis observations as a semantic table (specs/057 FR-008): each row carries its
 * classification as a text badge, the operation it concerns, the rationale in plain language, the
 * specification element it comes from, the basis of the judgement and the origin of the fact. Long lists
 * are paged so a large specification stays practical to read.
 */
export function ObservationList({
  observations,
  caption,
  emptyMessage = "No observations in this group.",
  testId = "observation-list",
}: Readonly<{
  observations: readonly SecurityObservation[];
  caption: string;
  emptyMessage?: string;
  testId?: string;
}>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const visible = useMemo(() => observations.slice((page - 1) * pageSize, page * pageSize), [observations, page, pageSize]);

  if (observations.length === 0) return <EmptyState compact message={emptyMessage} testId={`${testId}-empty`} />;

  return (
    <div data-testid={testId} className="space-y-3">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label={caption}>
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Classification</th>
              <th scope="col" className={TABLE_STYLES.th}>Operation</th>
              <th scope="col" className={TABLE_STYLES.th}>Why it was raised</th>
              <th scope="col" className={TABLE_STYLES.th}>Source element</th>
              <th scope="col" className={TABLE_STYLES.th}>Basis and origin</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((observation) => {
              const variant = classificationVariant(observation.classification as ObservationClass);
              const operation = observation.operationKey ? splitKey(observation.operationKey) : undefined;
              return (
                <tr key={observation.id} data-testid="observation-row" data-rule={observation.ruleId}>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={variant.label} tone={variant.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>
                    {operation ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <HttpMethodBadge method={operation.method} />
                        <span className="break-all font-mono text-xs">{operation.path}</span>
                      </span>
                    ) : (
                      <span className="text-text-secondary">Whole specification</span>
                    )}
                  </td>
                  <td className={`${TABLE_STYLES.td} max-w-md`}>{observation.rationale}</td>
                  <td className={TABLE_STYLES.tdMono}>
                    <span className="break-all">{observation.elementPointer}</span>
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {observation.basis && <span className="text-xs text-text-secondary">{BASIS_LABEL[observation.basis] ?? observation.basis}</span>}
                      <FactOriginBadge origin={observation.origin} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {observations.length > PAGE_SIZES[0] && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={observations.length}
          pageSizeOptions={PAGE_SIZES}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          noun="Observations"
          testId={`${testId}-pagination`}
        />
      )}
    </div>
  );
}
