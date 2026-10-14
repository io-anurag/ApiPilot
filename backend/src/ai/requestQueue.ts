/**
 * Minimal in-process FIFO async queue serializing calls to an injected async function
 * (FR-018). No external broker or worker pool — a single local model instance cannot
 * usefully serve fully parallel requests (constitution XXVII).
 */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private held: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    // A task starts only after the one ahead of it has settled *and* every computation registered
    // through `holdUntilSettled` has too. `held` is read when the task is about to start, not when it
    // is enqueued, so work abandoned while earlier tasks ran is still waited for.
    const result = this.tail.then(() => this.held).then(task);
    // The internal tail always settles (regardless of task success/failure) so the
    // queue keeps advancing for subsequent callers even after one task rejects.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Delays every task not yet started until `work` settles, whether it resolves or rejects, and
   * never surfaces its outcome. For computation its caller has already given up on (a timed-out
   * inference that cannot be interrupted): the caller is released at once, but the next task must
   * not compete with the orphaned work for the machine (specs/013-ai-enhancement-viability FR-017).
   */
  holdUntilSettled(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.held = Promise.all([this.held, settled]);
  }
}
