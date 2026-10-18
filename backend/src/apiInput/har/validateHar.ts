import { INPUT_LIMIT_VARIABLES, type InputLimits } from "../limits";
import { InputLimitExceededError, InvalidHarError } from "../errors";

/**
 * Structural validation of a HAR document before any entry is read (specs/056 FR-009). No HAR library
 * is used (FR-032); only the container and the entries list are required, and every entry field is
 * judged later, one entry at a time.
 */

export interface HarMeta {
  entries: unknown[];
  harVersion?: string;
  creator?: string;
  /** `log.pages[].title` values, which are page URLs in captures from browsers. */
  pageTitles: string[];
}

const MAX_PAGES = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A short, single-line label safe to show and log (control characters removed, length capped). */
function label(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex -- stripping control characters from a text label is the point
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
  return cleaned === "" ? undefined : cleaned;
}

export function validateHar(document: Record<string, unknown>, limits: InputLimits): HarMeta {
  const log = document.log;
  if (!isPlainObject(log)) {
    throw new InvalidHarError(
      "The file does not look like a HAR capture: it has no 'log' object. A HAR file is a JSON object with a 'log' that holds an 'entries' list.",
    );
  }
  if (!Array.isArray(log.entries)) {
    throw new InvalidHarError(
      "The capture has no usable 'log.entries' list. Export the capture again from the browser's developer tools or your proxy, with the requests included.",
    );
  }
  if (log.entries.length === 0) {
    throw new InvalidHarError("The capture contains no entries, so there is nothing to import. Capture some traffic and export it again.");
  }
  if (log.entries.length > limits.harMaxEntries) {
    throw new InputLimitExceededError(
      INPUT_LIMIT_VARIABLES.harMaxEntries,
      limits.harMaxEntries,
      `The capture has ${log.entries.length} entries. Capture a narrower session, or filter the requests before saving the HAR.`,
    );
  }

  const pageTitles: string[] = [];
  if (Array.isArray(log.pages)) {
    for (const page of log.pages.slice(0, MAX_PAGES)) {
      if (isPlainObject(page) && typeof page.title === "string") pageTitles.push(page.title);
    }
  }
  const creatorName = isPlainObject(log.creator) ? label(log.creator.name, 80) : undefined;
  const creatorVersion = isPlainObject(log.creator) ? label(log.creator.version, 40) : undefined;
  return {
    entries: log.entries,
    harVersion: label(log.version, 40),
    creator: creatorName === undefined ? undefined : creatorVersion === undefined ? creatorName : `${creatorName} ${creatorVersion}`,
    pageTitles,
  };
}
