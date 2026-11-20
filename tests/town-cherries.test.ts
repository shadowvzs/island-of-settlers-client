import { describe, expect, it } from "vitest";

import { createIslandTreePropMesh, getTreeVariants } from "../src/render-common/props/island-trees";
import { plantTownCherries, TOWN_CHERRY_RADIUS } from "../src/shared/world/editing/town-cherries";
import { BROADLEAF, getFormArchetype } from "../src/shared/world/tree-forms";
import { PROP, type WorldData } from "../src/shared/world/world-data";

const world = () => {
  const count = 200, props = { count, form: new Uint8Array(count),
    types: new Uint8Array(count).fill(PROP.broadleafTree), x: new Float32Array(count), z: new Float32Array(count) };
  for (let index = 0; index < count; index++) {
    props.x[index] = 50 + (index % 20) * 4; props.z[index] = 50 + Math.floor(index / 20) * 8;
  }
  return { props, start: { x: 50, z: 50 } } as unknown as WorldData;
};

describe("town cherries", () => {
  it("turns some broadleaf trees near a Japanese town into cherries, deterministically", () => {
    const first = world(), second = world();
    const planted = plantTownCherries(first, "japanese");
    expect(planted).toBeGreaterThan(5);
    expect(plantTownCherries(second, "japanese")).toBe(planted);
    for (let index = 0; index < first.props.count; index++) {
      if (getFormArchetype(first.props.form[index]!) !== BROADLEAF.cherry) continue;
      const distance = Math.hypot(first.props.x[index]! - 50, first.props.z[index]! - 50);
      expect(distance).toBeLessThanOrEqual(TOWN_CHERRY_RADIUS);
    }
  });

  it("leaves every other nation's trees as oaks", () => {
    const roman = world();
    expect(plantTownCherries(roman, "roman")).toBe(0);
    expect([...roman.props.form].every(form => form === 0)).toBe(true);
  });

  it("draws cherries as their own blossoming broadleaf variants", () => {
    const variants = getTreeVariants(PROP.broadleafTree);
    const cherry = variants.findIndex(variant => variant.form === BROADLEAF.cherry && variant.stage === 5);
    const oak = variants.findIndex(variant => variant.form === BROADLEAF.oak && variant.stage === 5);
    expect(cherry).toBeGreaterThan(oak);
    expect(createIslandTreePropMesh(PROP.broadleafTree, cherry, 7).positions.length).toBeGreaterThan(0);
  });
});
