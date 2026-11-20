import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import type { SettlementPoint } from "./settlement-types";

/** Directions of the ring probes (`DMath.cos(angle)`, `DMath.sin(angle)`), each 30 degrees. */
const RING = Array.from({ length: 12 }, (_, direction) =>
  [DMath.cos(direction * Math.PI / 6), DMath.sin(direction * Math.PI / 6)] as const);

/**
 * The probes of a footprint of `radius` round `point`, each with the world cell whose ground it stands for:
 * the nearest point of every tile the circle reaches (with that tile), then 12 points on the circle (with the
 * tile under each). False when the footprint or a probe leaves the map, or `visit` refuses a probe.
 */
export const everyFootprintProbe = (world: Pick<WorldData, "cellsX" | "cellsZ">, point: SettlementPoint,
  radius: number, visit: (probe: SettlementPoint, cell: number) => boolean) => {
  if (point.x - radius < 0 || point.z - radius < 0 ||
    point.x + radius >= world.cellsX || point.z + radius >= world.cellsZ) return false;
  for (let z = Math.floor(point.z - radius); z <= Math.floor(point.z + radius); z++)
    for (let x = Math.floor(point.x - radius); x <= Math.floor(point.x + radius); x++) {
      const nearest = { x: Math.max(x, Math.min(x + 1, point.x)), z: Math.max(z, Math.min(z + 1, point.z)) };
      if ((point.x - nearest.x) * (point.x - nearest.x) +
        (point.z - nearest.z) * (point.z - nearest.z) >= radius * radius) continue;
      if (!visit(nearest, z * world.cellsX + x)) return false;
    }
  for (const [cosine, sine] of RING) {
    const sample = { x: point.x + cosine * radius, z: point.z + sine * radius };
    if (sample.x < 0 || sample.z < 0 || sample.x >= world.cellsX || sample.z >= world.cellsZ) return false;
    if (!visit(sample, Math.floor(sample.z) * world.cellsX + Math.floor(sample.x))) return false;
  }
  return true;
};
