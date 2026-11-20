import { type BufferGeometry,Matrix4 } from "three";

import { CATAPULT_ENGINE_ORIGIN, CATAPULT_SCOOP, CATAPULT_STONE_DIAMETER } from "../../src/render-common/buildings/catapult-mechanism";
import { createCatapultRockGeometry } from "../../src/renderers/three/buildings/catapult-rock-geometry";
import { createCatapultScoopGeometry } from "../../src/renderers/three/buildings/catapult-scoop-geometry";
import { CATAPULT_ANCHORS, catapultStockAnchor } from "../../src/shared/settlement/catapult-cycle";

const step = .001;
const radii = (geometry: BufferGeometry) => {
  const vertices = geometry.getAttribute("position"), bands = new Map<number, { min: number; max: number }>();
  for (let index = 0; index < vertices.count; index += 3) {
    const tri = [0, 1, 2].map(offset => [vertices.getX(index + offset), vertices.getY(index + offset), vertices.getZ(index + offset)]);
    const low = Math.ceil(Math.min(...tri.map(point => point[1]!)) / step), high = Math.floor(Math.max(...tri.map(point => point[1]!)) / step);
    for (let bin = low; bin <= high; bin++) {
      const y = bin * step, points: number[][] = [];
      for (let side = 0; side < 3; side++) {
        const from = tri[side]!, to = tri[(side + 1) % 3]!;
        if (Math.abs(to[1]! - from[1]!) < 1e-12 || y < Math.min(from[1]!, to[1]!) || y > Math.max(from[1]!, to[1]!)) continue;
        const t = (y - from[1]!) / (to[1]! - from[1]!);
        points.push([from[0]! + (to[0]! - from[0]!) * t - CATAPULT_ENGINE_ORIGIN[0], from[2]! + (to[2]! - from[2]!) * t - CATAPULT_ENGINE_ORIGIN[2]]);
      }
      if (points.length < 2) continue;
      const [a, b] = points, dx = b![0]! - a![0]!, dz = b![1]! - a![1]!;
      const t = Math.max(0, Math.min(1, -(a![0]! * dx + a![1]! * dz) / (dx * dx + dz * dz || 1)));
      const minimum = Math.hypot(a![0]! + dx * t, a![1]! + dz * t), maximum = Math.max(...points.map(point => Math.hypot(...point)));
      const old = bands.get(bin); bands.set(bin, { min: Math.min(old?.min ?? Infinity, minimum), max: Math.max(old?.max ?? 0, maximum) });
    }
  }
  return bands;
};
for (const detailed of [false, true]) {
  const cup = createCatapultScoopGeometry(detailed).scale(...CATAPULT_SCOOP.size).rotateX(CATAPULT_SCOOP.pitch).translate(...CATAPULT_SCOOP.position);
  const loaded = createCatapultRockGeometry(detailed).scale(CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER).translate(...CATAPULT_ANCHORS.release);
  const stocks = Array.from({ length: 6 }, (_, slot) => {
    const geometry = createCatapultRockGeometry(detailed).scale(CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER).rotateY(slot * 1.83).translate(...catapultStockAnchor(slot));
    geometry.translate(0, 0, -Number(process.env.DELTAZ ?? 0));
    const bands = radii(geometry); geometry.dispose(); return bands;
  });
  let clearance = Infinity, witness: unknown;
  for (let index = 0; index <= 500; index++) {
    const angle = index * 1.25 / 500, pivot = CATAPULT_ANCHORS.pivot;
    const rotation = new Matrix4().makeTranslation(...pivot).multiply(new Matrix4().makeRotationX(angle)).multiply(new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
    for (const [name, source] of [["cup", cup], ["loaded", loaded]] as const) {
      const geometry = source.clone().applyMatrix4(rotation), bands = radii(geometry); geometry.dispose();
      for (let slot = 0; slot < 6; slot++) for (const [bin, occupied] of stocks[slot]!) {
        const moving = bands.get(bin); if (!moving) continue;
        const gap = Math.max(occupied.min - moving.max, moving.min - occupied.max);
        if (gap < clearance) { clearance = gap; witness = { name, angle, slot, y: bin * step, moving, occupied }; }
      }
    }
  }
  console.log(JSON.stringify({ detailed, clearance, witness })); cup.dispose(); loaded.dispose();
}
