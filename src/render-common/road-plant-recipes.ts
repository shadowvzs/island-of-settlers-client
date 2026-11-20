import type { Point3 } from "./buildings/building-recipe";
import type { RoadDecorationPart } from "./road-decoration-recipe";
import type { RoadPlantColour, RoadPlantDefinition } from "./road-plant-catalog";
import { grownRoadTreeParts } from "./road-plant-grown";
import { plantBranch, plantCeramicPot, plantFlower,
  plantLeaf, plantNoise,type RoadPlantBuilder } from "./road-plant-parts";

export interface RoadPlantRecipe {
  id: string;
  variant: number;
  potted: boolean;
  form: "roadside" | "standalone";
  flowerColour?: RoadPlantColour;
  parts: RoadDecorationPart[];
  wind: 0;
}

const treeRoots = (builder: RoadPlantBuilder, radius: number) => {
  const roots = builder.detailed ? 7 : 5;
  for (let root = 0; root < roots; root++) {
    const angle = root * Math.PI * 2 / roots + builder.seed;
    const end: Point3 = [Math.sin(angle) * radius, .03, Math.cos(angle) * radius];
    plantBranch(builder, [0, .17, 0], end, .055);
  }
};

const shrubParts = (builder: RoadPlantBuilder, definition: RoadPlantDefinition, variant: number, base: number) => {
  const stems = builder.detailed ? 13 : 7;
  for (let stem = 0; stem < stems; stem++) {
    const angle = stem * 2.399963 + variant * .61;
    const spread = definition.crownRadius * (.36 + plantNoise(stem + builder.seed) * .36);
    const height = definition.height * (.58 + plantNoise(stem * 9 + builder.seed) * .4);
    const tip: Point3 = [Math.sin(angle) * spread, base + height, Math.cos(angle) * spread];
    const root: Point3 = [Math.sin(angle) * .035, base, Math.cos(angle) * .035];
    plantBranch(builder, root, tip, .012);
    const leaves = builder.detailed ? 12 : 6;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const t = .25 + leaf / leaves * .73, yaw = angle + leaf * 2.4;
      const radius = Math.min(.045, definition.crownRadius - spread - definition.leafLength / 2);
      plantLeaf(builder, [tip[0] * t + Math.sin(yaw) * radius, base + height * t,
        tip[2] * t + Math.cos(yaw) * radius], yaw, definition.leafLength, definition.leafWidth,
      definition.foliage, stem * 31 + leaf);
    }
    if (definition.blossom && (stem + variant) % 2 === 0)
      plantFlower(builder, tip, definition.blossom, definition.form === "flower" ? .025 : .035, stem);
  }
};

const topiaryParts = (builder: RoadPlantBuilder, definition: RoadPlantDefinition, variant: number, base: number) => {
  const radius = definition.crownRadius - definition.leafLength * .4;
  const center = base + definition.height * .52;
  plantBranch(builder, [0, base + .02, 0], [0, center, 0], .025);
  const count = builder.detailed ? 420 : 150;
  for (let leaf = 0; leaf < count; leaf++) {
    const y = 1 - (leaf + .5) / count * 2, ring = Math.sqrt(1 - y * y);
    const angle = leaf * 2.399963 + variant * .71, irregularity = .94 + plantNoise(leaf + builder.seed) * .06;
    const tip: Point3 = [Math.sin(angle) * ring * radius * irregularity,
      center + y * radius * (1 + variant * .035), Math.cos(angle) * ring * radius * irregularity];
    if (leaf % (builder.detailed ? 24 : 15) === 0)
      plantBranch(builder, [0, center, 0], tip, .006);
    const leafScale = builder.detailed ? 1.35 : 1.8;
    plantLeaf(builder, tip, angle, definition.leafLength * leafScale,
      definition.leafWidth * leafScale, definition.foliage, leaf);
  }
};

const columnParts = (builder: RoadPlantBuilder, definition: RoadPlantDefinition, variant: number) => {
  treeRoots(builder, .10);
  plantBranch(builder, [0, .025, 0], [0, definition.height, 0], .045);
  const tiers = builder.detailed ? 16 : 10;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers, y = .16 + t * (definition.height - .16);
    const spread = definition.crownRadius * Math.sin(Math.PI * (.15 + t * .85)) * .75;
    const branches = builder.detailed ? 7 : 5;
    for (let branch = 0; branch < branches; branch++) {
      const angle = branch * Math.PI * 2 / branches + tier * .7 + variant;
      const tip: Point3 = [Math.sin(angle) * spread, y + .07, Math.cos(angle) * spread];
      plantBranch(builder, [0, y - .06, 0], tip, .008);
      for (let leaf = 0; leaf < (builder.detailed ? 5 : 3); leaf++)
        plantLeaf(builder, tip, angle + leaf * 1.2, definition.leafLength,
          definition.leafWidth, definition.foliage, tier * 100 + branch * 7 + leaf);
    }
  }
};

const palmParts = (builder: RoadPlantBuilder, definition: RoadPlantDefinition, variant: number) => {
  treeRoots(builder, .14);
  const head = definition.height - .35, lean = (variant - 1) * .09;
  const trunkSections = builder.detailed ? 15 : 8;
  for (let section = 0; section < trunkSections; section++) {
    const t = section / trunkSections, next = (section + 1) / trunkSections;
    plantBranch(builder, [lean * t * t, .04 + head * t, 0], [lean * next * next, .04 + head * next, 0],
      .075 - t * .022);
  }
  const fronds = builder.detailed ? 11 : 7;
  for (let frond = 0; frond < fronds; frond++) {
    const angle = frond * Math.PI * 2 / fronds + variant * .6;
    const segments = builder.detailed ? 9 : 5;
    let previous: Point3 = [lean, head, 0];
    for (let segment = 1; segment <= segments; segment++) {
      const t = segment / segments, reach = definition.crownRadius * t;
      const y = head + Math.sin(t * Math.PI) * .32 - t * .12;
      const point: Point3 = [lean + Math.sin(angle) * reach, y, Math.cos(angle) * reach];
      plantBranch(builder, previous, point, .008);
      for (const side of [-1, 1]) plantLeaf(builder, point, angle + side * .95,
        definition.leafLength * Math.sin(t * Math.PI * .85), definition.leafWidth,
        definition.foliage, frond * 30 + segment * 2 + side);
      previous = point;
    }
  }
};

export const createRoadPlantRecipe = (definition: RoadPlantDefinition, detailed: boolean,
  variant = 0, potted = false): RoadPlantRecipe => {
  if (!Number.isInteger(variant) || variant < 0 || variant >= definition.variants)
    throw new Error("Unknown road plant variant");
  if (potted && !["bush", "flower", "column", "bonsai", "topiary"].includes(definition.form))
    throw new Error("Raised-crown road trees require a ground root bed");
  const builder: RoadPlantBuilder = { parts: [], detailed, seed: variant * 73 + definition.id.length * 17 };
  let base = 0;
  if (potted) base = plantCeramicPot(builder, variant, definition.form === "bonsai");
  if (definition.form === "topiary") topiaryParts(builder, definition, variant, base);
  else if (definition.form === "bonsai") grownRoadTreeParts(builder, definition, variant, base);
  else if (definition.form === "tree" || definition.form === "weeping") {
    treeRoots(builder, .15);
    grownRoadTreeParts(builder, definition, variant);
  }
  else if (definition.form === "palm") palmParts(builder, definition, variant);
  else if (definition.form === "column") {
    columnParts(builder, definition, variant);
    if (base) for (const part of builder.parts.slice()) {
      // Only shift plant pieces; pot parts precede the first bark member.
      if (part.surface === "bark" || part.surface === "leaf") part.position[1] += base;
    }
  } else shrubParts(builder, definition, variant, base);
  return { id: definition.id, variant, potted, form: "roadside", flowerColour: builder.flowerColour,
    parts: builder.parts, wind: 0 };
};

/** Standalone trees share species construction, with lower branches and broader natural crowns. */
export const createStandalonePlantRecipe = (definition: RoadPlantDefinition, detailed: boolean, variant = 0) => {
  const natural = { ...definition };
  if (["tree", "weeping"].includes(definition.form)) {
    natural.height *= 1.35;
    natural.crownRadius *= 3.0;
    natural.crownBase = definition.form === "weeping" ? .85 : 1.05;
  } else if (definition.form === "palm") {
    natural.height *= 1.3;
    natural.crownRadius *= 1.55;
  }
  return { ...createRoadPlantRecipe(natural, detailed, variant), form: "standalone" as const };
};
