import { TAXONOMY_EDITION, type TaxonomyEdition, type TaxonomyId } from "@apipilot/shared-domain";

/**
 * The OWASP API Security Top 10, 2023 edition, verified on 2026-10-18 against the official edition page
 * (https://owasp.org/API-Security/editions/2023/en/0x11-t10/): specs/057 research R19. The taxonomy is data:
 * a later edition is a new constant and registry mapping, and an existing scenario keeps the edition it was
 * created under (FR-015).
 */

export interface TaxonomyEntry {
  id: TaxonomyId;
  name: string;
}

export const OWASP_API_TOP10_2023: readonly TaxonomyEntry[] = Object.freeze([
  { id: "API1", name: "Broken Object Level Authorization" },
  { id: "API2", name: "Broken Authentication" },
  { id: "API3", name: "Broken Object Property Level Authorization" },
  { id: "API4", name: "Unrestricted Resource Consumption" },
  { id: "API5", name: "Broken Function Level Authorization" },
  { id: "API6", name: "Unrestricted Access to Sensitive Business Flows" },
  { id: "API7", name: "Server Side Request Forgery" },
  { id: "API8", name: "Security Misconfiguration" },
  { id: "API9", name: "Improper Inventory Management" },
  { id: "API10", name: "Unsafe Consumption of APIs" },
]);

export const TAXONOMY_EDITIONS: Readonly<Record<TaxonomyEdition, { title: string; entries: readonly TaxonomyEntry[]; source: string }>> = Object.freeze({
  [TAXONOMY_EDITION]: {
    title: "OWASP API Security Top 10 (2023)",
    entries: OWASP_API_TOP10_2023,
    source: "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
  },
});

export function taxonomyName(edition: TaxonomyEdition, id: TaxonomyId): string {
  return TAXONOMY_EDITIONS[edition].entries.find((entry) => entry.id === id)?.name ?? id;
}
