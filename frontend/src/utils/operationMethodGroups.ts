import type { ApiOperation } from "@apipilot/shared-domain";
import type { SummaryPanelSegment } from "../components/SummaryPanel";
import { METHOD_FILL_CLASSES } from "../components/httpMethodStyles";

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Groups discovered operations by HTTP method for `SummaryPanel`'s API-review breakdown. A
 * method outside the five above (e.g. HEAD/OPTIONS) is appended in first-seen order with a
 * neutral tone rather than silently dropped. */
export function groupOperationsByMethod(
  operations: readonly ApiOperation[],
): SummaryPanelSegment[] {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const method = operation.method.toUpperCase();
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  const orderedMethods = [
    ...METHOD_ORDER.filter((method) => counts.has(method)),
    ...[...counts.keys()].filter((method) => !METHOD_ORDER.includes(method)),
  ];
  return orderedMethods.map((method) => ({
    key: method,
    label: method,
    count: counts.get(method) ?? 0,
    // The same hues as `HttpMethodBadge` (httpMethodStyles.ts), so a method's colour means the same
    // thing in this breakdown as on every badge; a method without one stays neutral.
    tone: "neutral",
    fillClass: METHOD_FILL_CLASSES[method],
  }));
}
