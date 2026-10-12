/**
 * The one way a report shows a date or time: `2026-10-10 14:25:19 UTC`, a fixed format and zone so a
 * report does not depend on the server's locale. The screens use the same format (`frontend/src/dateTime.ts`).
 * A value that is not a date is returned as it came.
 */
export function formatReportTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
