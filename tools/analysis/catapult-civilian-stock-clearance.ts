import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CATAPULT_DECK_HEIGHT } from "../../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "../../src/render-common/buildings/catapult-hatch";
import { CATAPULT_STONE_DIAMETER } from "../../src/render-common/buildings/catapult-mechanism";
import { createCatapultRockGeometry } from "../../src/renderers/three/buildings/catapult-rock-geometry";
import { catapultStockAnchor } from "../../src/shared/settlement/catapult-cycle";
import { hatchBandPolygons } from "./catapult-band-polygons";

const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const sourcePath = process.env.HATCH_STOCK_SOURCE ?? "civilian-huge-stone-runtime-polygons-2026-11-03/review.json";
const source = JSON.parse(await readFile(`${folder}/${sourcePath}`, "utf8"));
const profile = JSON.parse(await readFile(`${folder}/${process.env.HATCH_STOCK_PROFILE ?? "civilian-current-profile-candidate.json"}`, "utf8"));
const scale: number = source.hatch.structureScale, step: number = source.bandStep;
type Point = [number, number];
const polygons: Point[][] = source.diagonalPolygons.up.map((polygon: Point[]) => polygon.map(([x, z]) => [-x, -z]));
const knots: number[][] = profile.profiles.find((entry: { direction: string }) => entry.direction === "up").knots;
const offset = (h: number) => {
  const at = knots.findIndex((k, i) => i > 0 && k[0]! >= h);
  if (at < 0) return knots.at(-1)!.slice(1);
  const a = knots[at - 1]!, b = knots[at]!, t = (h - a[0]!) / (b[0]! - a[0]!);
  const smooth = t * t * (3 - 2 * t);
  return [a[1]! + (b[1]! - a[1]!) * smooth, a[2]! + (b[2]! - a[2]!) * smooth];
};
const distanceToPolygon = (polygon: Point[], x: number, z: number) => {
  let squared = Infinity, inside = true;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    area += a[0] * b[1] - a[1] * b[0];
    const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1,
      ((x - a[0]) * dx + (z - a[1]) * dz) / Math.max(1e-20, dx * dx + dz * dz)));
    squared = Math.min(squared, (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2);
    if (dx * (z - a[1]) - dz * (x - a[0]) < -1e-10) inside = false;
  }
  return inside && Math.abs(area) > 1e-12 ? 0 : squared;
};
let radius = 0;
for (const detail of [false, true]) {
  const geometry = createCatapultRockGeometry(detail), positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) radius = Math.max(radius,
    Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)) * CATAPULT_STONE_DIAMETER * scale);
  geometry.dispose();
}
const stockBands = Array.from({ length: 5 }, (_, slot) => {
  const anchor = [...catapultStockAnchor(slot)] as [number, number, number];
    if (slot % 2) {
      anchor[2]! += Number(process.env.STOCK_NEAR_SHIFT ?? 0);
      anchor[0]! += Number(process.env.STOCK_NEAR_SHIFT_X ?? 0);
    }
    const yaw = slot * 1.83, c = Math.cos(yaw), sine = Math.sin(yaw);
  const all: { low: number; high: number; polygon: Point[] }[] = [];
  for (const detail of [false, true]) {
    const geometry = createCatapultRockGeometry(detail), p = geometry.getAttribute("position");
    const vertices = new Float64Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      vertices[i * 3] = (p.getX(i) * c + p.getZ(i) * sine) * CATAPULT_STONE_DIAMETER * scale;
      vertices[i * 3 + 1] = p.getY(i) * CATAPULT_STONE_DIAMETER * scale + .3;
      vertices[i * 3 + 2] = (p.getZ(i) * c - p.getX(i) * sine) * CATAPULT_STONE_DIAMETER * scale;
    }
    const indices = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: p.count }, (_, i) => i);
    hatchBandPolygons([{ vertices, indices, label: "stock" }], 0, step).forEach((polygon, i) => {
      if (polygon.length > 2) all.push({ low: i * step - .3 + (anchor[1] - CATAPULT_DECK_HEIGHT) * scale,
        high: (i + 1) * step - .3 + (anchor[1] - CATAPULT_DECK_HEIGHT) * scale,
        polygon: polygon.map(([x, z]) => [x + (anchor[0] - CATAPULT_HATCH_WELL.center[0]) * scale,
          z + (anchor[2] - CATAPULT_HATCH_WELL.center[2]) * scale]) });
    });
    geometry.dispose();
  }
  return all;
});
const polygonDistance = (a: Point[], b: Point[], ox: number, oz: number) => {
  let separated = false;
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const first = polygon[i]!, next = polygon[(i + 1) % polygon.length]!;
    const nx = next[1] - first[1], nz = first[0] - next[0];
    if (Math.hypot(nx, nz) < 1e-10) continue;
    const aa = a.map(p => (p[0] + ox) * nx + (p[1] + oz) * nz);
    const bb = b.map(p => p[0] * nx + p[1] * nz);
    if (Math.max(...aa) < Math.min(...bb) || Math.max(...bb) < Math.min(...aa)) separated = true;
  }
  if (!separated) return 0;
  let squared = Infinity;
  for (const [x, z] of a) squared = Math.min(squared, distanceToPolygon(b, x + ox, z + oz));
  for (const [x, z] of b) squared = Math.min(squared, distanceToPolygon(a, x - ox, z - oz));
  return squared;
};
let minimum = .02, witness: unknown;
for (let h = 0; h <= 1.6; h += .005) {
  const [ox, oz] = offset(h);
  for (let slot = 0; slot < 5; slot++) for (const stock of stockBands[slot]!) {
    const first = Math.max(0, Math.floor((stock.low + h - minimum) / step));
    const last = Math.min(polygons.length - 1, Math.ceil((stock.high + h + minimum) / step));
    for (let i = first; i <= last; i++) {
      if (polygons[i]!.length < 3) continue;
      const dy = Math.max(i * step - h - stock.high, 0, stock.low - ((i + 1) * step - h));
      if (dy >= minimum) continue;
      const bx = Math.max(Math.min(...polygons[i]!.map(p => p[0])) + ox! - Math.max(...stock.polygon.map(p => p[0])),
        Math.min(...stock.polygon.map(p => p[0])) - Math.max(...polygons[i]!.map(p => p[0])) - ox!, 0);
      const bz = Math.max(Math.min(...polygons[i]!.map(p => p[1])) + oz! - Math.max(...stock.polygon.map(p => p[1])),
        Math.min(...stock.polygon.map(p => p[1])) - Math.max(...polygons[i]!.map(p => p[1])) - oz!, 0);
      if (Math.hypot(bx, bz, dy) >= minimum) continue;
      const gap = Math.sqrt(polygonDistance(polygons[i]!, stock.polygon, ox!, oz!) + dy * dy);
      if (gap < minimum) { minimum = gap; witness = { h, slot, bodyHeightBand: [i * step, (i + 1) * step],
        stockHeightBand: [stock.low, stock.high], bodyPolygon: polygons[i], stockPolygon: stock.polygon }; }
    }
  }
}
const maximumHorizontalSpeed = Math.max(...knots.slice(1).map((k, i) =>
  1.5 * Math.hypot(k[1]! - knots[i]![1]!, k[2]! - knots[i]![2]!) / (k[0]! - knots[i]![0]!)));
const samplingAllowance = .005 / 2 * Math.hypot(1, maximumHorizontalSpeed);
const report = { minimumSampledClearance: minimum, minimumContinuousClearance: minimum - samplingAllowance,
  sourcePath, stoneDiameterModel: CATAPULT_STONE_DIAMETER,
  nearStackShiftModel: [Number(process.env.STOCK_NEAR_SHIFT_X ?? 0), Number(process.env.STOCK_NEAR_SHIFT ?? 0)],
  samplingAllowance, witness, stockBoundingSphereRadius: radius,
  source: "all96 runtime posed body+held rock convex section prisms; actual High+Minimal stock convex section prisms",
  pass: minimum - samplingAllowance >= .01 };
await writeFile(`${folder}/${process.env.HATCH_STOCK_OUTPUT ?? "civilian-stock-clearance.json"}`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); assert(report.pass);
