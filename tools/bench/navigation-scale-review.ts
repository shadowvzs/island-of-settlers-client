import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { beginPersonTrafficTick } from "../../src/shared/settlement/settlement-person-index";
import { isTrafficSegmentClear } from "../../src/shared/settlement/settlement-traffic";
import type {
  SettlementActor,
  SettlementContext
} from "../../src/shared/settlement/settlement-types";

const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ]!;
const reports = [];
for (const count of [100, 300, 1000]) {
  const size = 96;
  const actors = Array.from({ length: count }, (_, uid) => ({
    uid,
    x: 2 + (uid % 40) * 2,
    z: 2 + Math.floor(uid / 40) * 2,
    visible: true,
    phase: "deliver",
    job: uid % 23 ? "Carrier" : "Mount",
    path: [],
    pathIndex: 0,
    action: "carry"
  })) as unknown as SettlementActor[];
  const context = {
    actors,
    buildings: [],
    occupied: new Uint8Array(size ** 2),
    options: {
      world: {
        cellsX: size,
        cellsZ: size,
        walkCost: new Uint8Array(size ** 2).fill(10),
        props: { count: 0 }
      }
    }
  } as unknown as SettlementContext;
  const checks = () => {
    for (const actor of actors)
      assert.equal(
        isTrafficSegmentClear(context, actor, { x: actor.x + 0.02, z: actor.z }, true),
        true
      );
  };
  const run = (indexed: boolean) => {
    const timings = [];
    for (let sample = 0; sample < 50; sample++) {
      const start = performance.now();
      if (indexed) beginPersonTrafficTick(context);
      checks();
      if (sample >= 10) timings.push(performance.now() - start);
    }
    return {
      medianMs: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      p99Ms: percentile(timings, 0.99)
    };
  };
  const fullScan = run(false),
    indexed = run(true);
  reports.push({
    actors: count,
    fullScan,
    indexed,
    medianSpeedup: fullScan.medianMs / indexed.medianMs
  });
}
const output = resolve("../resources/settlement-previews/navigation-recovery");
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, "scale-review.json"),
  JSON.stringify(
    {
      scenario:
        "Every actor validates a .02-tile people-checked movement segment; index rebuild is included",
      samples: 40,
      warmup: 10,
      reports,
      limitations: [
        "Desktop Node CPU microbenchmark, not full simulation or GPU frame timing",
        "Uniformly distributed actors; dense queues retain larger local candidate lists",
        "No physical phone measurements"
      ]
    },
    null,
    2
  )
);
console.log(JSON.stringify(reports, null, 2));
