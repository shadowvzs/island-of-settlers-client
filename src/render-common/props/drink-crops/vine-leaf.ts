import type { Random } from "../../../shared/world/rng";
import { cross, type MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import type { Attach } from "../plants/plant-parts";
import { add, scale } from "../tree-parts";

/**
 * A grape leaf outline: five palmate lobes (the middle one longest), a deep sinus where the stalk
 * joins and serrated margins. Points run round the leaf in the unit square (stalk at 0, 0, tip
 * towards +y); `lobe` is 1 at a lobe tip and 0 in a sinus (the renderer lightens the tips and
 * darkens the sinuses, which reads as the five main veins).
 */
export interface VineLeafPoint {
  lobe: number;
  x: number;
  y: number;
}

/** Leaf hub: where the five main veins meet, a little above the stalk. */
export const VINE_LEAF_HUB = { x: 0, y: 0.38 } as const;

export const createVineLeafOutline = (points: number): VineLeafPoint[] =>
  Array.from({ length: points }, (_, index) => {
    const t = index / points, angle = -Math.PI / 2 + t * Math.PI * 2;
    // Lobe tips at 90° (middle), ±45° and ±160° from the top; the sinus faces the stalk.
    const fromTop = Math.abs(((angle - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const lobe = Math.abs(Math.cos(fromTop * 2.5)) ** 1.6 * (fromTop > 2.8 ? 0 : 1);
    const serration = index % 2 ? 0.035 : 0;
    const radius = (0.3 + 0.22 * lobe + serration) * (1 - Math.max(0, fromTop - 2.6) * 0.9);
    return { lobe, x: Math.cos(angle) * radius, y: VINE_LEAF_HUB.y + Math.sin(angle) * radius };
  });


export interface VineLeafOptions {
  /** Leaf face direction (towards the light, away from the row). */
  facing: Vec3;
  /** Base colour of this leaf (green to yellow-green). */
  green: Vec3;
  size: number;
}

/**
 * One geometry grape leaf on its stalk, slightly cupped, as a triangle fan round the hub. The hub
 * follows its cane; the margin flutters in the wind.
 */
export const addVineLeaf = (
  builder: MeshBuilder, attach: Attach, outline: readonly VineLeafPoint[], options: VineLeafOptions, random: Random
) => {
  const facing = normalize(options.facing);
  const side = normalize(cross([0, 1, 0], facing));
  const up = normalize(add(cross(facing, side), scale(side, (random() - 0.5) * 0.8)));
  const at = (x: number, y: number, cup: number): Vec3 =>
    add(add(add(attach.position, scale(side, x * options.size)), scale(up, y * options.size)),
      scale(facing, -cup * options.size));
  const shade = (factor: number): Vec3 => [options.green[0] * factor, options.green[1] * factor, options.green[2] * factor];
  const hubWind = { flutter: 0.2, path: attach.path + options.size * 0.3 };
  const hub = builder.addVertex(at(VINE_LEAF_HUB.x, VINE_LEAF_HUB.y, 0), facing,
    { color: () => shade(0.78), flutter: 0 }, undefined, hubWind);
  const first = builder.vertexCount;
  for (const point of outline) {
    const reach = Math.hypot(point.x - VINE_LEAF_HUB.x, point.y - VINE_LEAF_HUB.y);
    builder.addVertex(at(point.x, point.y, reach * reach * 0.35), facing,
      { color: () => shade(0.86 + point.lobe * 0.3), flutter: 0 }, undefined,
      { flutter: reach * 1.6, path: attach.path + options.size * (0.3 + reach) });
  }
  for (let index = 0; index < outline.length; index += 1)
    builder.addTriangle(hub, first + index, first + ((index + 1) % outline.length));
};
