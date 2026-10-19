/**
 * The named product rules behind an expected behavior that the specification does not document (specs/057
 * FR-022, contracts/generation-and-analysis-rules.md section 5). A scenario whose expectation is not
 * documented states one of these by id, so the engineer sees exactly which rule it is judged against, and no status
 * code is ever invented and presented as documented.
 */
export const PRODUCT_RULES = {
  "SL-REJECT-NOT-SUCCESS":
    "A request without valid authorization for an operation that requires it must not be processed as successful.",
  "SL-REJECT-CROSS-IDENTITY":
    "A request acting on another identity's resource without permission must not be processed as successful.",
  "SL-REJECT-INSUFFICIENT-PERMISSION":
    "A request from an identity that lacks the permissions the specification requires must not be processed as successful.",
  "SL-REJECT-PROTECTED-PROPERTY":
    "A request that sets a read-only or protected property must be rejected or must leave the property unchanged.",
  "SL-REJECT-CONSTRAINT-VIOLATION": "A request that violates a declared constraint must not be processed as successful.",
  "SL-REJECT-UNDOCUMENTED-METHOD":
    "A method the specification does not document for a path must not be processed as successful.",
  "SL-LIMIT-ENGAGED":
    "Repeated requests beyond a documented or configured threshold should engage the limit.",
  "SL-NO-LEAK-PATTERN":
    "A response must not contain a stack trace, server banner, internal path, SQL error or secret-shaped value.",
  "SL-NO-SENSITIVE-FIELD":
    "A response must not contain a property that the specification or you classify as sensitive.",
} as const;

export type ProductRuleId = keyof typeof PRODUCT_RULES;

export function isProductRuleId(value: string): value is ProductRuleId {
  return Object.prototype.hasOwnProperty.call(PRODUCT_RULES, value);
}

export function productRuleStatement(id: ProductRuleId): string {
  return PRODUCT_RULES[id];
}
