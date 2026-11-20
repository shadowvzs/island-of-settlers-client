import { BENCH_JSON_PREFIX } from "./ab-extract";

/**
 * Machine-readable bench output for the A/B perf runner (TOOL-4). With `BENCH_JSON=1` (the runner sets it) a bench
 * prints one `BENCH_JSON {...}` line per call; `ab-runner.ts --metric name=json:path` reads it. Without the variable
 * nothing is printed, so the human-readable table stays unchanged.
 */
export const emitBenchJson = (record: Record<string, unknown>) => {
  if (process.env.BENCH_JSON !== "1") return;
  console.log(`${BENCH_JSON_PREFIX}${JSON.stringify(record)}`);
};
