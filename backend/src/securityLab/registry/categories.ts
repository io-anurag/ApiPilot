import {
  GENERATABLE_CATEGORY_IDS,
  SECURITY_CATEGORY_IDS,
  TAXONOMY_EDITION,
  type GeneratableCategoryId,
  type SecurityCategory,
  type SecurityCategoryId,
  type TaxonomyId,
} from "@apipilot/shared-domain";

/**
 * The category registry (specs/057 FR-012 to FR-016, data-model.md section 2). Each category has a stable
 * id, a documented support level, the prerequisites it needs, and a taxonomy mapping. Support level and
 * taxonomy membership are separate attributes (FR-015): a category can be `limited` yet map to a primary
 * OWASP entry. Adding a category is adding an entry here and, for a generatable one, a rule module; nothing
 * in review, execution or reporting changes for the existing categories.
 */

const primary = (id: TaxonomyId) => ({ edition: TAXONOMY_EDITION, id, relation: "primary" as const });
const related = (id: TaxonomyId) => ({ edition: TAXONOMY_EDITION, id, relation: "related" as const });

const CATEGORIES: readonly SecurityCategory[] = Object.freeze([
  {
    id: "authentication",
    name: "Authentication",
    description: "Missing, invalid, malformed and expired credentials against operations that declare a security requirement.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: ["expired-credential"],
    taxonomy: [primary("API2")],
  },
  {
    id: "authorization",
    name: "Authorization",
    description: "Documented access restrictions, roles and permissions, where an expected policy is stated.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: ["identity", "role"],
    taxonomy: [primary("API5")],
    limitationNote: "Scenarios are generated only where the specification or a configured policy states a role requirement.",
  },
  {
    id: "broken-object-level-authorization",
    name: "Broken object level authorization",
    description: "Cross-identity access to a resource another identity owns, for read, update and delete operations.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: ["identity", "ownership", "test-data"],
    taxonomy: [primary("API1")],
    limitationNote: "Needs two identities and resources with known ownership; otherwise scenarios are generated as incomplete.",
  },
  {
    id: "object-property-authorization",
    name: "Object property authorization and mass assignment",
    description: "Setting protected or read-only properties, and optionally verifying the persisted state.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: ["persisted-read"],
    taxonomy: [primary("API3")],
    limitationNote: "Persisted state is verified only where a safe read operation and test data exist.",
  },
  {
    id: "input-validation",
    name: "Input validation",
    description: "Controlled invalid-input, type, format, enum and boundary tests, and selected benign injection probes.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: [],
    // The 2023 edition has no dedicated injection or input-validation entry (research R19), so this is ApiPilot's
    // judgement and is recorded as "related", never "primary".
    taxonomy: [related("API8")],
    limitationNote: "OWASP 2023 has no dedicated input-validation entry; the mapping to API8 is ApiPilot's judgement.",
  },
  {
    id: "resource-consumption",
    name: "Resource consumption and rate limiting",
    description: "Bounded repeated requests against a documented or configured threshold.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: ["threshold"],
    taxonomy: [primary("API4")],
    limitationNote: "Never unbounded: capped by the profile's request budget and the repeat ceiling.",
  },
  {
    id: "sensitive-data-exposure",
    name: "Sensitive data exposure",
    description: "Response checks for fields classified as sensitive with a recorded basis.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: [],
    taxonomy: [primary("API3")],
    limitationNote: "A field is checked only when its sensitivity has a recorded basis beyond its name.",
  },
  {
    id: "security-misconfiguration",
    name: "Security misconfiguration and error handling",
    description: "Documented response headers, method restrictions and information leakage in error responses.",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: [],
    taxonomy: [primary("API8")],
  },
  {
    id: "sensitive-business-flows",
    name: "Sensitive business flows",
    description: "Workflows with a defined expected policy, bounded actions and suitable test data.",
    supportLevel: "limited",
    executable: true,
    generatable: true,
    prerequisites: ["test-data"],
    taxonomy: [primary("API6")],
    limitationNote: "V1 records an observation and a limitation; no executable scenario is generated without a user-defined policy.",
  },
  {
    id: "ssrf-unsafe-consumption",
    name: "SSRF and unsafe API consumption",
    description: "URL-typed inputs and downstream integrations.",
    supportLevel: "limited",
    executable: false,
    generatable: false,
    prerequisites: [],
    taxonomy: [primary("API7"), primary("API10")],
    limitationNote: "Reliable detection needs controlled callback verification or a downstream-integration harness, which does not exist. No detection is claimed.",
  },
  {
    id: "api-inventory",
    name: "API inventory",
    description: "Duplicate or inconsistent operation definitions and deprecation or version metadata within the specification.",
    supportLevel: "analysis-only",
    executable: false,
    generatable: false,
    prerequisites: [],
    taxonomy: [primary("API9")],
    limitationNote: "Limited to the specifications available. Undocumented deployed endpoints are not discovered.",
  },
] satisfies SecurityCategory[]);

export function listCategories(): readonly SecurityCategory[] {
  return CATEGORIES;
}

export function isCategoryId(value: string): value is SecurityCategoryId {
  return (SECURITY_CATEGORY_IDS as readonly string[]).includes(value);
}

export function isGeneratableCategoryId(value: string): value is GeneratableCategoryId {
  return (GENERATABLE_CATEGORY_IDS as readonly string[]).includes(value);
}

export function getCategory(id: SecurityCategoryId): SecurityCategory {
  const category = CATEGORIES.find((candidate) => candidate.id === id);
  if (!category) throw new Error(`Unknown security category '${id}'`);
  return category;
}

/** The taxonomy mapping a scenario of `id` carries, copied so a scenario keeps the edition it was created under. */
export function taxonomyFor(id: GeneratableCategoryId): SecurityCategory["taxonomy"] {
  return getCategory(id).taxonomy.map((entry) => ({ ...entry }));
}

/** Categories that can be sent to a target in V1 (support `supported`, or `limited` and executable). */
export function executableCategoryIds(): GeneratableCategoryId[] {
  return CATEGORIES.filter((category) => category.executable && category.generatable).map(
    (category) => category.id as GeneratableCategoryId,
  );
}
