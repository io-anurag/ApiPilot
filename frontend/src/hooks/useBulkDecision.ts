import { useCallback, useState } from "react";

const DEFAULT_BATCH_SIZE = 50;

export interface BulkItemOutcome {
  id: string;
  applied: boolean;
  message?: string;
}

/** One chunk's result: either per-item outcomes, or a single ok/error for the whole chunk. */
export type BulkChunkResult =
  | { ok: true; perItem?: BulkItemOutcome[] }
  | { ok: false; message: string };

export interface BulkFailure {
  id: string;
  message: string;
}

export type BulkDecisionStatus = "idle" | "running" | "done";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Batches a bulk decision against an existing array-accepting endpoint (research.md D5): submits
 * ordered, contiguous chunks of `targetIds` sequentially through the caller-supplied `submit`
 * function, so a real-world-scale bulk action (FR-020) shows genuine incremental progress instead
 * of a single opaque wait. No new backend endpoint is introduced — `submit` is expected to call an
 * existing client function (contracts/bulk-review-actions.md).
 */
export function useBulkDecision(options?: { batchSize?: number }) {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const [status, setStatus] = useState<BulkDecisionStatus>("idle");
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState<BulkFailure[]>([]);

  const reset = useCallback(() => {
    setStatus("idle");
    setTotal(0);
    setProcessed(0);
    setSucceeded(0);
    setFailed([]);
  }, []);

  const run = useCallback(
    async (targetIds: string[], submit: (chunkIds: string[]) => Promise<BulkChunkResult>) => {
      setStatus("running");
      setTotal(targetIds.length);
      setProcessed(0);
      setSucceeded(0);
      setFailed([]);

      const chunks = chunk(targetIds, batchSize);
      let succeededCount = 0;
      const failures: BulkFailure[] = [];

      for (const ids of chunks) {
        const result = await submit(ids);
        if (result.ok && result.perItem) {
          for (const outcome of result.perItem) {
            if (outcome.applied) {
              succeededCount += 1;
            } else {
              failures.push({ id: outcome.id, message: outcome.message ?? "The request could not be applied." });
            }
          }
        } else if (result.ok) {
          succeededCount += ids.length;
        } else {
          for (const id of ids) {
            failures.push({ id, message: result.message });
          }
        }
        setProcessed((prev) => prev + ids.length);
        setSucceeded(succeededCount);
        setFailed([...failures]);
      }

      setStatus("done");
    },
    [batchSize],
  );

  return { status, total, processed, succeeded, failed, run, reset };
}
