/**
 * AP-036 FR-013 (specs/036-collection-performance-test research R9): the Postman dynamic variables a
 * performance plan may use, generated at run time by ApiPilot's own runtime code. AP-037
 * (specs/037-request-chain-performance research R5) moved the list here unchanged, so the
 * request-chain editor offers and validates the same fixed list the server accepts.
 */
export const SUPPORTED_DYNAMIC_VARIABLES: ReadonlySet<string> = new Set([
  "$guid",
  "$randomUUID",
  "$timestamp",
  "$isoTimestamp",
  "$randomInt",
  "$randomFirstName",
  "$randomLastName",
  "$randomFullName",
  "$randomUserName",
  "$randomEmail",
  "$randomPhoneNumber",
  "$randomAlphaNumeric",
  "$randomBoolean",
]);
