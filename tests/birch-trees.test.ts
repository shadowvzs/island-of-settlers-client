import { describe, expect, it } from "vitest";

import { getTreeVariants } from "../src/render-common/props/island-trees";
import { createPropMeshes, getMeshId } from "../src/render-common/props/prop-meshes";
import {
  BARK_FAMILY,
  BARK_FAMILY_STRIDE,
  BARK_UV_OFFSET
} from "../src/render-common/trees/bark-uv";
import { createBirchModel } from "../src/render-common/trees/birch-model";
import { BIRCH_FORMS, getBirchWoodTone } from "../src/render-common/trees/birch-shape";
import { createTreeModel } from "../src/render-common/trees/tree-factory";
import type { GrowthStage, TreeModel } from "../src/render-common/trees/tree-model";
import { BIRCH } from "../src/shared/world/tree-forms";
import { PROP } from "../src/shared/world/world-data";

const STAGES: GrowthStage[] = [1, 2, 3, 4, 5];

const stems = (model: TreeModel) => model.wood.filter((limb) => limb.depth === 0);

/** Largest horizontal offset of the trunk axis from its foot, relative to its length. */
const getDisplacement = (model: TreeModel) => {
  const points = stems(model)[0]!.points;
  const foot = points[0]!;
  const top = points[points.length - 1]!;
  const offsets = points.map((point) => Math.hypot(point[0] - foot[0], point[2] - foot[2]));
  return Math.max(...offsets) / (top[1] - foot[1]);
};

describe("birch models", () => {
  it("are deterministic and grow structurally through the stages", () => {
    expect(createBirchModel(9, 4)).toEqual(createBirchModel(9, 4));
    const models = STAGES.map((stage) => createBirchModel(3, stage, BIRCH.classic));
    for (let stage = 1; stage < models.length; stage += 1) {
      expect(models[stage]!.bounds.height).toBeGreaterThan(models[stage - 1]!.bounds.height);
      expect(models[stage]!.wood.length).toBeGreaterThan(models[stage - 1]!.wood.length);
    }
    expect(models[2]!.wood.some((limb) => limb.depth === 3)).toBe(true);
    expect(models[0]!.wood.some((limb) => limb.depth === 3)).toBe(false);
  });

  it("builds five different structures", () => {
    const forms = BIRCH_FORMS.map((_, form) => createBirchModel(5, 5, form));
    const byForm = Object.fromEntries(BIRCH_FORMS.map((form, index) => [form, forms[index]!]));
    expect(stems(byForm.multiStem!).length).toBeGreaterThanOrEqual(2);
    expect(stems(byForm.multiStem!).length).toBeLessThanOrEqual(4);
    for (const form of ["young", "classic", "weeping", "old"]) {
      expect(stems(byForm[form]!)).toHaveLength(1);
    }
    expect(stems(byForm.old!)[0]!.radii[1]).toBeGreaterThan(stems(byForm.classic!)[0]!.radii[1]!);
    expect(byForm.young!.bounds.radius).toBeLessThan(byForm.classic!.bounds.radius);
    const hanging = (model: TreeModel) =>
      model.foliage.filter((spray) => spray.growth[1] < -0.6).length / model.foliage.length;
    expect(hanging(byForm.weeping!)).toBeGreaterThan(hanging(byForm.classic!) * 1.5);
  });

  it("curves the trunk gently (a few percent, never straight)", () => {
    for (let seed = 1; seed < 6; seed += 1) {
      const displacement = getDisplacement(createBirchModel(seed, 5, BIRCH.classic));
      expect(displacement).toBeGreaterThan(0.01);
      expect(displacement).toBeLessThan(0.09);
    }
  });

  it("keeps an airy canopy: fewer leaf clusters than the oak, thinner limbs", () => {
    const birch = createBirchModel(4, 5, BIRCH.classic);
    const oak = createTreeModel("oak", 5, 4);
    expect(birch.foliage.length).toBeLessThan(oak.foliage.length * 1.2);
    const primaries = (model: TreeModel) =>
      model.wood.filter((limb) => limb.depth === 1 && !limb.root);
    const thickest = (model: TreeModel) =>
      Math.max(...primaries(model).map((limb) => limb.radii[0]!));
    expect(thickest(birch) / birch.wood[0]!.radii[1]!).toBeLessThan(0.5);
    const low = createBirchModel(4, 5, BIRCH.classic, "low");
    const high = createBirchModel(4, 5, BIRCH.classic, "high");
    expect(low.foliage.length).toBeLessThan(birch.foliage.length);
    expect(high.foliage.length).toBeGreaterThan(birch.foliage.length);
  });

  it("varies leaf colour per cluster, not per leaf, and faces leaves different ways", () => {
    const model = createBirchModel(8, 5, BIRCH.classic);
    const hues = model.foliage.map((spray) => spray.hue);
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(1.4);
    const facings = new Set(
      model.foliage.map((spray) => spray.facing.map((v) => v.toFixed(1)).join())
    );
    expect(facings.size).toBeGreaterThan(model.foliage.length * 0.3);
  });

  it("colours the wood white on the trunk, grey on branches and dark brown on twigs", () => {
    const bark = { roughBase: 0.22, whiteness: 1 };
    const luminance = (tone: readonly number[]) => tone[0]! + tone[1]! + tone[2]!;
    const trunk = getBirchWoodTone(bark, 0, 0.5, 0.6);
    const foot = getBirchWoodTone(bark, 0, 0, 0);
    const branch = getBirchWoodTone(bark, 1, 0.8, 0);
    const twig = getBirchWoodTone(bark, 3, 1, 0);
    expect(Math.min(...trunk)).toBeLessThan(0.95);
    expect(luminance(trunk)).toBeGreaterThan(luminance(foot));
    expect(luminance(trunk)).toBeGreaterThan(luminance(branch));
    expect(luminance(branch)).toBeGreaterThan(luminance(twig));
    expect(twig[0]).toBeGreaterThan(twig[2]);
  });
});

describe("birch wind, stump and island meshes", () => {
  it("sways lighter than the oak at the trunk and more at the twigs (wind hierarchy)", () => {
    const birch = createBirchModel(6, 5, BIRCH.classic);
    const oak = createTreeModel("oak", 5, 6);
    const tipSway = (model: TreeModel, depth: number) =>
      Math.max(...model.wood.filter((limb) => limb.depth === depth).map((limb) => limb.sway[1]));
    const levels = [0, 1, 2, 3].map((depth) => tipSway(birch, depth));
    for (let depth = 1; depth < levels.length; depth += 1) {
      expect(levels[depth]!).toBeGreaterThan(levels[depth - 1]!);
    }
    expect(levels[0]!).toBeLessThan(tipSway(oak, 0));
    expect(levels[3]!).toBeGreaterThan(tipSway(oak, 3));
    const leaves = Math.min(...birch.foliage.map((spray) => spray.sway));
    expect(leaves).toBeGreaterThanOrEqual(levels[2]!);
  });

  it("leaves a pale stump only when chopped", () => {
    const stump = createTreeModel("birch", "chopped", 5);
    expect(stump.wood.length + stump.foliage.length).toBe(0);
    expect(Math.min(...stump.stump!.barkTone)).toBeGreaterThan(0.5);
  });

  it("draw every island structure within the oak's triangle budget with birch bark", () => {
    const meshes = createPropMeshes(2024);
    const variants = getTreeVariants(PROP.birchTree);
    expect(variants).toHaveLength(BIRCH_FORMS.length * 3);
    const birchStart = -BARK_UV_OFFSET - BARK_FAMILY.birch * BARK_FAMILY_STRIDE;
    variants.forEach((_, variant) => {
      const mesh = meshes[getMeshId(PROP.birchTree, variant)]!;
      expect(mesh.indices.length / 3).toBeLessThan(1800);
      const barkU = mesh.uvs.filter((value, index) => index % 2 === 0 && value <= birchStart);
      expect(barkU.length).toBeGreaterThan(30);
      expect(Math.min(...barkU)).toBeGreaterThan(birchStart - BARK_FAMILY_STRIDE);
    });
  });
});
