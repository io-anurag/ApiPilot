import { describe, expect, it } from "vitest";
import { RequestQueue } from "../../../src/ai/requestQueue";

describe("RequestQueue", () => {
  it("processes enqueued tasks serially in FIFO order", async () => {
    const queue = new RequestQueue();
    const order: number[] = [];

    const first = queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(1);
      return 1;
    });
    const second = queue.enqueue(async () => {
      order.push(2);
      return 2;
    });

    await Promise.all([first, second]);

    expect(order).toEqual([1, 2]);
  });

  it("does not start the second task until the first settles", async () => {
    const queue = new RequestQueue();
    let firstStarted = false;
    let firstFinished = false;
    let secondStartedBeforeFirstFinished = false;

    const first = queue.enqueue(async () => {
      firstStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 30));
      firstFinished = true;
    });
    const second = queue.enqueue(async () => {
      secondStartedBeforeFirstFinished = !firstFinished;
    });

    await Promise.all([first, second]);

    expect(firstStarted).toBe(true);
    expect(secondStartedBeforeFirstFinished).toBe(false);
  });

  it("continues processing subsequent tasks after one task rejects", async () => {
    const queue = new RequestQueue();

    const failing = queue.enqueue(async () => {
      throw new Error("boom");
    });
    const succeeding = queue.enqueue(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(succeeding).resolves.toBe("ok");
  });

  describe("holdUntilSettled (specs/013 FR-017, SC-011)", () => {
    function deferred() {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("does not start the next task until the held work settles, though the task that registered it has finished", async () => {
      const queue = new RequestQueue();
      const abandoned = deferred();
      const started: string[] = [];

      const first = queue.enqueue(async () => {
        queue.holdUntilSettled(abandoned.promise);
        return "first-result";
      });
      const second = queue.enqueue(async () => {
        started.push("second");
        return "second-result";
      });

      await expect(first).resolves.toBe("first-result");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(started).toEqual([]);

      abandoned.resolve();
      await expect(second).resolves.toBe("second-result");
      expect(started).toEqual(["second"]);
    });

    it("releases the queue when the held work rejects, without surfacing that rejection", async () => {
      const queue = new RequestQueue();
      const abandoned = deferred();

      await queue.enqueue(async () => {
        queue.holdUntilSettled(abandoned.promise);
      });
      const second = queue.enqueue(async () => "ran");
      abandoned.reject(new Error("abandoned computation failed"));

      await expect(second).resolves.toBe("ran");
    });

    it("holds every later task, in FIFO order, behind the same abandoned work", async () => {
      const queue = new RequestQueue();
      const abandoned = deferred();
      const order: number[] = [];

      await queue.enqueue(async () => {
        queue.holdUntilSettled(abandoned.promise);
      });
      const rest = [2, 3].map((n) => queue.enqueue(async () => void order.push(n)));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(order).toEqual([]);

      abandoned.resolve();
      await Promise.all(rest);
      expect(order).toEqual([2, 3]);
    });

    it("leaves a queue with no held work behaving exactly as before", async () => {
      const queue = new RequestQueue();
      await expect(queue.enqueue(async () => 1)).resolves.toBe(1);
      await expect(queue.enqueue(async () => 2)).resolves.toBe(2);
    });
  });
});
