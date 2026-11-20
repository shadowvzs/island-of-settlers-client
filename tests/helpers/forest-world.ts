import { createRandom } from "../../src/shared/world/rng";
import { PROP, type PropSet, type WorldData } from "../../src/shared/world/world-data";
import { huntingWorld } from "./hunting-world";

/**
 * A flat grass island of `size`² cells covered by mature broadleaf trees about `spacing` cells
 * apart (lightly jittered, seeded), leaving `margin` cells free at the coast: dense-forest
 * wildlife tests and measurements. A fresh prop set, so cached worlds stay unchanged.
 */
export const forestWorld = (size: number, spacing: number, margin = 2, seed = 7): WorldData => {
  const world = huntingWorld(size);
  const random = createRandom(seed);
  const perRow = Math.floor((size - margin * 2) / spacing);
  const count = perRow * perRow;
  const props: PropSet = {
    count,
    form: new Uint8Array(count),
    phase: new Float32Array(count),
    rotation: new Float32Array(count),
    scale: new Float32Array(count).fill(1),
    types: new Uint8Array(count).fill(PROP.broadleafTree),
    x: new Float32Array(count),
    y: new Float32Array(count).fill(2),
    z: new Float32Array(count)
  };
  for (let index = 0; index < count; index += 1) {
    const column = index % perRow, row = Math.floor(index / perRow);
    props.x[index] = margin + (column + 0.5 + (random() - 0.5) * 0.3) * spacing;
    props.z[index] = margin + (row + 0.5 + (random() - 0.5) * 0.3) * spacing;
    props.phase[index] = random() * Math.PI * 2;
    props.rotation[index] = random() * Math.PI * 2;
  }
  return { ...world, props };
};
