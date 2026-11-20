import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CATAPULT_DECK_HEIGHT, CATAPULT_SHAFT_HEIGHT } from "../../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL, CATAPULT_STAIR_MANEUVER_KNOTS,
  catapultStairManeuver } from "../../src/render-common/buildings/catapult-hatch";
import { CATAPULT_STONE_DIAMETER } from "../../src/render-common/buildings/catapult-mechanism";

interface Band { low: number; high: number; minX: number; maxX: number; minZ: number; maxZ: number }
const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const input = process.env.HATCH_CURRENT_SOURCE, output = process.env.HATCH_CURRENT_OUTPUT;
assert(input && output, "Choose explicit fresh source and output receipt names");
const source = JSON.parse(await readFile(`${folder}/${input}`, "utf8"));
assert.equal(source.reports.length, 96, "Current Carrier proof needs all48 bodies and both details");
const scale: number = source.hatch.structureScale, step: number = source.bandStep;
const well = CATAPULT_HATCH_WELL, margin = .01;
assert(Math.abs(source.proposedClimbHeading - well.upHeading) < 1e-12);
assert(Math.abs(source.proposedClimbHeading + Math.PI - well.downHeading) < 1e-12);
const floorDepth = well.depth * scale;
const shaftTop = (CATAPULT_DECK_HEIGHT - CATAPULT_SHAFT_HEIGHT) * scale;
// Physical rectangular relief is verified independently against actual recipe boxes by
// catapult-civilian-final.ts; this conservative envelope does not infer acceptance from a radius.
const recessBottom = shaftTop + .70 * scale;
const profiles = [];
for (const direction of ["up", "down"] as const) {
  const down = direction === "down", knots = CATAPULT_STAIR_MANEUVER_KNOTS[direction];
  const bands: Band[] = source.diagonalBands.find((entry: { direction: string }) => entry.direction === direction).bands
    .map((band: Band) => ({ ...band, minX: -band.maxX, maxX: -band.minX, minZ: -band.maxZ, maxZ: -band.minZ }));
  let minimum = Infinity, witness: unknown;
  for (let h = 0; h <= CATAPULT_DECK_HEIGHT * scale; h += step) {
    const offsets = [catapultStairManeuver(h, down), catapultStairManeuver(h + step, down),
      ...knots.filter(knot => knot[0] > h && knot[0] < h + step).map(knot => ({ x: knot[1], z: knot[2] }))];
    const check = (band: Band, low: number, high: number, zone: string) => {
      const clearance = Math.min(band.minX + Math.min(...offsets.map(point => point.x)) - low,
        band.minZ + Math.min(...offsets.map(point => point.z)) - low,
        high - band.maxX - Math.max(...offsets.map(point => point.x)),
        high - band.maxZ - Math.max(...offsets.map(point => point.z)));
      if (clearance < minimum) { minimum = clearance; witness = { h, zone, band }; }
    };
    for (const band of bands) {
      if (band.high > h - floorDepth && band.low < h + step)
        check(band, -well.top * scale / 2, well.top * scale / 2, "well");
      if (band.low < h + step - recessBottom)
        check(band, (-.52 - well.center[0]) * scale, (.52 - well.center[0]) * scale, "shaft");
      if (band.high > h - recessBottom && band.low < h + step - shaftTop)
        check(band, (-.595 - well.center[0]) * scale, (.52 - well.center[0]) * scale, "relief");
    }
  }
  profiles.push({ direction, heading: catapultStairManeuver(0, down).heading,
    minimumClearance: minimum, minimumRequestedClearance: margin, witness, knots });
}
const torsoChecks = source.reports.flatMap((record: { phases: { torsoRockOverlap?: { overlaps: boolean } }[] }) =>
  record.phases.flatMap(phase => phase.torsoRockOverlap ? [phase.torsoRockOverlap] : []));
assert.equal(torsoChecks.length, 384);
const report = { input, cases: source.reports.length, well, scale, profiles, stoneDiameterModel: CATAPULT_STONE_DIAMETER,
  torsoChecks: torsoChecks.length, torsoOverlaps: torsoChecks.filter((check: { overlaps: boolean }) => check.overlaps).length,
  pass: profiles.every(profile => profile.minimumClearance >= margin) && torsoChecks.every((check: { overlaps: boolean }) => !check.overlaps),
  scope: "Unchanged production maneuver, conservative5mm triangle bands through full well and entire shaft; no pose optimization" };
await writeFile(`${folder}/${output}`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); assert(report.pass);
