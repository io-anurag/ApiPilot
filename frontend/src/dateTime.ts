/**
 * The one way ApiPilot shows a date or time: UTC, in a fixed format, so the same moment reads the same
 * on every screen, in every report and on every machine, whatever its locale or time zone.
 * `2026-10-12T13:32:53.000Z` is `2026-10-12 13:32:53 UTC`, and its time of day is `13:32:53 UTC`.
 * A value that is not a date is returned as it came.
 */

const two = (value: number) => String(value).padStart(2, "0");

function parts(value: string | number | Date): { date: string; time: string } | null {
  const moment = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(moment.getTime())) return null;
  return {
    date: `${moment.getUTCFullYear()}-${two(moment.getUTCMonth() + 1)}-${two(moment.getUTCDate())}`,
    time: `${two(moment.getUTCHours())}:${two(moment.getUTCMinutes())}:${two(moment.getUTCSeconds())}`,
  };
}

/** `2026-10-12 13:32:53 UTC`. */
export function formatDateTimeUtc(value: string | number | Date): string {
  const found = parts(value);
  return found ? `${found.date} ${found.time} UTC` : String(value);
}

/** `13:32:53 UTC`. */
export function formatTimeUtc(value: string | number | Date): string {
  const found = parts(value);
  return found ? `${found.time} UTC` : String(value);
}
