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
});
