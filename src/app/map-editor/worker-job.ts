/** Settles a worker job once: an error rejects, else the value resolves. */
type FinishWorkerJob<T> = (error?: Error, value?: T) => void;

interface WorkerJobOptions<T, Message> {
  /** The job's own worker (a literal `new Worker(new URL(...))`, so the bundler emits it). */
  createWorker: () => Worker;
  /** The rejection when `signal` aborts or `isCurrent` turns false. */
  abortError: () => Error;
  /** Checked every 100 ms: a stale job (the map changed) is aborted. */
  isCurrent?: () => boolean;
  message: unknown;
  signal?: AbortSignal;
  timeoutError: () => Error;
  timeoutMs: number;
  /** The worker failed to load or threw. */
  onError: (event: ErrorEvent) => Error;
  /** A reply: progress, or `finish` with the result or its error. */
  onMessage: (data: Message, finish: FinishWorkerJob<T>) => void;
  /** A reply could not be deserialized. */
  onMessageError?: () => Error;
}

export const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/**
 * One cancellable worker job: a dedicated worker (termination actually stops its CPU work), a time bound,
 * abort / staleness cancellation, and cleanup of the worker, timers and listener once it settles.
 */
export const runWorkerJob = <T, Message>(options: WorkerJobOptions<T, Message>) =>
  new Promise<T>((resolve, reject) => {
    const worker = options.createWorker();
    let settled = false;
    const finish: FinishWorkerJob<T> = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (watch !== undefined) clearInterval(watch);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(options.abortError());
    const { isCurrent } = options;
    const watch = isCurrent ? setInterval(() => { if (!isCurrent()) abort(); }, 100) : undefined;
    const timeout = setTimeout(() => finish(options.timeoutError()), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Message>) => {
      if (!settled) options.onMessage(data, finish);
    };
    worker.onerror = event => finish(options.onError(event));
    const { onMessageError } = options;
    if (onMessageError) worker.onmessageerror = () => finish(onMessageError());
    try {
      worker.postMessage(options.message);
    } catch (error) {
      finish(toError(error));
    }
  });
