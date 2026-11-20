import { createRandom, type Random } from "../../../shared/world/rng";
import { PALM } from "../../../shared/world/tree-forms";
import { createIslandTreeMesh } from "../../trees/island-tree-mesh";
import { createTreeModel } from "../../trees/tree-factory";
import type { GrowthStage } from "../../trees/tree-model";
import { ISLAND_TREE_UNITS } from "../island-trees";
import { MeshBuilder, normalize, type PropMesh, type Vec3 } from "../mesh-builder";
import { add, scale } from "../tree-parts";
import { addLathe, addStaticBox, huskFibres, ovoidProfile, solid } from "./crop-mesh-parts";

/**
 * Planted coconut palms of the Nubian palm grove. The trees are the island's own coconut palm
 * (same model, atlas and wind); their coconuts are a separate cluster mesh so the grove can show
 * them growing (small green), ripening (brown), dropping when the grower shakes the trunk and
 * lying on the ground until gathered, while the palm stays standing.
 */
/** Coconuts read better a little larger than botanical scale at the RTS distance. */
const COCONUT_READABILITY = 1.35;
const HUSK: Vec3 = [0.92, 0.9, 0.82];

const createModel = (stage: GrowthStage, seed: number) =>
  createTreeModel("palm", stage, seed + (stage - 3) * 101, 5, PALM.coconut);

/** The palm at a growth stage, without fruit (the cluster mesh carries the coconuts). */
export const createCoconutPalmStageMesh = (stage: GrowthStage, seed: number): PropMesh => {
  const model = createModel(stage, seed);
  model.fruit = [];
  return createIslandTreeMesh(model, ISLAND_TREE_UNITS, createRandom(seed + 7));
};

/** Wind bend of the palm vertex nearest a point: the coconuts sway exactly with the crown. */
const nearestBend = (palm: PropMesh, point: Vec3) => {
  let best = Infinity, bend = 0;
  for (let vertex = 0; vertex < palm.positions.length / 3; vertex += 1) {
    const dx = palm.positions[vertex * 3]! - point[0], dy = palm.positions[vertex * 3 + 1]! - point[1];
    const dz = palm.positions[vertex * 3 + 2]! - point[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance >= best || palm.wind[vertex * 2 + 1]! > 0) continue;
    best = distance; bend = palm.wind[vertex * 2]!;
  }
  return bend;
};

/** Height of the mature crown base, where the coconuts hang. */
export const getCoconutCrownHeight = (seed: number) => {
  const model = createModel(5, seed);
  return Math.min(...model.fruit.map(fruit => fruit.position[1])) * ISLAND_TREE_UNITS;
};

/**
 * One husked coconut: a three-faced oval husk with fibre streaks, pointed at its far end, turning
 * about `axis` (hanging nuts point down, fallen ones lie on their side).
 */
const addCoconutNut = (builder: MeshBuilder, centre: Vec3, radius: number, axis: Vec3, detailed: boolean,
  random: Random) =>
  addLathe(builder, { axis, centre, profile: ovoidProfile(radius, radius * 2.3, detailed ? 6 : 3, 0.32),
    ridges: { count: 3, depth: 0.07 }, segments: detailed ? 9 : 5 }, huskFibres(centre, HUSK, random));

/**
 * Coconut cluster of the mature palm. `size` 1 is a full nut; smaller for young green nuts.
 * Baked light: the renderer tints the husks green while growing and brown when ripe.
 */
export const createCoconutClusterMesh = (palm: PropMesh, size: number, detailed: boolean, seed: number) => {
  const model = createModel(5, seed);
  const builder = new MeshBuilder(), random = createRandom(seed + 19);
  for (const fruit of model.fruit) {
    const centre = scale(fruit.position, ISLAND_TREE_UNITS);
    const radius = fruit.radius * ISLAND_TREE_UNITS * COCONUT_READABILITY * size;
    const hang = normalize([random() - 0.5, -2, random() - 0.5]);
    addCoconutNut(builder, add(centre, [0, radius * 0.4, 0]), radius, hang, detailed, random);
    if (detailed) addStaticBox(builder, add(centre, [0, radius * 0.7, 0]), [0.006, radius * 0.9, 0.006],
      solid([0.45, 0.4, 0.22]));
  }
  return withCrownBend(builder.finish({ flex: 0 }), palm, model.fruit[0]?.position);
};

/** Every vertex sways like the crown above it (the palm vertex nearest the first nut). */
const withCrownBend = (mesh: PropMesh, palm: PropMesh, point: Vec3 | undefined) => {
  const bend = nearestBend(palm, scale(point ?? [0, 0, 0], ISLAND_TREE_UNITS));
  for (let vertex = 0; vertex < mesh.wind.length / 2; vertex += 1) {
    mesh.wind[vertex * 2] = bend;
    mesh.wind[vertex * 2 + 1] = 0;
  }
  return mesh;
};

/** Groups of fallen nuts (picked up in turn): every third nut of the cluster per group. */
export const COCONUT_FALLEN_GROUPS = 3;

/**
 * Ripe nuts lying on the ground where they fell from the crown, rolled a little outwards and
 * lying on their sides; `group` selects every third nut, so the gatherer empties the spot in turns.
 */
export const createFallenCoconutMesh = (group: number, detailed: boolean, seed: number) => {
  const model = createModel(5, seed);
  const builder = new MeshBuilder(), random = createRandom(seed + 29 + group);
  model.fruit.forEach((fruit, index) => {
    if (index % COCONUT_FALLEN_GROUPS !== group) return;
    const centre = scale(fruit.position, ISLAND_TREE_UNITS), radius = fruit.radius * ISLAND_TREE_UNITS * COCONUT_READABILITY;
    const out = normalize([centre[0] + random() - 0.5, 0, centre[2] + random() - 0.5]);
    const roll = 0.06 + random() * 0.12, yaw = random() * Math.PI * 2;
    addCoconutNut(builder, [centre[0] + out[0] * roll, radius * 0.9, centre[2] + out[2] * roll], radius,
      [Math.cos(yaw), 0.15, Math.sin(yaw)], detailed, random);
  });
  return builder.finish({ flex: 0 });
};

export const COCONUT_TINTS = {
  ripe: [0.52, 0.34, 0.18] as Vec3,
  unripe: [0.42, 0.56, 0.2] as Vec3
};
