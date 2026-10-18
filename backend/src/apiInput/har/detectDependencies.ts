import type { DependencyHint } from "@apipilot/shared-domain";
import type { ExtractedEntry } from "./types";

/**
 * Dependency evidence from a capture (specs/056 FR-038, research R19): a value that one response
 * returned and a later request of a different operation sent. It is evidence of a possible
 * relationship, never proof: `POSSIBLE` for one consuming request and `LIKELY` for two or more
 * (assigned when the hints become relationships), and never `CONFIRMED` by itself.
 *
 * The detector sees only digests of distinctive values (a string of at least 8 characters, or an
 * integer of at least 4 digits, off the stoplist), so booleans, short and very common values are
 * never evidence. A value counts only if exactly one `(operation, field)` pair produced it in the
 * capture, so a constant that many responses return cannot link anything. A sample value is carried
 * only when the extraction judged it plainly not sensitive.
 */

const MAX_HINTS = 500;
const PATH_PARAMETER = /^\{(.+)\}$/;

export interface OperationRef {
  method: string;
  /** The inferred path pattern, with `{name}` for path parameters. */
  path: string;
}

export interface EntryOperation {
  entry: ExtractedEntry;
  operation: OperationRef;
}

interface Producer {
  operation: OperationRef;
  field: string;
  order: number;
  sample?: string;
  withheld: boolean;
}

function operationKey(operation: OperationRef): string {
  return `${operation.method} ${operation.path}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `entries` must be in chronological order and limited to the entries that became part of an
 * operation. The result is deterministic: hints are sorted by producer, then consumer.
 */
export function detectDependencies(entries: readonly EntryOperation[]): DependencyHint[] {
  // Which (operation, field) pairs produced each digest, and when.
  const producers = new Map<string, Producer[]>();
  entries.forEach(({ entry, operation }, order) => {
    for (const record of entry.producerValues) {
      if (!record.distinctive) continue;
      const list = producers.get(record.digest) ?? [];
      list.push({ operation, field: record.field, order, sample: record.sample, withheld: record.withheld });
      producers.set(record.digest, list);
    }
  });

  interface Aggregate {
    hint: DependencyHint;
    consumingEntries: Set<number>;
  }
  const aggregates = new Map<string, Aggregate>();

  entries.forEach(({ entry, operation }, order) => {
    const patternSegments = operation.path.split("/").slice(1);
    for (const record of entry.consumerValues) {
      if (!record.distinctive) continue;
      const candidates = producers.get(record.digest);
      if (!candidates) continue;
      // Exactly one producing (operation, field) pair in the whole capture.
      const pairs = new Set(candidates.map((candidate) => `${operationKey(candidate.operation)}\u0000${candidate.field}`));
      if (pairs.size !== 1) continue;
      const producer = candidates.find((candidate) => candidate.order < order && operationKey(candidate.operation) !== operationKey(operation));
      if (!producer) continue;

      let field = record.field;
      if (record.location === "path") {
        const segment = patternSegments[Number(record.field)];
        const parameter = segment === undefined ? undefined : PATH_PARAMETER.exec(segment);
        if (!parameter) continue; // a literal path segment is not a parameter a consumer can be given
        field = parameter[1];
      }
      if (field.includes("[]") || producer.field.includes("[]")) continue;

      const key = [operationKey(producer.operation), producer.field, operationKey(operation), record.location, field].join("\u0001");
      const existing = aggregates.get(key);
      if (existing) {
        existing.consumingEntries.add(entry.index);
        if (record.withheld || producer.withheld) {
          existing.hint.valueWithheld = true;
          delete existing.hint.sampleValue;
        }
        continue;
      }
      const withheld = record.withheld || producer.withheld;
      aggregates.set(key, {
        consumingEntries: new Set([entry.index]),
        hint: {
          origin: "observed",
          producer: { operationMethod: producer.operation.method, operationPath: producer.operation.path, field: producer.field },
          consumer: { operationMethod: operation.method, operationPath: operation.path, field, location: record.location },
          orderObserved: true,
          ...(withheld ? { valueWithheld: true } : producer.sample !== undefined ? { sampleValue: producer.sample } : {}),
        },
      });
    }
  });

  return [...aggregates.values()]
    .map(({ hint, consumingEntries }) => ({ ...hint, matchCount: consumingEntries.size }))
    .sort(
      (a, b) =>
        compare(`${a.producer.operationMethod} ${a.producer.operationPath}`, `${b.producer.operationMethod} ${b.producer.operationPath}`) ||
        compare(a.producer.field, b.producer.field) ||
        compare(`${a.consumer.operationMethod} ${a.consumer.operationPath}`, `${b.consumer.operationMethod} ${b.consumer.operationPath}`) ||
        compare(a.consumer.location, b.consumer.location) ||
        compare(a.consumer.field, b.consumer.field),
    )
    .slice(0, MAX_HINTS);
}
