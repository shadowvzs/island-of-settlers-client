import type { Point3 } from "./buildings/building-recipe";
import type { RoadPlantDefinition } from "./road-plant-catalog";
import { plantBranch, plantFlower, plantLeaf, plantNoise,type RoadPlantBuilder } from "./road-plant-parts";
import { createCherryModel } from "./trees/cherry-model";

/** Reuse the canonical crooked woody growth graph, including actual connected branch junctions. */
export const grownRoadTreeParts = (builder: RoadPlantBuilder, definition: RoadPlantDefinition,
  variant: number, base = 0) => {
  const model = createCherryModel(1731 + variant * 997 + builder.seed, 2);
  const trunk = model.wood[0]!, fork = trunk.points[trunk.points.length - 1]![1];
  const bonsai = definition.form === "bonsai";
  let crownBase = definition.crownBase;
  if (bonsai) crownBase = definition.height * .28;
  const horizontalScale = definition.crownRadius / model.bounds.radius;
  const map = (point: readonly [number, number, number]): Point3 => {
    let y = .025 + Math.max(0, point[1] + .05) / (fork + .05) * crownBase;
    if (point[1] > fork) y = crownBase + (point[1] - fork) /
      (model.bounds.height - fork) * (definition.height - crownBase);
    return [point[0] * horizontalScale, base + y, point[2] * horizontalScale];
  };
  for (const limb of model.wood) {
    if (limb.depth > (builder.detailed ? 2 : 1)) continue;
    for (let index = 1; index < limb.points.length; index++) {
      const radius = limb.radii[index - 1]! * horizontalScale;
      plantBranch(builder, map(limb.points[index - 1]!), map(limb.points[index]!), Math.max(.004, radius * 2));
    }
  }
  const target = builder.detailed ? 80 : 40;
  const step = Math.max(1, Math.ceil(model.foliage.length / target));
  for (let index = 0; index < model.foliage.length; index += step) {
    const spray = model.foliage[index]!, center = map(spray.position);
    const flowering = definition.id.includes("cherry") || definition.id.includes("peach");
    let leaves = builder.detailed ? 6 : 3;
    if (flowering) leaves = builder.detailed ? 2 : 1;
    const clusterRadius = definition.crownRadius * .13;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const angle = index * 1.7 + leaf * 2.399963;
      const tip: Point3 = [center[0] + Math.sin(angle) * clusterRadius,
        center[1] + (plantNoise(index * 7 + leaf) - .5) * clusterRadius,
        center[2] + Math.cos(angle) * clusterRadius];
      plantLeaf(builder, tip, angle, definition.leafLength * 1.4, definition.leafWidth * 1.4,
        definition.foliage, index * 7 + leaf);
    }
    if (definition.blossom && (flowering || index % (step * 3) === 0)) {
      const flowers = flowering && builder.detailed ? 2 : 1;
      for (let flower = 0; flower < flowers; flower++)
        plantFlower(builder, [center[0] + flower * .06, center[1] + flower * .055, center[2]],
          definition.blossom, bonsai ? .025 : .075, index + flower);
    }
    if (definition.form === "weeping") {
      const end: Point3 = [center[0], Math.max(base + crownBase + .10,
        center[1] - (definition.height - crownBase) * .5), center[2]];
      plantBranch(builder, center, end, .004);
      for (let leaf = 0; leaf < (builder.detailed ? 5 : 3); leaf++) {
        const t = leaf / (builder.detailed ? 5 : 3);
        plantLeaf(builder, [center[0], center[1] + (end[1] - center[1]) * t, center[2]],
          index + leaf, definition.leafLength, definition.leafWidth, definition.foliage, index + leaf);
      }
    }
  }
};
