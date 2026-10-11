import { useEffect, useId, useState } from "react";
import type { CollectionView } from "@apipilot/shared-domain";
import { fetchUploadedCollections, fetchUploadedCollectionView, type UploadedCollectionSummary } from "../../../services/externalCollectionsClient";
import { ErrorState } from "../../ErrorState";
import { HttpMethodBadge } from "../../HttpMethodBadge";
import { Skeleton } from "../../Skeleton";

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; collections: UploadedCollectionSummary[] };
type ViewState = { kind: "none" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; view: CollectionView };

/**
 * The Operations step for a Postman collection (specs/047-unified-performance-tab FR-008, US4): choose an
 * imported collection, then the requests the plan is seeded from, all selected to begin with. The plan
 * gets one chain per top-level folder in the collection's own run order; reordering and editing are done
 * on the Plan step. Choosing and filtering are the same select-all, clear-all and filter controls as for
 * operations (constitution XXXII).
 */
export function CollectionRequests({
  collectionId,
  selection,
  onCollectionChange,
  onSelectionChange,
}: Readonly<{
  collectionId: string | null;
  selection: readonly string[];
  /** A collection was chosen; its requests start all selected, in run order. */
  onCollectionChange: (collectionId: string | null, requestIds: readonly string[], name?: string) => void;
  onSelectionChange: (requestIds: readonly string[]) => void;
}>) {
  const id = useId();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [view, setView] = useState<ViewState>({ kind: "none" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchUploadedCollections().then((result) => {
      if (!cancelled) setList(result.ok ? { kind: "ready", collections: result.uploadedCollections } : { kind: "error", message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Returning to this step with a collection already chosen: read its requests again, keeping the selection.
  useEffect(() => {
    if (!collectionId) {
      setView({ kind: "none" });
      return;
    }
    let cancelled = false;
    setView({ kind: "loading" });
    void fetchUploadedCollectionView(collectionId).then((result) => {
      if (!cancelled) setView(result.ok ? { kind: "ready", view: result.collectionView } : { kind: "error", message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  async function choose(next: string) {
    if (next === "") return onCollectionChange(null, []);
    const result = await fetchUploadedCollectionView(next);
    if (!result.ok) {
      setView({ kind: "error", message: result.message });
      return onCollectionChange(next, []);
    }
    setView({ kind: "ready", view: result.collectionView });
    onCollectionChange(next, result.collectionView.items.map((item) => item.id), list.kind === "ready" ? list.collections.find((collection) => collection.id === next)?.name : undefined);
  }

  const items = view.kind === "ready" ? view.view.items : [];
  const checked = new Set(selection);
  const needle = query.trim().toLowerCase();
  const shown = items.filter((item) => needle === "" || `${item.name} ${item.raw.url} ${item.raw.method}`.toLowerCase().includes(needle));
  const allChecked = items.length > 0 && items.every((item) => checked.has(item.id));
  const keep = (next: ReadonlySet<string>) => onSelectionChange(items.filter((item) => next.has(item.id)).map((item) => item.id));

  if (list.kind === "loading") {
    return (
      <div role="status" aria-label="Loading collections">
        <Skeleton className="h-16 w-full rounded bg-surface-strong" />
      </div>
    );
  }
  if (list.kind === "error") return <ErrorState message="The collections could not be loaded." detail={list.message} testId="collections-error" />;
  if (list.collections.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted" data-testid="no-collections">
        No Postman collection is imported in this session. Import one in Import &amp; Run Collection, then start from it here.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="collection-requests">
      <div className="max-w-md space-y-1">
        <label htmlFor={`${id}-collection`} className="text-sm font-medium">
          Collection
        </label>
        <select id={`${id}-collection`} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" value={collectionId ?? ""} onChange={(event) => void choose(event.target.value)}>
          <option value="">Choose a collection…</option>
          {list.collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name} ({collection.tier})
            </option>
          ))}
        </select>
      </div>
      {view.kind === "loading" && (
        <div role="status" aria-label="Loading requests">
          <Skeleton className="h-24 w-full rounded bg-surface-strong" />
        </div>
      )}
      {view.kind === "error" && <ErrorState message="The collection's requests could not be loaded." detail={view.message} testId="collection-view-error" />}
      {view.kind === "ready" && items.length === 0 && <p className="text-sm text-muted">This collection has no requests.</p>}
      {view.kind === "ready" && items.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(element) => {
                  if (element) element.indeterminate = selection.length > 0 && !allChecked;
                }}
                onChange={() => keep(allChecked ? new Set() : new Set(items.map((item) => item.id)))}
                className="h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              Select all ({items.length})
            </label>
            <p className="text-sm text-muted" aria-live="polite">
              {selection.length} of {items.length} selected
            </p>
            <label htmlFor={`${id}-filter`} className="sr-only">
              Filter requests
            </label>
            <input
              id={`${id}-filter`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or URL"
              className="w-64 max-w-full rounded-md border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </div>
          <div className="relative max-h-[calc(100dvh-30rem)] min-h-48 overflow-auto rounded-md border border-border">
            <table className="w-full min-w-xl border-collapse text-left text-sm">
              <caption className="sr-only">Requests to include in the plan</caption>
              <thead className="sticky top-0 z-10 bg-surface-subtle text-xs font-semibold text-muted">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Include</span>
                  </th>
                  <th scope="col" className="px-2 py-2">Method</th>
                  <th scope="col" className="px-2 py-2">Request</th>
                  <th scope="col" className="px-2 py-2">URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted">
                      No requests match the filter.
                    </td>
                  </tr>
                )}
                {shown.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-hover">
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={checked.has(item.id)}
                        onChange={() => {
                          const next = new Set(checked);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          keep(next);
                        }}
                        aria-label={item.name}
                        className="h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <HttpMethodBadge method={item.raw.method} />
                    </td>
                    <td className="px-2 py-1.5">{item.name}</td>
                    <td className="px-2 py-1.5 font-mono text-xs break-all">{item.raw.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
