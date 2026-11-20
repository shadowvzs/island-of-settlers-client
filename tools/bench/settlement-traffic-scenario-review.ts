import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { runTraffic, type ScenarioBuild } from "../../tests/helpers/traffic-scenario";
import * as fixtures from "../../tests/helpers/traffic-scenario-fixtures";
import { resourcesPath } from "./resources-path";

/**
 * Crowd-motion receipt: every shared traffic scenario with its metric vocabulary (completion,
 * overlaps, reversals, frozen strides, yield waits, drift, displacement, path excess, facing,
 * work counters) and wall time. Usage: npx tsx tools/bench/settlement-traffic-scenario-review.ts [label]
 */
const label = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const SCENARIOS: [string, () => ScenarioBuild, number][] = [
  ["head-on", fixtures.headOn, 20],
  ["4-way", fixtures.fourWay, 20],
  ["6v6 platoons", fixtures.platoons, 40],
  ["5x5 streams", fixtures.perpendicularStreams, 40],
  ["corridor 2v2", fixtures.corridorTwoByTwo, 60],
  ["16-star", fixtures.star(16), 60],
  ["gate 6v6", fixtures.gate(6), 60],
  ["ground corridor 1x3v3", fixtures.groundCorridor(1, 3), 60],
  ["ground corridor 2x3v3", fixtures.groundCorridor(2, 3), 60],
  ["road corridor 4v4", fixtures.roadCorridor, 60],
  ["shared goal 4v4", fixtures.sharedGoal(), 30],
  ["idle at waypoint", fixtures.idleAtWaypoint, 20],
  ["builder beside road", fixtures.idleBesideRoad("Builder", "builderWork"), 30],
  ["leveler beside road", fixtures.idleBesideRoad("Leveler", "levelWaiting"), 30],
  ["resting worker beside road", fixtures.idleBesideRoad("Woodcutter", "workerRestWait"), 30],
  ["idle carrier beside road", fixtures.idleBesideRoad("Carrier", "home"), 30],
  ["corridor with idle carrier", fixtures.corridorWithIdler("Carrier", "home"), 30],
  ["doorstep squatter", () => fixtures.doorstepSquatter().scenario, 20]
];

const round = (value: number) => +value.toFixed(3);
const summarize = ([name, build, seconds]: (typeof SCENARIOS)[number]) => {
  const scenario = build();
  const start = performance.now();
  const metrics = runTraffic(scenario.scene.context, scenario.movers, seconds, { scene: scenario.scene });
  const wallMs = performance.now() - start;
  const route = metrics.walked.map((walked, index) => walked - metrics.pathExcess[index]!);
  return {
    bystanderDisplacement: round(metrics.bystanderDisplacement),
    completed: `${metrics.completed}/${scenario.movers.length}`,
    footprintClips: metrics.footprintClips, headingReversals: metrics.headingReversals,
    maxPathExcess: round(metrics.maxPathExcess),
    maxWalkedRatio: round(Math.max(...metrics.walked.map((walked, index) => walked / Math.max(.01, route[index]!)))),
    name, noProgressViolations: metrics.noProgressViolations, overlaps: metrics.overlaps,
    waiterDrift: round(metrics.waiterDrift),
    waitingFacing: `${metrics.waitingFacedSamples}/${metrics.waitingFacingSamples}`,
    walkPoseWhileStill: round(metrics.walkPoseWhileStill), wallMs: round(wallMs), work: metrics.work,
    yieldWait: round(metrics.yieldWait)
  };
};

const report = { label, scenarios: SCENARIOS.map(summarize) };
const directory = resourcesPath("settlement-previews", "traffic-scenarios");
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/receipt-${label}.json`, JSON.stringify(report, null, 2));
for (const entry of report.scenarios) {
  const { work, ...rest } = entry;
  console.log(JSON.stringify({ ...rest, segmentCalls: work.segmentCalls, yieldCalls: work.yieldCalls }));
}
