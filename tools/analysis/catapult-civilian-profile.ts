import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CATAPULT_DECK_HEIGHT, CATAPULT_SHAFT_HEIGHT } from "../../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "../../src/render-common/buildings/catapult-hatch";

interface Band { low: number; high: number; minX: number; maxX: number; minZ: number; maxZ: number }
interface Range { low: number; high: number; value: number }
const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const input = "civilian-huge-stone-runtime-16pass-2026-11-03/review.json";
const source = JSON.parse(await readFile(`${folder}/${input}`, "utf8"));
const scale: number = source.hatch.structureScale, step: number = source.bandStep;
const well = CATAPULT_HATCH_WELL, margin = .01;
const floorDepth = well.depth * scale;
const shaftTop = (CATAPULT_DECK_HEIGHT - CATAPULT_SHAFT_HEIGHT) * scale;
const recessBottom = shaftTop + Number(process.env.HATCH_RECESS_DEPTH ?? .60) * scale;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const ease = (t: number) => t * t * (3 - 2 * t);
const profiles = [];
for (const direction of ["up", "down"]) {
  const bands: Band[] = source.diagonalBands.find((entry: { direction: string }) => entry.direction === direction).bands
    .map((band: Band) => ({ ...band, minX: -band.maxX, maxX: -band.minX, minZ: -band.maxZ, maxZ: -band.minZ }));
  const end = Math.ceil(CATAPULT_DECK_HEIGHT * scale / step);
  const interval = (heightLow: number, heightHigh: number, axis: "X" | "Z") => {
    let low = -.4, high = .5;
    const apply = (band: Band, min: number, max: number) => {
      low = Math.max(low, min + margin - band[`min${axis}`]);
      high = Math.min(high, max - margin - band[`max${axis}`]);
    };
    for (const band of bands) {
      if (band.high > heightLow - floorDepth && band.low < heightHigh)
        apply(band, -well.top * scale / 2, well.top * scale / 2);
      if (band.low < heightHigh - recessBottom)
        apply(band, (-.52 - well.center[0]) * scale, (.52 - well.center[0]) * scale);
      if (band.high > heightLow - recessBottom && band.low < heightHigh - shaftTop)
        apply(band, (-.595 - well.center[0]) * scale, (.52 - well.center[0]) * scale);
    }
    assert(low <= high, `${direction} no common interval at ${heightLow}/${axis}: ${low} > ${high}`);
    const quarter = (high - low) / 4;
    return { low, high, value: clamp(0, low + quarter, high - quarter) };
  };
  const nodes: { height: number; x: Range; z: Range }[] = Array.from({ length: end + 1 }, (_, i) => ({
    height: i * step, x: interval(Math.max(0, i - 1) * step, (i + 1) * step, "X"),
    z: interval(Math.max(0, i - 1) * step, (i + 1) * step, "Z")
  }));
  const fits = (first: number, last: number) => {
    for (let i = first; i <= last; i++) {
      const values = { x: 0, z: 0 };
      for (const axis of ["x", "z"] as const) {
      const t = ease((i - first) / (last - first));
      const v = nodes[first]![axis].value * (1 - t) + nodes[last]![axis].value * t;
      if (v < nodes[i]![axis].low - 1e-9 || v > nodes[i]![axis].high + 1e-9) return false;
      values[axis] = v;
      }

    }
    return true;
  };
  const routes: number[][] = [[0]];
  for (let last = 1; last < nodes.length; last++) {
    let best = [...routes[last - 1]!, last];
    for (let first = 0; first < last; first++)
      if (routes[first]!.length + 1 < best.length && fits(first, last)) best = [...routes[first]!, last];
    routes.push(best);
  }
  const selected = routes.at(-1)!;
  for (let i = 1; i < selected.length; i++) assert(fits(selected[i - 1]!, selected[i]!));
  const knots = selected.map(i => [nodes[i]!.height, nodes[i]!.x.value, nodes[i]!.z.value]);
  const offset = (h: number) => {
    const at = knots.findIndex((k, i) => i > 0 && k[0]! >= h);
    const a = knots[Math.max(0, at - 1)]!, b = knots[at < 0 ? knots.length - 1 : at]!;
    const t = ease(clamp((h - a[0]!) / Math.max(1e-8, b[0]! - a[0]!), 0, 1));
    return { x: a[1]! + (b[1]! - a[1]!) * t, z: a[2]! + (b[2]! - a[2]!) * t };
  };
  let minimum = Infinity;
  let witness: unknown;
  for (let h = 0; h < end * step; h += step) {
    const offsets = [offset(h), offset(h + step), ...knots.filter(k => k[0]! > h && k[0]! < h + step)
      .map(k => ({ x: k[1]!, z: k[2]! }))];
    const check = (band: Band, low: number, high: number, zone: string) => {
      const clearance = Math.min(band.minX + Math.min(...offsets.map(o => o.x)) - low,
        band.minZ + Math.min(...offsets.map(o => o.z)) - low,
        high - band.maxX - Math.max(...offsets.map(o => o.x)),
        high - band.maxZ - Math.max(...offsets.map(o => o.z)));
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
  assert(minimum >= margin - 1e-8, `${direction} clearance ${minimum}`);
  profiles.push({ direction, minimumClearance: minimum, witness, heading: source.proposedClimbHeading + (direction === "down" ? Math.PI : 0), knots,
    minimumRequestedClearance: margin,
    note: "Full floor well + conservative rectangular shaft/recess bounds; actual full rectangular upper relief, lid/stock validation still required" });
}
const report = { input, cases: source.reports.length, well, scale, profiles };
await writeFile(`${folder}/civilian-current-profile-candidate.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
