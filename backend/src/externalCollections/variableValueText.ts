/**
 * A variable's value as the text ApiPilot stores and shows. A collection's scripts can set any value
 * (`pm.environment.set("id", 42)`), but stored and displayed variable values are strings
 * (`UploadedCollectionSet.variableValues`): strings are kept, numbers and booleans become their
 * text, `null`/`undefined` become empty, and objects and arrays become JSON.
 */
export function toVariableValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value) ?? "";
}

/** Every value as text (`toVariableValueText`), for storing variable values captured during a run or reading stored ones. */
export function toStoredVariableValues(values: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, toVariableValueText(value)]));
}
