import { BufferGeometry, Float32BufferAttribute } from "three";

import { CATAPULT_HATCH_WELL } from "../../../render-common/buildings/catapult-hatch";

/** Fixed square outer fascia with the actual three-section clear hatch well cut through it. */
export const createCatapultDeckGeometry = () => {
  const positions: number[] = [], uvs: number[] = [], floor = CATAPULT_HATCH_WELL;
  const top = .08, bottom = -.08, x = floor.center[0], z = floor.center[2];
  const loop = (half: number, y: number, cx: number = x, cz: number = z) =>
    [[cx - half, y, cz - half], [cx + half, y, cz - half], [cx + half, y, cz + half], [cx - half, y, cz + half]];
  const outerTop = loop(.825, top, 0, 0), outerBottom = loop(.825, bottom, 0, 0);
  const inner = [loop(floor.top / 2, top), loop(floor.top / 2, top - floor.throat),
    loop(floor.lower / 2, top - floor.throat - floor.chamfer), loop(floor.lower / 2, bottom)];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    for (const point of [a, b, c, a, c, d]) { positions.push(...point); uvs.push(point[0]!, point[2]!); }
  };
  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    quad(outerTop[side]!, inner[0]![side]!, inner[0]![next]!, outerTop[next]!);
    quad(outerBottom[next]!, inner[3]![next]!, inner[3]![side]!, outerBottom[side]!);
    quad(outerTop[next]!, outerBottom[next]!, outerBottom[side]!, outerTop[side]!);
    for (let section = 0; section < 3; section++)
      quad(inner[section]![side]!, inner[section + 1]![side]!, inner[section + 1]![next]!, inner[section]![next]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals();
  geometry.scale(1 / 1.65, 1 / .16, 1 / 1.65);
  return geometry;
};
