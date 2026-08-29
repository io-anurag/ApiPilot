/**
 * Minimal in-process FIFO async queue serializing calls to an injected async function
 * (FR-018). No external broker or worker pool — a single local model instance cannot
 * usefully serve fully parallel requests (constitution XXVII).
 */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // The internal tail always settles (regardless of task success/failure) so the
    // queue keeps advancing for subsequent callers even after one task rejects.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
