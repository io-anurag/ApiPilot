import type { ScenarioCategory } from "@apipilot/shared-domain";
import type { SummaryPanelSegment, SummaryTone } from "../components/SummaryPanel";

type ScenarioCategoryGroupKey = "positive" | "missingRequired" | "invalidNegative" | "boundary";

/** Groups data-model.md's ten `ScenarioCategory` values into the four broad buckets a QA
 * engineer scans for when reviewing a generated suite (positive vs. the three ways a negative
 * scenario deliberately violates a constraint). Presentation-only grouping — the underlying
 * `ScenarioCategory` values stay exactly as the deterministic designer produced them; nothing
 * here changes what was generated, only how it's summarized. */
const GROUP_BY_CATEGORY: Record<ScenarioCategory, ScenarioCategoryGroupKey> = {
  positive: "positive",
  "missing-field": "missingRequired",
  "null-value": "missingRequired",
  "empty-value": "missingRequired",
  "invalid-type": "invalidNegative",
  "invalid-format": "invalidNegative",
  "invalid-enum": "invalidNegative",
  "numeric-boundary": "boundary",
  "string-boundary": "boundary",
  "array-boundary": "boundary",
};

const GROUP_ORDER: readonly ScenarioCategoryGroupKey[] = [
  "positive",
  "missingRequired",
  "invalidNegative",
  "boundary",
];

const GROUP_LABEL: Record<ScenarioCategoryGroupKey, string> = {
  positive: "Positive",
  missingRequired: "Missing Required",
  invalidNegative: "Invalid / Negative",
  boundary: "Boundary",
};

const GROUP_TONE: Record<ScenarioCategoryGroupKey, SummaryTone> = {
  positive: "success",
  missingRequired: "warning",
  invalidNegative: "danger",
  boundary: "info",
};

/** Builds `SummaryPanel`/`SummaryBreakdown` segments (in the above fixed order) from a list of
 * generated scenarios' categories. */
export function groupScenarioCategories(
  categories: readonly ScenarioCategory[],
): SummaryPanelSegment[] {
  const counts = new Map<ScenarioCategoryGroupKey, number>(GROUP_ORDER.map((key) => [key, 0]));
  for (const category of categories) {
    const group = GROUP_BY_CATEGORY[category];
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABEL[key],
    count: counts.get(key) ?? 0,
    tone: GROUP_TONE[key],
  }));
}
