import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CATAPULT_HATCH_WELL, catapultStairManeuver } from "../../src/render-common/buildings/catapult-hatch";

const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const input = process.env.HATCH_CURRENT_SOURCE ?? "full-roster-larger-stone-2026-11-03/review.json";
const proof = JSON.parse(await readFile(`${folder}/${input}`, "utf8"));
const profile = JSON.parse(await readFile(`${folder}/proposed-common-profile-well.json`, "utf8"));
interface Band { low: number; high: number; minX: number; maxX: number; minZ: number; maxZ: number }
const up: Band[] = proof.diagonalBands.find((entry: any) => entry.direction === "up").bands;
const down: Band[] = proof.diagonalBands.find((entry: any) => entry.direction === "down").bands;
const levels = [...new Set([...up, ...down].map(band => band.low))].sort((a, b) => a - b);
const bands = levels.map(low => {
  const band = up.find(candidate => Math.abs(candidate.low - low) < 1e-6);
  const reverse = down.find(candidate => Math.abs(candidate.low - low) < 1e-6);
  if (!reverse) return band!;
  if (!band) return { ...reverse, minX: -reverse.maxX, maxX: -reverse.minX,
    minZ: -reverse.maxZ, maxZ: -reverse.minZ };
  return { ...band, minX: Math.min(band.minX, -reverse.maxX), maxX: Math.max(band.maxX, -reverse.minX),
    minZ: Math.min(band.minZ, -reverse.maxZ), maxZ: Math.max(band.maxZ, -reverse.minZ) };
});
const knots: { height: number; x: number; z: number }[] = profile.knots;
// This receipt's knots are checked against the actual helper before using their extrema.
for (let sample = 0; sample <= 3100; sample++) {
  const height = sample / 2000, actual = catapultStairManeuver(height, false);
  let x = 0, z = 0;
  const at = knots.findIndex((knot, index) => index > 0 && knot.height >= height);
  if (at > 0) {
    const a = knots[at - 1]!, b = knots[at]!, t = Math.max(0, Math.min(1, (height - a.height) / (b.height - a.height)));
    const smooth = t * t * (3 - 2 * t); x = a.x + (b.x - a.x) * smooth; z = a.z + (b.z - a.z) * smooth;
  }
  assert(Math.abs(actual.x - x) < 1e-12 && Math.abs(actual.z - z) < 1e-12);
}
const scale = proof.hatch.structureScale, well = CATAPULT_HATCH_WELL, step = proof.bandStep;
const slab = well.depth * scale, throat = well.throat * scale, chamfer = well.chamfer * scale;
let minimum = Infinity, witness: unknown;
for (let low = 0; low <= bands.at(-1)!.high + slab; low += step) {
  const high = low + step;
  const heights = [low, high, ...knots.filter(knot => knot.height > low && knot.height < high).map(knot => knot.height)];
  const offsets = heights.map(height => catapultStairManeuver(height, false));
  const minX = Math.min(...offsets.map(offset => offset.x)), maxX = Math.max(...offsets.map(offset => offset.x));
  const minZ = Math.min(...offsets.map(offset => offset.z)), maxZ = Math.max(...offsets.map(offset => offset.z));
  for (const band of bands) {
    if (band.high <= low - slab + 1e-9 || band.low >= high - 1e-9) continue;
    const depth = Math.max(0, low - band.high);
    const opening = (well.top + (well.lower - well.top) * Math.max(0, Math.min(1, (depth - throat) / chamfer))) * scale / 2;
    const clearance = opening - Math.max(Math.abs(band.minX + minX), Math.abs(band.maxX + maxX),
      Math.abs(band.minZ + minZ), Math.abs(band.maxZ + maxZ));
    if (clearance < minimum) { minimum = clearance; witness = { feetBelowDeck: [low, high], bodyBand: band, depth, opening }; }
  }
}
assert.equal(proof.reports.length, proof.reports.every((entry: any) => !entry.rank) ? 96 : 288);
const report = { input, cases: proof.reports.length, well, minimumClearanceWorld: minimum,
  requiredMarginWorld: .01, pass: minimum >= .01 - 1e-8, witness,
  note: "Conservative full triangle-band/whole-well sweep; exact current smoothstep maneuver, mirrored ascent/descent; published outfits at captured hashes" };
await writeFile(`${folder}/${process.env.HATCH_CURRENT_OUTPUT ?? "larger-stone-current-profile.json"}`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); assert(report.pass, `Current climb has only ${minimum} m clearance`);
