import { describe, expect, it } from "vitest";

import { createTreeStageMeshes } from "../src/render-common/growth/stage-meshes";
import { findTreeVariant, getTreeVariants } from "../src/render-common/props/island-trees";
import { createPropMeshes, getMeshId } from "../src/render-common/props/prop-meshes";
import { getConiferLook } from "../src/render-common/trees/conifer-shapes";
import { createTreeModel } from "../src/render-common/trees/tree-factory";
import type { GrowthStage, TreeModel } from "../src/render-common/trees/tree-model";
import { COMPETITION, CONIFER, encodeTreeForm } from "../src/shared/world/tree-forms";
import { PROP } from "../src/shared/world/world-data";

const SEED = 77;
const STAGES: GrowthStage[] = [1, 2, 3, 4, 5];

const grow = (archetype: number, stage: GrowthStage = 5, competition: number = COMPETITION.open) =>
  createTreeModel("pine", stage, SEED, 5, encodeTreeForm(archetype, competition));

/** Lowest needle spray as a share of the tree height: where the live crown starts. */
/** Where the live crown starts: the lowest 5 % of the needle sprays, as a share of the height. */
const getCrownBase = (model: TreeModel) => {
  const heights = model.foliage.map((spray) => spray.position[1]).sort((a, b) => a - b);
  return heights[Math.floor(heights.length * 0.05)]! / model.bounds.height;
};

/** Crown radius as a share of the height. */
const getWidth = (model: TreeModel) => model.bounds.radius / model.bounds.height;

const getDeadWood = (model: TreeModel) => model.wood.filter((limb) => limb.dead).length;

describe("conifer archetypes", () => {
  const mature = Object.fromEntries(
    Object.entries(CONIFER).map(([name, archetype]) => [name, grow(archetype)])
  ) as Record<keyof typeof CONIFER, TreeModel>;

  it("differ by architecture: exposed trunks against crowns to the ground", () => {
    expect(getCrownBase(mature.spruce)).toBeLessThan(0.15);
    expect(getCrownBase(mature.mountain)).toBeLessThan(0.15);
    expect(getCrownBase(mature.lodgepole)).toBeGreaterThan(0.3);
  });

  it("differ by silhouette: narrow spruce and forest pine, broad mountain pine", () => {
    expect(getWidth(mature.lodgepole)).toBeLessThan(0.25);
    expect(getWidth(mature.spruce)).toBeLessThan(0.33);
    expect(getWidth(mature.mountain)).toBeGreaterThan(0.4);
    expect(mature.mountain.bounds.height).toBeLessThan(mature.spruce.bounds.height * 0.7);
    expect(mature.lodgepole.bounds.height).toBeGreaterThan(mature.spruce.bounds.height);
  });

  it("keep every trunk grey-brown, never orange (owner: no orange-red pine trunks)", () => {
    for (const archetype of Object.values(CONIFER)) {
      const [red, , blue] = getConiferLook(encodeTreeForm(archetype, 0), 5).barkTop;
      expect((red - blue) / red).toBeLessThan(0.32);
    }
  });

  it("set spruce needles along flat side fans", () => {
    const depths = (model: TreeModel) => new Set(model.wood.map((limb) => limb.depth));
    expect(depths(mature.spruce).has(3)).toBe(true);
    expect(depths(mature.spruce).has(2)).toBe(false);
  });

  it("grow structurally with every stage: taller, wider, a rising crown base, dead wood late", () => {
    for (const archetype of Object.values(CONIFER)) {
      const models = STAGES.map((stage) => grow(archetype, stage));
      for (let stage = 1; stage < models.length; stage += 1) {
        expect(models[stage]!.bounds.height).toBeGreaterThan(models[stage - 1]!.bounds.height);
        expect(models[stage]!.bounds.radius).toBeGreaterThan(models[stage - 1]!.bounds.radius);
      }
      expect(getDeadWood(models[0]!)).toBe(0);
    }
    const pines = STAGES.map((stage) => grow(CONIFER.lodgepole, stage));
    expect(getCrownBase(pines[4]!)).toBeGreaterThan(getCrownBase(pines[1]!) + 0.15);
    expect(getWidth(grow(CONIFER.mountain, 5))).toBeGreaterThan(
      getWidth(grow(CONIFER.mountain, 2))
    );
  });

  it("follow the stand: interior trees taller and narrower, edge crowns one sided", () => {
    const open = grow(CONIFER.lodgepole, 5, COMPETITION.open);
    const interior = grow(CONIFER.lodgepole, 5, COMPETITION.interior);
    const edge = grow(CONIFER.lodgepole, 5, COMPETITION.edge);
    expect(interior.bounds.height).toBeGreaterThan(open.bounds.height);
    expect(getWidth(interior)).toBeLessThan(getWidth(open));
    expect(getCrownBase(interior)).toBeGreaterThan(getCrownBase(open));
    expect(getDeadWood(interior)).toBeGreaterThan(getDeadWood(open));
    const reach = (side: number) =>
      Math.max(...edge.foliage.map((spray) => spray.position[0] * side));
    expect(reach(1)).toBeGreaterThan(reach(-1) * 1.5);
  });
});

describe("conifer island variants", () => {
  const meshes = createPropMeshes(2024);
  const variants = getTreeVariants(PROP.coniferTree);

  it("stay within the oak's triangle budget", () => {
    variants.forEach((_, variant) => {
      const mesh = meshes[getMeshId(PROP.coniferTree, variant)]!;
      expect(mesh.indices.length / 3).toBeLessThan(1800);
    });
  });

  it("build young trees open and fall back to them for any stand", () => {
    const youngInterior = encodeTreeForm(CONIFER.spruce, COMPETITION.interior);
    const young = findTreeVariant(PROP.coniferTree, youngInterior, 3);
    expect(variants[young]).toEqual({
      form: encodeTreeForm(CONIFER.spruce, COMPETITION.open),
      stage: 3
    });
    const matureInterior = findTreeVariant(PROP.coniferTree, youngInterior, 5);
    expect(variants[matureInterior]).toEqual({ form: youngInterior, stage: 5 });
  });

  it("grow every form through stages 1-5 that end at its own mature mesh", () => {
    const lines = createTreeStageMeshes(meshes, 2024);
    const matureForms = variants.filter((variant) => variant.stage === 5);
    for (const { form } of matureForms) {
      const line = lines.get(
        getMeshId(PROP.coniferTree, findTreeVariant(PROP.coniferTree, form, 5))
      )!;
      expect(line).toHaveLength(5);
      const heights = line.map((mesh) => mesh.height);
      for (let stage = 1; stage < 5; stage += 1)
        expect(heights[stage]!).toBeGreaterThan(heights[stage - 1]!);
    }
  });

  it("sway the slender tall forest pine more than the stiff spruce", () => {
    const outerWind = (archetype: number) => {
      const variant = findTreeVariant(PROP.coniferTree, encodeTreeForm(archetype, 0), 5);
      const mesh = meshes[getMeshId(PROP.coniferTree, variant)]!;
      let wind = 0;
      for (let vertex = 0; vertex < mesh.wind.length / 2; vertex += 1)
        wind = Math.max(wind, mesh.wind[vertex * 2]!);
      return wind;
    };
    expect(outerWind(CONIFER.lodgepole)).toBeGreaterThan(outerWind(CONIFER.spruce));
  });
});
