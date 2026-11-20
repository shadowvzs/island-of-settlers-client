import { describe, expect, it } from "vitest";

import {
  getSeasonLeafCapacity, getSeasonLeafFall
} from "../src/render-common/seasonal-appearance/season-leaf-fall";

describe("seasonal falling leaves (P1)", () => {
  it("falls in autumn and in the leaf drop, never in summer, spring or on Minimal", () => {
    expect(getSeasonLeafFall({ autumn: 0, dormant: 0, spring: 0 })).toBe(0);
    expect(getSeasonLeafFall({ autumn: 1, dormant: 0, spring: 0 })).toBeGreaterThan(0.4);
    expect(getSeasonLeafFall({ autumn: 0.6, dormant: 0.5, spring: 0 })).toBe(1);
    expect(getSeasonLeafFall({ autumn: 0, dormant: 0.6, spring: 0.4 })).toBe(0);
    expect(getSeasonLeafCapacity(false, 14)).toBe(0);
    expect(getSeasonLeafCapacity(true, 14)).toBe(192);
    expect(getSeasonLeafCapacity(true, 3)).toBe(96);
  });
});

describe("seasonal leaf fall layer", () => {
  it("drops leaves from broadleaf crowns near the focus in autumn only", async () => {
    const { Vector4 } = await import("three");
    const { allocatePropInstances } = await import("../src/render-common/props/prop-instances");
    const { getMeshId } = await import("../src/render-common/props/prop-meshes");
    const { PROP } = await import("../src/shared/world/world-data");
    const { createSeasonalLeafFall } = await import("../src/renderers/three/seasonal-leaf-fall");
    const instances = allocatePropInstances(2);
    const oak = getMeshId(PROP.broadleafTree, 0);
    const pine = getMeshId(PROP.coniferTree, 0);
    instances.meshIds.set([oak, pine]);
    instances.scale.set([1, 1]);
    instances.x.set([10, 11]);
    instances.z.set([10, 11]);
    instances.sourceIndex.set([0, 1]);
    const meshes = [] as { height: number; radius: number }[];
    meshes[oak] = { height: 3, radius: 1.5 };
    meshes[pine] = { height: 4, radius: 1 };
    const season = new Vector4(0, 0, 0, 0);
    const layer = createSeasonalLeafFall(instances, meshes as never, { uSeason: { value: season } }, 96, () => true);
    for (let frame = 0; frame <= 30; frame++) layer.update(10, 10, frame * 0.05);
    expect(layer.mesh.count).toBe(0);
    season.set(1, 0, 0, 0);
    for (let frame = 31; frame <= 90; frame++) layer.update(10, 10, frame * 0.05);
    expect(layer.mesh.count).toBeGreaterThan(5);
  });
});
