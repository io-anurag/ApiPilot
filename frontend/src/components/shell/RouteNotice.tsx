/**
 * Explains why an address was replaced by the nearest valid destination (AP-054 FR-029,
 * contracts/routes.md). The live region is always present so the text is announced when it
 * appears; it is cleared by the next navigation.
 */
export function RouteNotice({ notice }: Readonly<{ notice: string | null }>) {
  return (
    <div role="status" data-testid="route-notice" className={notice ? "mb-4" : undefined}>
      {notice && (
        <p className="rounded-lg border border-border-control bg-lime-pale px-4 py-3 text-sm text-text-primary">
          {notice}
        </p>
      )}
    </div>
  );
}
