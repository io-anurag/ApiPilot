import type { ReactNode } from "react";
import { BUTTON_STYLES } from "../controlStyles";
import { EntryFeatureIcon, type EntryFeatureIconName } from "../EntryFeatureIcon";
import { WorkflowPathPreview } from "../WorkflowPathPreview";

const FEATURES: ReadonlyArray<{ label: string; description: string; icon: EntryFeatureIconName }> = [
  { label: "CHAINED", description: "Pass values from one step to the next", icon: "direct" },
  { label: "EDITABLE", description: "Every request is yours to write", icon: "control" },
  { label: "LOCAL", description: "Saved on this machine, never re-derived", icon: "local" },
];

const PATH_STEPS = [
  { label: "Source", icon: "upload" },
  { label: "Plan", icon: "performance" },
  { label: "Load profile", icon: "analyze" },
  { label: "Run", icon: "run" },
] as const;

const SOURCES = ["An uploaded specification (Quick Performance Test)", "The guided workflow's approved workflows", "Requests selected in an imported collection"];

/**
 * The Performance Plans screen while no plan exists: the same hero layout as the Quick performance
 * test's upload screen, with the way to start an empty plan and the sources a plan can be seeded from.
 */
export function PlansIntro({ onNewPlan, disabled, children }: Readonly<{ onNewPlan: () => void; disabled: boolean; children?: ReactNode }>) {
  return (
    <section aria-labelledby="chain-plans-title" data-testid="chain-plans-empty" className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[32rem] -translate-x-1/3 -translate-y-1/4 rounded-full bg-brand-500/10 blur-3xl"
      />
      <div className="grid min-h-[calc(100vh-14rem)] content-center items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-x-16">
        <div className="space-y-8">
          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
              <span aria-hidden="true" className="h-3 w-1 rounded-full bg-brand-500" />
              <span>Request chains to k6 performance testing</span>
            </p>
            <h2 id="chain-plans-title" className="max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight text-text-primary sm:text-5xl">
              Build a load test, step by step
            </h2>
            <p className="max-w-2xl text-left text-base leading-7 text-muted hyphens-none">
              Write chains of requests as in Postman, with values passed from one step to the next, then set your load profile and run only
              when you are ready. Plans are saved on this machine and stay yours: nothing is re-derived from a specification or collection.
            </p>
          </div>
          <dl className="flex max-w-2xl flex-wrap gap-x-6 gap-y-4">
            {FEATURES.map(({ label, description, icon }, index) => (
              <div key={label} className={`flex min-w-[130px] flex-1 flex-col gap-1.5 ${index > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""}`}>
                <EntryFeatureIcon name={icon} />
                <dt className="font-mono text-xs text-brand-700 dark:text-brand-300">{label}</dt>
                <dd className="text-xs text-muted">{description}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[6px_6px_0_0_var(--color-border)]">
          <div className="h-1 bg-brand-600" />
          <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-5 py-3">
            <div>
              <p className="text-sm font-semibold text-text-primary">No plans yet</p>
              <p className="mt-0.5 text-xs text-muted">Saved in the local database</p>
            </div>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
          </div>
          <div className="space-y-4 p-5 sm:p-6">
            <div className="space-y-1">
              <h3 className="font-display text-lg font-semibold text-text-primary">Start a plan</h3>
              <p className="text-left text-sm leading-6 text-muted hyphens-none">Begin with an empty plan, or seed a first draft from one of these sources:</p>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {SOURCES.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
            {children}
            <button type="button" className={`${BUTTON_STYLES.primary} w-full`} disabled={disabled} onClick={onNewPlan}>
              New plan
            </button>
          </div>
        </div>
        <WorkflowPathPreview steps={PATH_STEPS} />
      </div>
    </section>
  );
}
