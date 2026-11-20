import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import { createVineLeafOutline, VINE_LEAF_HUB } from "../../../render-common/props/drink-crops/vine-leaf";
import { createRandom } from "../../../shared/world/rng";

/**
 * A grapevine's leaf mass for building props (the field vines' five-lobed serrated leaf, as
 * geometry): leaves spread over an ellipsoid in the unit box, facing outwards and slightly cupped,
 * in varied tones of the leaf surface with lighter lobe tips. High 20 leaves, Minimal 12.
 */
export const createVineFoliageGeometry = (detailed: boolean) => {
  const random = createRandom(57), leaves = detailed ? 20 : 12, size = detailed ? 0.4 : 0.46;
  const outline = createVineLeafOutline(detailed ? 16 : 8);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const up = new Vector3(), side = new Vector3(), normal = new Vector3(), centre = new Vector3();
  const push = (point: Vector3, tone: number, x: number, y: number) => {
    const curvedNormal = normal.clone().addScaledVector(side, (x - VINE_LEAF_HUB.x) * .6)
      .addScaledVector(up, (y - VINE_LEAF_HUB.y) * .6).normalize();
    positions.push(point.x, point.y, point.z); normals.push(curvedNormal.x, curvedNormal.y, curvedNormal.z);
    colors.push(tone * 1.05, tone, tone * 0.82);
  };
  for (let leaf = 0; leaf < leaves; leaf += 1) {
    const y = 1 - (leaf + 0.5) / leaves * 2, ring = Math.sqrt(1 - y * y), angle = leaf * 2.39996;
    normal.set(Math.cos(angle) * ring, y * 0.7 + 0.3, Math.sin(angle) * ring).normalize();
    centre.copy(normal).multiplyScalar(0.26 + random() * 0.08);
    side.set(-normal.z, 0, normal.x).normalize();
    if (side.lengthSq() < 0.5) side.set(1, 0, 0);
    up.crossVectors(normal, side).normalize().applyAxisAngle(normal, (random() - 0.5) * 1.2);
    side.crossVectors(up, normal).normalize();
    const tone = 0.78 + random() * 0.4;
    const at = (x: number, v: number) => {
      const reach = Math.hypot(x - VINE_LEAF_HUB.x, v - VINE_LEAF_HUB.y);
      return centre.clone().addScaledVector(side, x * size).addScaledVector(up, (v - VINE_LEAF_HUB.y) * size)
        .addScaledVector(normal, -reach * reach * 0.3 * size);
    };
    const hub = at(VINE_LEAF_HUB.x, VINE_LEAF_HUB.y);
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length]!;
      push(hub, tone * 0.82, VINE_LEAF_HUB.x, VINE_LEAF_HUB.y);
      push(at(point.x, point.y), tone * (0.9 + point.lobe * 0.28), point.x, point.y);
      push(at(next.x, next.y), tone * (0.9 + next.lobe * 0.28), next.x, next.y);
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  return geometry;
};
