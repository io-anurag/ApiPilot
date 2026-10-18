import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchCategories, fetchScenario, listScenarios, type ScenarioFilterQuery } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { Skeleton } from "../Skeleton";
import { BatchReviewBar } from "./BatchReviewBar";
import { ReviewOutcomes, type ReviewReport } from "./ReviewOutcomes";
import { ScenarioDetail } from "./ScenarioDetail";
import { ScenarioEditor } from "./ScenarioEditor";
import { ScenarioFilters } from "./ScenarioFilters";
import { ScenarioList } from "./ScenarioList";
import { ScenarioReviewActions } from "./ScenarioReviewActions";
import { ScopeBanner } from "./ScopeBanner";
import { EMPTY_FILTERS, activeFilterCount } from "./scenarioViewModel";

const DEFAULT_PAGE_SIZE = 25;

/**
 * The Scenarios area (specs/057 FR-018 to FR-033): generate, find, read, edit and review security scenarios.
 * It composes the scope and generation control, the filters, the batch bar, the list and the one open scenario.
 * Retained scenarios load and read with no specification loaded (FR-004): only generation and the actions that need
 * a specification are unavailable, each with its reason. After any change the list, the open scenario and the batch
 * set are read again, so nothing on screen is older than the change that was just made.
 */
export function ScenariosArea() {
  const categories = useSecurityResource((signal) => fetchCategories({ signal }));
  const [filters, setFilters] = useState<ScenarioFilterQuery>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const focusDetail = useRef(false);
  const headingId = useId();

  const list = useSecurityResource((signal) => listScenarios(filters, { page, pageSize }, { signal }), [filters, page, pageSize]);
  const detail = useSecurityResource((signal) => fetchScenario(selectedId ?? "", { signal }), [selectedId], selectedId !== null);

  const categoryNames = useMemo(
    () => Object.fromEntries((categories.data?.categories ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );

  const openDetail = detail.data !== null && detail.data.scenario.id === selectedId ? detail.data : null;

  // Move focus to the scenario once it has loaded after a choice in the list, so a keyboard or screen reader user lands on it.
  useEffect(() => {
    if (openDetail && focusDetail.current) {
      focusDetail.current = false;
      detailRef.current?.focus();
    }
  }, [openDetail]);

  function refreshAll() {
    list.refresh();
    detail.refresh();
    setEpoch((current) => current + 1);
  }

  function changeFilters(next: ScenarioFilterQuery) {
    setFilters(next);
    setPage(1);
  }

  function select(id: string) {
    focusDetail.current = true;
    setEditing(false);
    setNotice(null);
    setSelectedId(id);
  }

  function reviewed(next: ReviewReport) {
    setReport(next);
    setEditing(false);
    refreshAll();
  }

  let listBody: ReactNode;
  if (list.problem && !list.data) {
    listBody = (
      <ErrorState testId="scenario-list-error" message="The scenarios could not be loaded" detail={`${list.problem.message} This is not an empty list.`}>
        <button type="button" onClick={list.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!list.data) {
    listBody = (
      <div role="status" aria-label="Loading scenarios" className="space-y-3">
        <Skeleton className="h-10 w-full rounded bg-surface-strong" />
        <Skeleton className="h-40 w-full rounded bg-surface-strong" />
      </div>
    );
  } else {
    listBody = (
      <>
        {list.problem && (
          <ErrorState testId="scenario-list-stale" message="Out-of-date list: the latest refresh failed" detail={`${list.problem.message} The scenarios below are from the last successful read.`}>
            <button type="button" onClick={list.refresh} className={BUTTON_STYLES.secondary}>
              Retry
            </button>
          </ErrorState>
        )}
        <ScenarioList
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
          filtered={activeFilterCount(filters) > 0}
          onClearFilters={() => changeFilters(EMPTY_FILTERS)}
        />
      </>
    );
  }

  let detailBody: ReactNode;
  if (selectedId === null) {
    detailBody = <p className="text-sm text-text-secondary">Choose a scenario in the list to read its request, expected behavior, prerequisites and history.</p>;
  } else if (detail.problem && !detail.loading && !openDetail) {
    detailBody = (
      <ErrorState testId="scenario-detail-error" message="The scenario could not be loaded" detail={detail.problem.message}>
        <button type="button" onClick={detail.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!openDetail) {
    detailBody = (
      <div role="status" aria-label="Loading the scenario" className="space-y-2">
        <Skeleton className="h-8 w-1/2 rounded bg-surface-strong" />
        <Skeleton className="h-40 w-full rounded bg-surface-strong" />
      </div>
    );
  } else if (editing) {
    detailBody = (
      <ScenarioEditor
        key={`${openDetail.scenario.id}-${openDetail.scenario.currentVersion}`}
        detail={openDetail}
        onCancel={() => setEditing(false)}
        onReload={() => {
          setEditing(false);
          refreshAll();
        }}
        onSaved={(reply) => {
          setEditing(false);
          setNotice(
            reply.material
              ? `Saved as version ${reply.version}. The edit was material, so earlier approval did not carry over; the scenario is ${reply.reviewState.replace("_", " ")}.`
              : `Saved as version ${reply.version}. The edit was not material, so any approval carried over; the scenario is ${reply.reviewState.replace("_", " ")}.`,
          );
          refreshAll();
        }}
      />
    );
  } else {
    const rejected = openDetail.scenario.reviewState === "rejected";
    detailBody = (
      <>
        {notice && (
          <p role="status" className="mb-3 text-sm font-medium text-text-primary" data-testid="edit-notice">
            {notice}
          </p>
        )}
        <ScenarioDetail
          detail={openDetail}
          headingId={headingId}
          categoryName={categoryNames[openDetail.scenario.categoryId]}
          actions={
            <div className="space-y-2">
              <ScenarioReviewActions scenario={openDetail.scenario} onReviewed={reviewed} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setEditing(true)} disabled={rejected} className={BUTTON_STYLES.secondary}>
                  Edit scenario
                </button>
                {rejected && <span className="text-xs text-text-secondary">A rejected scenario cannot be edited. Reopen it first.</span>}
              </div>
            </div>
          }
        />
      </>
    );
  }

  return (
    <div data-testid="security-scenarios" className="space-y-4" aria-busy={list.loading}>
      <Banner tone="neutral" title="How to read these scenarios" testId="scenario-reading-note">
        A scenario is a proposed test, not a result. Nothing is sent to any target until you approve scenarios and start a run. Approval belongs to one version of a
        scenario: an edit to the test itself needs a new approval.
      </Banner>

      <ScopeBanner categories={categories.data?.categories ?? []} onGenerated={refreshAll} />

      <Card as="section" aria-labelledby="scenarios-heading">
        <CardHeader title="Scenarios" titleId="scenarios-heading" subtitle={list.data ? `${list.data.total} matching the current filters` : undefined} />
        <div className="space-y-4">
          <ScenarioFilters value={filters} onChange={changeFilters} categories={categories.data?.categories ?? []} counts={list.data?.counts} />
          {listBody}
        </div>
      </Card>

      <BatchReviewBar filters={filters} refreshToken={epoch} onReviewed={reviewed} />

      {report && <ReviewOutcomes report={report} onDismiss={() => setReport(null)} />}

      <Card as="section" aria-labelledby="scenario-detail-heading">
        <CardHeader title="Scenario detail" titleId="scenario-detail-heading" />
        <div ref={detailRef} tabIndex={-1} className="focus:outline-none" data-testid="scenario-detail-panel">
          {detailBody}
        </div>
      </Card>
    </div>
  );
}
