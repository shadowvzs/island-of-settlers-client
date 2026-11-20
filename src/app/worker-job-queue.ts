interface WorkerJob<Request> {
  body: Request;
  generation: number;
  label: string;
  reject: (error: Error) => void;
  resolve: (reply: unknown) => void;
  settled: boolean;
  urgent: boolean;
}

/** A queued or in-flight job whose island/session generation was replaced. */
export class WorkerJobInvalidated extends Error {
  constructor() {
    super("Worker job belongs to a replaced island session");
    this.name = "WorkerJobInvalidated";
  }
}

/** One failure settles every outstanding job; callers can reload instead of waiting forever. */
// Request/reply types flow into the returned queue and its callbacks, not just this options signature.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export const createWorkerJobQueue = <Request, Reply>(options: {
  createWorker: () => Worker;
  onReply: (label: string, sentAt: number, reply: Reply) => void;
  size: number;
  /** Cold dev module workers share a large import tree; warm it before starting more. */
  warmFirstWorker?: boolean;
}) => {
  const queued: WorkerJob<Request>[] = [];
  const workers = new Set<Worker>();
  const active = new Map<Worker, WorkerJob<Request>>();
  const idle: Worker[] = [];
  let failure: Error | null = null;
  let released = false;
  let background = false;
  let warmed = !options.warmFirstWorker;
  let generation = 0;

  const settle = (job: WorkerJob<Request>, error?: Error, reply?: unknown) => {
    if (job.settled) return;
    job.settled = true;
    if (error) job.reject(error);
    else job.resolve(reply);
  };
  const invalidated = (job: WorkerJob<Request>) =>
    job.settled || job.generation !== generation;

  const terminate = () => {
    for (const worker of workers) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    workers.clear();
    idle.length = 0;
  };
  const fail = (reason: unknown, label: string) => {
    if (failure) return;
    const detail = reason instanceof Error ? reason.message : String(reason);
    failure = new Error(`Unable to load ${label}: ${detail}`);
    for (const job of [...active.values(), ...queued]) settle(job, failure);
    active.clear();
    queued.length = 0;
    terminate();
  };
  const terminateWhenIdle = () => {
    if (released && !active.size && !queued.length) terminate();
  };
  const dispatch = () => {
    if (failure) return;
    while (queued.length) {
      const job = queued[0]!;
      if (job.generation !== generation) {
        queued.shift();
        settle(job, new WorkerJobInvalidated());
        continue;
      }
      if (background && active.size >= 1 && !job.urgent) return;
      let worker = idle.pop();
      if (!worker) {
        const limit = warmed ? Math.max(1, options.size) : 1;
        if (workers.size >= limit) return;
        try {
          worker = options.createWorker();
        } catch (error) {
          fail(error, job.label);
          return;
        }
        workers.add(worker);
      }
      queued.shift();
      active.set(worker, job);
      const sentAt = performance.now();
      worker.onerror = (event) => {
        event.preventDefault();
        if (invalidated(job)) {
          active.delete(worker!);
          workers.delete(worker!);
          worker!.terminate();
          dispatch();
          return;
        }
        fail(event.message || "The background worker failed", job.label);
      };
      worker.onmessageerror = () => {
        if (invalidated(job)) {
          active.delete(worker!);
          workers.delete(worker!);
          worker!.terminate();
          dispatch();
          return;
        }
        fail("The worker reply could not be read", job.label);
      };
      worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (failure || active.get(worker!) !== job) return;
        if (invalidated(job)) {
          active.delete(worker!);
          idle.push(worker!);
          dispatch();
          queueMicrotask(terminateWhenIdle);
          return;
        }
        try {
          options.onReply(job.label, sentAt, data);
        } catch (error) {
          fail(error, job.label);
          return;
        }
        warmed = true;
        active.delete(worker!);
        idle.push(worker!);
        settle(job, undefined, data);
        dispatch();
        queueMicrotask(terminateWhenIdle);
      };
      try {
        worker.postMessage(job.body);
      } catch (error) {
        fail(error, job.label);
        return;
      }
    }
  };
  const run = <Result>(body: Request, label: string, urgent = false) =>
    new Promise<Result>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const job: WorkerJob<Request> = {
        body,
        generation,
        label,
        reject,
        resolve: resolve as WorkerJob<Request>["resolve"],
        settled: false,
        urgent
      };
      if (urgent) queued.unshift(job);
      else queued.push(job);
      dispatch();
    });
  return {
    keepAlive: () => {
      released = false;
    },
    disposeWhenIdle: () => {
      released = true;
      terminateWhenIdle();
    },
    /** Rejects queued and in-flight jobs of the departed island and stops their worker CPU work. */
    invalidateJobs: () => {
      generation++;
      for (const job of queued) settle(job, new WorkerJobInvalidated());
      queued.length = 0;
      for (const [worker, job] of active) {
        settle(job, new WorkerJobInvalidated());
        active.delete(worker);
        workers.delete(worker);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      dispatch();
    },
    run,
    runInBackground: () => {
      background = true;
    },
    stats: () => ({ active: active.size, generation, queued: queued.length, workers: workers.size })
  };
};
