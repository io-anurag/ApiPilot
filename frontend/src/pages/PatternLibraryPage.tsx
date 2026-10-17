import { useState, type ReactNode } from "react";
import { BUTTON_STYLES, FIELD_STYLES } from "../components/controlStyles";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { HttpMethodBadge } from "../components/HttpMethodBadge";
import { Pagination } from "../components/Pagination";
import { StatTile } from "../components/StatTile";
import { StatusBadge } from "../components/StatusBadge";
import { Banner } from "../components/patterns/Banner";
import { Card, CardHeader } from "../components/patterns/Card";
import { DropZone } from "../components/patterns/DropZone";
import { KeyValueGrid } from "../components/patterns/KeyValueGrid";
import { Pill } from "../components/patterns/Pill";
import { StepTrail, type StepTrailItem } from "../components/patterns/StepTrail";
import { TABLE_STYLES } from "../components/patterns/tableStyles";
import { TaskCard } from "../components/patterns/TaskCard";

const STEPS: readonly StepTrailItem[] = [
  { id: "collection", label: "Collection", hint: "Choose a collection" },
  { id: "review", label: "Review requests", hint: "Check each request" },
  { id: "run", label: "Run", hint: "Start a run" },
  { id: "results", label: "Results", hint: "Nothing yet", lockReason: "Finish a run first" },
];

const ROWS = [
  { method: "GET", path: "/orders", scenarios: 6 },
  { method: "POST", path: "/orders", scenarios: 9 },
  { method: "DELETE", path: "/orders/{id}", scenarios: 3 },
] as const;

function Section({ id, title, note, children }: Readonly<{ id: string; title: string; note: string; children: ReactNode }>) {
  return (
    <Card as="section" aria-labelledby={id}>
      <CardHeader title={title} titleId={id} subtitle={note} />
      {children}
    </Card>
  );
}

/**
 * The pattern library (AP-054 FR-014), opened at `?mock=pattern-library`: one live example of every
 * pattern the screens are built from, in whichever theme and width the window has. A screen must not
 * use a pattern that is not shown here without adding it here. Example data is fictional.
 */
export function PatternLibraryPage() {
  const [step, setStep] = useState("review");
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-5" data-testid="pattern-library">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Design reference</p>
        <h2 className="font-display text-2xl font-bold text-text-primary">Pattern library</h2>
        <p className="max-w-2xl text-sm text-text-secondary">
          Every screen is built from these patterns. Switch the theme and resize the window to check each one in light, dark and narrow.
        </p>
      </header>

      <Section id="pl-stat" title="Stat tile" note="One highlight per group, in mint. Values and sub-lines are always text.">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Operations" value="42" sub="in scope" highlight />
          <StatTile label="Scenarios" value="318" sub="12 pending review" />
          <StatTile label="Failing" value="3" tone="danger" sub="in the last run" />
          <StatTile label="Passing" value="291" tone="success" />
        </dl>
      </Section>

      <Section id="pl-card" title="Widget card" note="The surface every group of content sits on; the flat variant nests inside another card.">
        <Card variant="flat">
          <p className="text-sm text-text-secondary">A flat card, nested.</p>
        </Card>
      </Section>

      <Section id="pl-pill" title="Pill chips and status chips" note="Always text; ok, warn and bad can carry an icon as well.">
        <div className="flex flex-wrap gap-2">
          <Pill tone="accent">Recommended</Pill>
          <Pill tone="mint">Local</Pill>
          <Pill tone="line">Draft</Pill>
          <Pill tone="ok">Passed</Pill>
          <Pill tone="warn">Needs review</Pill>
          <Pill tone="bad">Failed</Pill>
          <StatusBadge label="Completed" tone="success" />
          <StatusBadge label="In progress" tone="info" />
          <StatusBadge label="Cancelled" tone="neutral" />
        </div>
      </Section>

      <Section id="pl-method" title="Method badges" note="HTTP methods keep their saturated identity colours with their labels.">
        <div className="flex flex-wrap gap-2">
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => (
            <HttpMethodBadge key={method} method={method} />
          ))}
        </div>
      </Section>

      <Section id="pl-task" title="Task card" note="A short action or item. Mint by default, lime when it is the one to do next.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TaskCard title="Review 12 pending scenarios" detail="Scenario Review" highlighted onClick={() => undefined} />
          <TaskCard title="Cover 4 operations with no generated tests" detail="Coverage" onClick={() => undefined} />
        </div>
      </Section>

      <Section id="pl-step" title="Stepper" note="Done, current and locked steps. Locked steps say why; state is never colour alone.">
        <StepTrail ariaLabel="Example progress" columns={4} items={STEPS} currentId={step} onSelect={setStep} />
      </Section>

      <Section id="pl-table" title="Table with header tint and pager" note="Wide tables scroll inside their card, never the page.">
        <div className={TABLE_STYLES.scroll}>
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">Example operations</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>Method</th>
                <th scope="col" className={TABLE_STYLES.th}>Path</th>
                <th scope="col" className={TABLE_STYLES.th}>Scenarios</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={`${row.method}${row.path}`}>
                  <td className={TABLE_STYLES.td}>
                    <HttpMethodBadge method={row.method} />
                  </td>
                  <td className={TABLE_STYLES.tdMono}>{row.path}</td>
                  <td className={TABLE_STYLES.td}>{row.scenarios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Pagination page={page} pageSize={pageSize} total={48} pageSizeOptions={[10, 25, 50]} onPageChange={setPage} onPageSizeChange={setPageSize} noun="operations" testId="pattern-library-pagination" />
        </div>
      </Section>

      <Section id="pl-banner" title="Banner" note="Warning, neutral and error, each with an icon and a title.">
        <div className="space-y-3">
          <Banner tone="warning" title="3 operations have no documented success response">
            Scenarios for them assert nothing about the response status.
          </Banner>
          <Banner tone="neutral" title="Runs stay on this machine" />
          <Banner tone="error" role="alert" title="The upload was refused">
            The document is not valid OpenAPI 3.
          </Banner>
        </div>
      </Section>

      <Section id="pl-empty" title="Empty state" note="Says what is missing and, where it helps, what to do.">
        <EmptyState message="No runs yet" description="Start one from Import & Run Collection." testId="pattern-library-empty" />
      </Section>

      <Section id="pl-drop" title="Drop zone" note="A label around a file input, so it stays keyboard reachable.">
        <DropZone
          active={dragging}
          title="Drag and drop a file here"
          hint="or click to browse"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
          }}
        >
          <input type="file" className="sr-only" aria-label="Example file" />
        </DropZone>
      </Section>

      <Section id="pl-kv" title="Key-value block" note="Small labels over values, as a description list.">
        <KeyValueGrid items={[{ label: "Specification", value: "orders.yaml" }, { label: "Operations", value: "42", detail: "3 deprecated" }, { label: "Environment", value: "Staging" }]} />
      </Section>

      <Section id="pl-controls" title="Buttons and form fields" note="Primary is lime with dark text. Field and secondary outlines meet 3:1.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON_STYLES.primary}>Primary</button>
            <button type="button" className={BUTTON_STYLES.secondary}>Secondary</button>
            <button type="button" className={BUTTON_STYLES.primary} disabled>Disabled</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Name
              <input type="text" className={FIELD_STYLES} placeholder="Smoke test" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Method
              <select className={FIELD_STYLES} defaultValue="GET">
                <option>GET</option>
                <option>POST</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm text-text-primary">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" /> Include deprecated
            </label>
          </div>
        </div>
      </Section>

      <Section id="pl-dialog" title="Dialog" note="Opens over a dimmed page, traps focus, closes on Escape and returns focus here.">
        <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setDialogOpen(true)}>
          Open example dialog
        </button>
        {dialogOpen && (
          <ConfirmDialog
            message="Discard the example changes?"
            affectedCount={1}
            confirmLabel="Discard"
            onCancel={() => setDialogOpen(false)}
            onConfirm={() => setDialogOpen(false)}
          />
        )}
      </Section>
    </div>
  );
}
