import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { SecurityCategory } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchFinding, listFindings, type FindingFilterQuery } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Card, CardHeader } from "../patterns/Card";
import { Skeleton } from "../Skeleton";
import { FindingDetail } from "./FindingDetail";
import { FindingFilters, FindingsList } from "./FindingsList";
import { activeFindingFilterCount } from "./findingViewModel";

const DEFAULT_PAGE_SIZE = 25;

/**
 * The findings half of the Execution and Findings area (specs/057 FR-054 to FR-059): the filters, the list and the one
 * open finding. Findings are retained work, so they load and read with no specification loaded and after the session
 * that gathered their evidence has ended. After any change the list and the open finding are read again, so nothing on
 * screen is older than the change just made. The selected finding is owned by the caller, so a link from a run result
 * can open one.
 */
export function FindingsPanel({
  filters,
  onFiltersChange,
  categories,
  selectedId,
  onSelect,
  refreshToken,
  onOpenScenario,
  onOpenRun,
}: Readonly<{
  filters: FindingFilterQuery;
  onFiltersChange: (next: FindingFilterQuery) => void;
  categories: readonly SecurityCategory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Changes when something outside has changed findings (a run finished), so the list is read again. */
  refreshToken: number;
  onOpenScenario: (scenarioId: string, version: number) => void;
  onOpenRun: (runId: string) => void;
}>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const detailRef = useRef<HTMLDivElement>(null);
  const focusDetail = useRef(false);
  const headingId = useId();
  const detailHeadingId = useId();

  const list = useSecurityResource((signal) => listFindings(filters, { page, pageSize }, { signal }), [filters, page, pageSize, refreshToken]);
  const detail = useSecurityResource((signal) => fetchFinding(selectedId ?? "", { signal }), [selectedId, refreshToken], selectedId !== null);
  const categoryNames = useMemo(() => Object.fromEntries(categories.map((category) => [category.id, category.name])), [categories]);
  const open = detail.data !== null && detail.data.id === selectedId ? detail.data : null;

  useEffect(() => {
    if (open && focusDetail.current) {
      focusDetail.current = false;
      detailRef.current?.focus();
    }
  }, [open]);

  function refreshAll() {
    list.refresh();
    detail.refresh();
  }

  function changeFilters(next: FindingFilterQuery) {
    onFiltersChange(next);
    setPage(1);
  }

  function select(id: string) {
    focusDetail.current = true;
    onSelect(id);
  }

  let listBody: ReactNode;
  if (list.problem && !list.data) {
    listBody = (
      <ErrorState testId="finding-list-error" message="The findings could not be loaded" detail={`${list.problem.message} This is not an empty list.`}>
        <button type="button" onClick={list.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!list.data) {
    listBody = (
      <div role="status" aria-label="Loading findings" className="space-y-3">
        <Skeleton className="h-10 w-full rounded bg-surface-strong" />
        <Skeleton className="h-32 w-full rounded bg-surface-strong" />
      </div>
    );
  } else {
    listBody = (
      <>
        {list.problem && (
          <ErrorState testId="finding-list-stale" message="Out-of-date list: the latest refresh failed" detail={`${list.problem.message} The findings below are from the last successful read.`}>
            <button type="button" onClick={list.refresh} className={BUTTON_STYLES.secondary}>
              Retry
            </button>
          </ErrorState>
        )}
        <FindingsList
          items={list.data.items}
          total={list.data.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          selectedId={selectedId}
          onSelect={select}
          categoryNames={categoryNames}
          filtered={activeFindingFilterCount(filters) > 0}
          onClearFilters={() => changeFilters({})}
        />
      </>
    );
  }

  let detailBody: ReactNode;
  if (selectedId === null) {
    detailBody = <p className="text-sm text-text-secondary">Choose a finding in the list to read what was expected and observed, its occurrences, remediation and history.</p>;
  } else if (detail.problem && !detail.loading && !open) {
    detailBody = (
      <ErrorState testId="finding-detail-error" message="The finding could not be loaded" detail={detail.problem.message}>
        <button type="button" onClick={detail.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!open) {
    detailBody = (
      <div role="status" aria-label="Loading the finding" className="space-y-2">
        <Skeleton className="h-8 w-1/2 rounded bg-surface-strong" />
        <Skeleton className="h-40 w-full rounded bg-surface-strong" />
      </div>
    );
  } else {
    detailBody = (
      <FindingDetail
        finding={open}
        categoryName={categoryNames[open.categoryId]}
        headingId={detailHeadingId}
        onChanged={refreshAll}
        onOpenScenario={onOpenScenario}
        onOpenRun={onOpenRun}
        onOpenFinding={select}
      />
    );
  }

  return (
    <Card as="section" aria-labelledby={headingId} data-testid="findings-panel">
      <CardHeader title="Findings" titleId={headingId} subtitle="From requests actually sent by a run. A finding is evidence of behavior that differed from what was expected; no finding is not proof of safety." />
      <div className="space-y-4">
        <FindingFilters value={filters} onChange={changeFilters} categories={categories} counts={list.data?.counts} total={list.data?.total} />
        {listBody}
        <div ref={detailRef} tabIndex={-1} className="focus:outline-none" data-testid="finding-detail-panel">
          {detailBody}
        </div>
      </div>
    </Card>
  );
}
