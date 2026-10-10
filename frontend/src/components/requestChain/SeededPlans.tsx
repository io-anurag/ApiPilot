import { useContext, useEffect, useState, type ReactNode } from "react";
import type { ChainPlanSummary } from "@apipilot/shared-domain";
import { listPlans, type SeedSourceInput } from "../../services/requestChainClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { ActiveViewContext } from "./activeView";
import { SeedPlanDialog } from "./SeedPlanDialog";

type SeedKind = NonNullable<ChainPlanSummary["seedSource"]>;

/**
 * The request-chain plans already seeded from one kind of source (specs/037-request-chain-performance
 * US5, FR-020): each with its size and an Open action, newest first. Lists nothing while loading, and
 * says so when there is none. Listed again whenever the top-level view changes, since the entry view
 * holding it stays mounted while plans are seeded, renamed or deleted in Performance Plans.
 */
export function SeededPlans({ seedKind, onOpen, emptyText }: Readonly<{ seedKind: SeedKind; onOpen: (planId: string) => void; emptyText: string }>) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; plans: ChainPlanSummary[] }>({ kind: "loading" });
  const activeView = useContext(ActiveViewContext);

  useEffect(() => {
    let cancelled = false;
    void listPlans().then((result) => {
      if (!cancelled) setState(result.ok ? { kind: "ready", plans: result.plans.filter((plan) => plan.seedSource === seedKind) } : { kind: "error", message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, [seedKind, activeView]);

  if (state.kind === "loading") return null;
  if (state.kind === "error") return <ErrorState message="The plans could not be loaded." detail={state.message} testId="seeded-plans-error" />;
  if (state.plans.length === 0) return <p className="text-left text-sm text-muted hyphens-none">{emptyText}</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border" aria-label="Plans seeded from this source" data-testid="seeded-plans">
      {state.plans.map((plan) => (
        <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium">{plan.name}</span>{" "}
            <span className="text-xs text-muted">
              · {plan.chainCount} {plan.chainCount === 1 ? "chain" : "chains"} · {plan.stepCount} {plan.stepCount === 1 ? "step" : "steps"}
            </span>
          </span>
          <button type="button" className={BUTTON_STYLES.ghost} aria-label={`Open ${plan.name}`} onClick={() => onOpen(plan.id)}>
            Open
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * An entry point's performance testing since AP-037 phase two (US5): seed a request-chain plan from
 * this source, or open one seeded from it before. The plan itself, its run and its report live in
 * Performance Plans.
 */
export function SeedFromSource({
  source,
  seedKind,
  title,
  lead,
  defaultName,
  onOpenChainPlan,
  testId,
  children,
  disabledReason,
}: Readonly<{
  source: SeedSourceInput;
  seedKind: SeedKind;
  title: string;
  lead: ReactNode;
  defaultName: string;
  onOpenChainPlan: (planId: string) => void;
  testId: string;
  /** Source-specific controls shown above the plans, such as choosing operations. */
  children?: ReactNode;
  /** When set, creating a plan is not offered and this says why. */
  disabledReason?: string;
}>) {
  const [seeding, setSeeding] = useState(false);
  return (
    <section aria-labelledby={`${testId}-title`} className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid={testId}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${testId}-title`} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" className={BUTTON_STYLES.primary} disabled={Boolean(disabledReason)} title={disabledReason} onClick={() => setSeeding(true)}>
            Create request-chain plan
          </button>
        </div>
        <div className="text-sm text-muted">{lead}</div>
      </div>
      {children}
      {disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}
      <SeededPlans seedKind={seedKind} onOpen={onOpenChainPlan} emptyText="No plan has been created from this source yet." />
      {seeding && (
        <SeedPlanDialog
          source={source}
          defaultName={defaultName}
          onCancel={() => setSeeding(false)}
          onSeeded={(planId) => {
            setSeeding(false);
            onOpenChainPlan(planId);
          }}
        />
      )}
    </section>
  );
}
