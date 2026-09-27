import type { UserSuppliedValueStatus } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";

/**
 * Which values the chosen environment supplies (FR-013, FR-014). Presence only; a value is never
 * shown. A missing value does not block anything: its step is reported as missing data.
 */
export function ValuesChecklist({
  values,
  stepLabel,
}: Readonly<{ values: UserSuppliedValueStatus[]; stepLabel: (stepId: string) => string }>) {
  if (values.length === 0) return <p className="text-sm text-muted">This plan needs no values from the environment.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Values the plan needs from the environment</caption>
        <thead>
          <tr className="bg-chrome text-left text-xs text-muted">
            <th scope="col" className="border-b border-border px-3 py-2 font-semibold">Value</th>
            <th scope="col" className="border-b border-border px-3 py-2 font-semibold">Needed by</th>
            <th scope="col" className="border-b border-border px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value) => (
            <tr key={value.name}>
              <td className="border-b border-border px-3 py-2">
                <span className="font-mono">{value.name}</span> {value.secret && <StatusBadge label="secret" />}
              </td>
              <td className="border-b border-border px-3 py-2 text-xs text-muted">
                {value.source === "base-url" ? "all steps" : value.neededBySteps.map(stepLabel).join(", ")}
              </td>
              <td className="border-b border-border px-3 py-2">
                {value.present ? (
                  <StatusBadge label="Present" tone="success" />
                ) : (
                  <>
                    <StatusBadge label="Missing" tone="warning" />
                    <div className="mt-1 text-xs text-muted">Not sent; the step is reported as missing data.</div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
