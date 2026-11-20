import { ROAD_SPEED } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import {
  RUN_GROUND_SPEED,
  WALK_GROUND_SPEED
} from "../../../island-of-settlers-worker-generation/src/worker-locomotion";
import {
  WORKER_COLLISION_RADIUS,
  WORKER_HEIGHT,
  WORKER_RADIUS,
  WORKER_SCALE
} from "../../src/render-common/workers/worker-dimensions";
import { ROAD_GRID_STEP } from "../../src/shared/settlement/road-types";
import { getVertexIndex, sampleBilinear } from "../../src/shared/world/grid-geometry";
import {
  arrowContactProbabilities,
  DEFAULT_RULES,
  expectedDamage,
  type Rank,
  REFINED_CANDIDATE,
  sampleArrowContact} from "./military-balance-simulator";
const grid = { cellsX: 3, cellsZ: 3 },
  plane = new Float32Array(16);
for (let z = 0; z <= 3; z++)
  for (let x = 0; x <= 3; x++) plane[getVertexIndex(grid, x, z)] = x + 2 * z;
assert.equal(sampleBilinear(grid, plane, 1.25, 1.5), 4.25);
assert.equal(sampleBilinear(grid, plane, 2.25, 1.5) - sampleBilinear(grid, plane, 1.25, 1.5), 1);
assert.equal(ROAD_GRID_STEP, 0.5);
const rules = { ...DEFAULT_RULES, archerAimError: true };
const contacts = ([1, 2, 3] as Rank[]).flatMap((rank) =>
  [4, 8, 12].map((distance) => ({ rank, distance, ...arrowContactProbabilities(distance, rank) }))
);
for (const rank of [1, 2, 3] as Rank[]) {
  const p = arrowContactProbabilities(8, rank),
    accuracy = [0.7, 0.8, 0.9][rank - 1]!;
  assert(Math.abs(p.full - accuracy) < 1e-12);
  assert.equal(sampleArrowContact(8, rank, p.full / 2), "full");
  assert.equal(sampleArrowContact(8, rank, p.full + p.glancing / 2), "glancing");
  assert.equal(sampleArrowContact(8, rank, 1 - p.miss / 2), "miss");
  const armor = REFINED_CANDIDATE.shield.armor[rank - 1]!;
  const critical = [0, 0.05, 0.1][rank - 1]!;
  const mean = 20 * 0.67 * (1 - armor) * (p.full * (1 + 0.5 * critical) + p.glancing * 0.5);
  assert(
    Math.abs(
      expectedDamage({ kind: "archer", rank }, { kind: "shield", rank }, REFINED_CANDIDATE, rules) -
        mean
    ) < 1e-12
  );
}
const walk = WALK_GROUND_SPEED * WORKER_SCALE,
  run = RUN_GROUND_SPEED * WORKER_SCALE;
const report = {
  grid: {
    cellsPerWorldUnit: 1,
    worldUnitsPerCell: 1,
    roadHalfStep: ROAD_GRID_STEP,
    diagonalCellDistance: Math.SQRT2,
    rangeMetric: "Euclidean XZ distance, not cell-count path steps"
  },
  sources: {
    renderer:
      "src/render-common/chunk-sampling.ts:166-168 writes x/z directly into rendered positions",
    grid: "src/shared/world/grid-geometry.ts sampleBilinear and getCircleRegion consume the same world coordinates",
    movement:
      "src/shared/settlement/settlement-paths.ts:114-117 uses Euclidean distance and dt*groundSpeed; soldiers use generic.9 until live per-type movement added",
    road: "src/shared/settlement/road-types.ts dirt1/stone1.5 applies to Carrier/Mount in current paths, not soldiers"
  },
  worker: {
    heightCells: WORKER_HEIGHT,
    modelToWorldScale: WORKER_SCALE,
    physicalRadius: WORKER_RADIUS,
    navigationRadius: WORKER_COLLISION_RADIUS,
    authoredWalk: walk,
    authoredRun: run
  },
  refinedSpeeds: Object.fromEntries(
    Object.entries(REFINED_CANDIDATE).map(([kind, p]) => [
      kind,
      {
        cellsPerSecond: p.speed,
        flat8CellTravelSeconds: 8 / p.speed,
        currentGenericSoldierSpeedRatio: p.speed / 0.9,
        authoredRunRatio: p.speed / run
      }
    ])
  ),
  roads: { dirt: ROAD_SPEED.dirt, stone: ROAD_SPEED.stone, militaryRoadBonusApproved: false },
  simulationBodyRadius: 0.3,
  bodyRadiusCaveat:
    "The offline formation model uses.3 circles, wider than current civilian nav.134. Armoured/mounted clearances must use authored bounds and a spatial grid; formation wins are not navigation predictions.",
  contacts,
  assertions:
    "Grid interpolation verifies one-cell delta; road half-step, geometric contact thresholds and critical/full-only expectation formulas pass",
  limits: [
    "No performance, soldier clips, mounted clips, terrain-height collision or live movement test performed.",
    "No extra world-to-cell scale is needed. Feet still require actual travelled-distance playback, bounded turning, acceleration and stop distance.",
    "Calibrated circular silhouette is only an analysis proxy; live geometry, lead, swept ballistic collisions and terrain decide damage."
  ]
};
writeFileSync(
  "../resources/militarybalance/scale-verification.json",
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report.worker));
