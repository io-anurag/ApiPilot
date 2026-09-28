import type { UserSuppliedValueStatus } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";

/**
 * Which values the chosen environment supplies (FR-013, FR-014). Presence only; a value is never
 * shown. A missing value does not block anything: its step is reported as missing data. Sized for
 * the run-setup column: a value needed by more than three steps lists them behind a counted
 * disclosure instead of one long line.
 */
const LISTED_STEPS = 3;

function NeededBy({
  value,
  stepLabel,
}: Readonly<{ value: UserSuppliedValueStatus; stepLabel: (stepId: string) => string }>) {
  if (value.source === "base-url") return <>all steps</>;
  const labels = value.neededBySteps.map(stepLabel);
  if (labels.length <= LISTED_STEPS) return <span className="break-all font-mono">{labels.join(", ")}</span>;
  return (
    <details>
      <summary className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        {labels.length} steps
      </summary>
      <span className="break-all font-mono">{labels.join(", ")}</span>
    </details>
  );
}

export function ValuesChecklist({
  values,
  stepLabel,
}: Readonly<{ values: UserSuppliedValueStatus[]; stepLabel: (stepId: string) => string }>) {
  if (values.length === 0) return <p className="text-sm text-muted">This plan needs no values from the environment.</p>;
  const anyMissing = values.some((value) => !value.present);
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Values the plan needs from the environment</caption>
          <thead>
            <tr className="bg-chrome text-left text-muted dark:bg-white/5">
              <th scope="col" className="px-2 py-1.5 font-semibold">Value</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">Needed by</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value) => (
              <tr key={value.name} className="border-t border-border align-top">
                <td className="px-2 py-1.5">
                  <span className="font-mono">{value.name}</span> {value.secret && <StatusBadge label="secret" />}
                </td>
                <td className="px-2 py-1.5 text-muted">
                  <NeededBy value={value} stepLabel={stepLabel} />
                </td>
                <td className="px-2 py-1.5">
                  {value.present ? <StatusBadge label="Present" tone="success" /> : <StatusBadge label="Missing" tone="warning" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyMissing && <p className="text-xs text-muted">A missing value is not sent; its steps are reported as missing data.</p>}
    </div>
  );
}
