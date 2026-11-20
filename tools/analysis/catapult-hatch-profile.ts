import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const sourcePath = process.env.HATCH_PROFILE_SOURCE ?? "full-roster-proposed-41-9/review.json";
const source = JSON.parse(await readFile(`${folder}/${sourcePath}`, "utf8"));
const up = source.diagonalBands.find((entry: { direction: string }) => entry.direction === "up").bands;
const down = source.diagonalBands.find((entry: { direction: string }) => entry.direction === "down").bands;
interface Bounds { low: number; high: number; minX: number; maxX: number; minZ: number; maxZ: number }
const width = .36 * source.hatch.structureScale, half = width / 2, margin = .01;
const well = process.env.HATCH_WELL === "1", slab = .16 * source.hatch.structureScale;
const lowerWidth = Number(process.env.HATCH_LOWER_WIDTH ?? .4);
const throatModel = Number(process.env.HATCH_THROAT ?? .02), throat = throatModel * source.hatch.structureScale;
const chamfer = .01 * source.hatch.structureScale, expansion = (lowerWidth - .36) / 2 * source.hatch.structureScale;
const bodyBands: Bounds[] = up.map((band: Bounds) => {
  const reverse = down.find((candidate: Bounds) => Math.abs(candidate.low - band.low) < 1e-6);
  if (!reverse) return band;
  return { ...band, minX: Math.min(band.minX, -reverse.maxX), maxX: Math.max(band.maxX, -reverse.minX),
    minZ: Math.min(band.minZ, -reverse.maxZ), maxZ: Math.max(band.maxZ, -reverse.minZ) };
});
const step = source.bandStep ?? .01;
const bands: Bounds[] = well ? Array.from({ length: Math.ceil((bodyBands.at(-1)!.high + slab) / step) }, (_, index) =>
  ({ low: index * step, high: (index + 1) * step, minX: 0, maxX: 0, minZ: 0, maxZ: 0 })) : bodyBands;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const interval = (band: Bounds, axis: "X" | "Z") => {
  const involved = well ? bodyBands.filter(candidate => candidate.high > band.low - slab + 1e-9 && candidate.low < band.high - 1e-9) : [band];
  const ranges = involved.map(candidate => {
    const depth = Math.max(0, band.low - candidate.high), opening = half + expansion * clamp((depth - throat) / chamfer, 0, 1);
    return { low: -opening + margin - candidate[`min${axis}`], high: opening - margin - candidate[`max${axis}`] };
  });
  return { low: Math.max(...ranges.map(range => range.low)), high: Math.min(...ranges.map(range => range.high)) };
};
const nodes = Array.from({ length: bands.length + 1 }, (_, index) => {
  const adjacent = [bands[index - 1], bands[index]].filter((band): band is Bounds => Boolean(band));
  const axis = (name: "X" | "Z") => {
    const ranges = adjacent.map(band => interval(band, name));
    const low = Math.max(-.065, ...ranges.map(range => range.low)), high = Math.min(.065, ...ranges.map(range => range.high));
    assert(low <= high, `No shared 10 mm-clearance path at node ${index}/${name}`);
    const quarter = (high - low) / 4;
    return { low, high, value: clamp(0, low + quarter, high - quarter) };
  };
  return { height: index * step, x: axis("X"), z: axis("Z") };
});
const ease = (t: number) => t * t * (3 - 2 * t);
const fits = (first: number, last: number) => {
  for (let index = first; index <= last; index++) for (const axis of ["x", "z"] as const) {
    const t = ease((index - first) / (last - first));
    const value = nodes[first]![axis].value * (1 - t) + nodes[last]![axis].value * t;
    if (value < nodes[index]![axis].low - 1e-9 || value > nodes[index]![axis].high + 1e-9) return false;
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
const selected = routes.at(-1)!, knots = selected.map(index => ({ height: nodes[index]!.height,
  x: nodes[index]!.x.value, z: nodes[index]!.z.value }));
const offset = (height: number) => {
  const end = knots.findIndex(point => point.height >= height), at = Math.max(1, end);
  const a = knots[at - 1]!, b = knots[at]!, t = ease(clamp((height - a.height) / (b.height - a.height), 0, 1));
  return { x: a.x * (1 - t) + b.x * t, z: a.z * (1 - t) + b.z * t };
};
const clearance = bands.map(band => {
  const first = offset(band.low), last = offset(band.high);
  const involved = well ? bodyBands.filter(candidate => candidate.high > band.low - slab + 1e-9 && candidate.low < band.high - 1e-9) : [band];
  const values = involved.map(candidate => {
    const depth = Math.max(0, band.low - candidate.high), opening = half + expansion * clamp((depth - throat) / chamfer, 0, 1);
    return opening - Math.max(Math.abs(candidate.minX + Math.min(first.x, last.x)), Math.abs(candidate.maxX + Math.max(first.x, last.x)),
      Math.abs(candidate.minZ + Math.min(first.z, last.z)), Math.abs(candidate.maxZ + Math.max(first.z, last.z)));
  });
  return { low: band.low, high: band.high, clearance: values.length ? Math.min(...values) : half };
});
assert(Math.min(...clearance.map(band => band.clearance)) >= margin - 1e-8);
const report = { source: sourcePath, proposedHatchModelWidth: .36, proposedHatchWorldWidth: width,
  well, lowerWidthModel: well ? lowerWidth : .36, slabThicknessModel: well ? .16 : 0, throatModel, chamferModel: .01,
  headingUp: Math.PI + source.proposedClimbHeading, headingDown: source.proposedClimbHeading,
  interpolation: "smoothstep per interval; up uses these offsets, down their negatives", knots,
  minimumClearance: Math.min(...clearance.map(band => band.clearance)),
  maximumHorizontalOffset: Math.max(...knots.map(knot => Math.hypot(knot.x, knot.z))), clearance };
await writeFile(`${folder}/proposed-common-profile${well ? "-well" : ""}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
