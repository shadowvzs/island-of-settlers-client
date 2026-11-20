import { expect, it, vi } from "vitest";

import { createWorkerJobQueue } from "../src/app/worker-job-queue";

class FakeWorker {
  onerror: Worker["onerror"] = null;
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  asWorker() {
    return this as unknown as Worker;
  }
  reply(result: number) {
    this.onmessage?.call(this.asWorker(), { data: { result } } as MessageEvent);
  }
  fail() {
    this.onerror?.call(this.asWorker(), {
      message: "Script fetch failed",
      preventDefault() {}
    } as ErrorEvent);
  }
}
const setup = (warmFirstWorker = false, size = 2) => {
  const workers: FakeWorker[] = [];
  const queue = createWorkerJobQueue<number, { result: number }>({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker.asWorker();
    },
    onReply: () => {},
    size,
    warmFirstWorker
  });
  return { queue, workers };
};

it("rejects active, queued and future work and releases failed workers", async () => {
  const { queue, workers } = setup();
  const settled = Promise.allSettled([
    queue.run(1, "one"),
    queue.run(2, "two"),
    queue.run(3, "three")
  ]);
  workers[0]!.fail();
  expect((await settled).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
    "rejected"
  ]);
  expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  await expect(queue.run(4, "four")).rejects.toThrow("Script fetch failed");
});
it("rejects decoding, posting and constructor failures instead of leaving jobs pending", async () => {
  const { queue, workers } = setup();
  // Attach the rejection handler before triggering the worker; this promise is awaited below.
  // oxlint-disable-next-line vitest/valid-expect
  const decoded = expect(queue.run(1, "decode")).rejects.toThrow("could not be read");
  workers[0]!.onmessageerror?.call(workers[0]!.asWorker(), {} as MessageEvent);
  await decoded;
  const broken = new FakeWorker();
  broken.postMessage.mockImplementation(() => {
    throw new Error("Clone failed");
  });
  const posting = createWorkerJobQueue({
    createWorker: () => broken.asWorker(),
    onReply() {},
    size: 1
  });
  await expect(posting.run(1, "post")).rejects.toThrow("Clone failed");
  const constructing = createWorkerJobQueue({
    createWorker: () => {
      throw new Error("Unavailable");
    },
    onReply() {},
    size: 1
  });
  await expect(constructing.run(1, "create")).rejects.toThrow("Unavailable");
});
it("warms one cold module worker then restores configured parallelism", async () => {
  const { queue, workers } = setup(true);
  const results = Promise.all([queue.run(1, "one"), queue.run(2, "two"), queue.run(3, "three")]);
  expect(workers).toHaveLength(1);
  workers[0]!.reply(1);
  expect(workers).toHaveLength(2);
  workers[0]!.reply(2);
  workers[1]!.reply(3);
  expect(await results).toEqual([{ result: 1 }, { result: 2 }, { result: 3 }]);
});
it("invalidates queued and in-flight island jobs and stops their workers", async () => {
  const { queue, workers } = setup(false, 1);
  const active = queue.run(1, "old active");
  const queued = queue.run(2, "old queued");
  queue.invalidateJobs();
  await expect(active).rejects.toThrow("replaced island session");
  await expect(queued).rejects.toThrow("replaced island session");
  expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
  const next = queue.run(3, "new island");
  expect(workers).toHaveLength(2);
  workers[1]!.reply(3);
  expect(await next).toEqual({ result: 3 });
  expect(queue.stats()).toMatchObject({ active: 0, generation: 1, queued: 0, workers: 1 });
});
it("preserves urgent background work and releases idle workers without preventing later jobs", async () => {
  const { queue, workers } = setup();
  queue.runInBackground();
  const results = Promise.all([
    queue.run(1, "one"),
    queue.run(2, "two"),
    queue.run(3, "urgent", true)
  ]);
  expect(workers).toHaveLength(2);
  workers[1]!.reply(3);
  expect(workers[1]!.postMessage).toHaveBeenCalledTimes(1);
  workers[0]!.reply(1);
  workers[0]!.reply(2);
  await results;
  queue.disposeWhenIdle();
  expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  const later = queue.run(4, "later");
  workers[2]!.reply(4);
  await later;
});
