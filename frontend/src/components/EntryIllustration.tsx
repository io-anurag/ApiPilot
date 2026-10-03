import { WorkflowIcon } from "./WorkflowIcon";
import { workflowById, type EntryChoice } from "./workflowCatalog";

const OUTPUTS: ReadonlyArray<{ label: string; tone: EntryChoice }> = [
  { label: "Test scenarios", tone: "guided-workflow" },
  { label: "Postman collection", tone: "import-collection" },
  { label: "k6 performance tests", tone: "quick-performance" },
];

/**
 * Decorative start-screen illustration (AP-038 FR-008): an OpenAPI document passing through
 * ApiPilot to the three artifacts it produces. Built from markup, inline SVG and the existing
 * logo — no image asset — and hidden from assistive technology and below `lg`, since the
 * artifact choices and cards beside it carry the same information.
 */
export function EntryIllustration() {
  return (
    <div aria-hidden="true" className="hidden items-center justify-end lg:flex">
      <div className="w-40 -rotate-3 rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-[11px] leading-5 text-slate-300 shadow-lg">
        <span className="mb-1.5 inline-flex items-center gap-1.5 rounded bg-white px-1.5 py-0.5 font-sans text-[10px] font-bold text-slate-900">
          <span className="h-2 w-2 rounded-full bg-success-500" />
          OpenAPI
        </span>
        <div>
          openapi: <span className="text-brand-300">3.0.0</span>
        </div>
        <div>paths:</div>
        <div className="pl-3">/users:</div>
        <div className="pl-6">get:</div>
        <div className="pl-6">post:</div>
      </div>

      <svg viewBox="0 0 32 8" className="h-2 w-8 text-muted" fill="none">
        <path d="M0 4h32" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>

      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface shadow-lg dark:ring-4 dark:ring-white/5">
        <img src="/logo-icon.png" alt="" className="h-14 w-14 object-contain" />
      </div>

      <svg viewBox="0 0 40 144" className="h-36 w-10 text-muted" fill="none">
        <path
          d="M0 72C20 72 20 20 40 20M0 72h40M0 72c20 0 20 52 40 52"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>

      <div className="flex flex-col gap-3">
        {OUTPUTS.map(({ label, tone }) => {
          const workflow = workflowById(tone);
          return (
            <div
              key={label}
              className="flex h-10 w-48 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 shadow-sm"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${workflow.tone.tile}`}
              >
                <WorkflowIcon name={workflow.icon} className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-slate-900 dark:text-white">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
