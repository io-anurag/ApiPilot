/**
 * How a mutation names the part of a request it changes (specs/057 contracts/security-scenario-contract.md).
 * A target is `<location>:<name>`: `body:address.zip` (a dotted path into the JSON body), `query:limit`,
 * `path:orderId` or `header:X-Trace`. The location is a closed set, so a target can only ever name a part of the
 * request the specification defines, never a URL or a host.
 */

export const TARGET_LOCATIONS = ["body", "query", "path", "header"] as const;
export type TargetLocation = (typeof TARGET_LOCATIONS)[number];

export interface RequestTarget {
  readonly location: TargetLocation;
  readonly name: string;
}

export function formatTarget(location: TargetLocation, name: string): string {
  return `${location}:${name}`;
}

/** Parses a target, or returns undefined when it does not follow the grammar exactly. */
export function parseTarget(target: string): RequestTarget | undefined {
  const separator = target.indexOf(":");
  if (separator <= 0) return undefined;
  const location = target.slice(0, separator);
  const name = target.slice(separator + 1);
  if (!(TARGET_LOCATIONS as readonly string[]).includes(location) || name === "") return undefined;
  return { location: location as TargetLocation, name };
}
