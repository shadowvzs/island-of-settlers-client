import { describe, expect, it } from "vitest";

import {
  EXPLORATION_FIELD_OF_VIEW,
  explorationSpyglassFieldOfView
} from "../src/app/exploration/movement";
import type { QualityPreset } from "../src/render-common/quality";
import {
  createExplorationLodAdapter,
  EXPLORATION_LOD_DEFAULTS,
  EXPLORATION_LOD_LOAD_POLICY,
  EXPLORATION_SPYGLASS_LOD_CAPS,
  explorationLodAtDistance,
  explorationLodDistances,
  explorationLodZoom
} from "../src/renderers/three/exploration/exploration-lod";

const high: Pick<
  QualityPreset,
  "animalSilhouettes" | "grass" | "liteGround" | "rockDetail" | "sunShadows"
> = {
  animalSilhouettes: true,
  grass: true,
  liteGround: false,
  rockDetail: true,
  sunShadows: true
};
const minimal = {
  ...high,
  animalSilhouettes: false,
  grass: false,
  liteGround: true,
  rockDetail: false,
  sunShadows: false
};

describe("exploration FPS distance LOD", () => {
  it("keeps near detail near the eye and bounded far detail", () => {
    const near = explorationLodAtDistance(10, high);
    expect(near).toMatchObject({
      animalDetail: "near",
      grassVisible: true,
      maxPropDistance: EXPLORATION_LOD_DEFAULTS.maxViewDistance,
      plantDetail: true,
      rockDetail: "near",
      terrainDetail: "near",
      useImpostors: false
    });
    expect(near.fogFar).toBeLessThanOrEqual(EXPLORATION_LOD_DEFAULTS.maxViewDistance);

    const far = explorationLodAtDistance(100, high);
    expect(far).toMatchObject({
      grassVisible: false,
      plantDetail: false,
      rockDetail: "coarse",
      terrainDetail: "coarse",
      useImpostors: true
    });
    expect(far.maxPropDistance).toBeLessThanOrEqual(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
    expect(far.fogFar).toBeLessThanOrEqual(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
  });

  it("never forces detailed plants or full LOD on a minimal profile", () => {
    const near = explorationLodAtDistance(4, minimal);
    expect(near.plantDetail).toBe(false);
    expect(near.grassVisible).toBe(false);
    expect(near.rockDetail).toBe("coarse");
    expect(near.shadowRadius).toBe(0);
    const far = explorationLodAtDistance(400, minimal);
    expect(far.distance).toBe(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
    expect(far.useImpostors).toBe(true);
    expect(far.maxPropDistance).toBe(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
  });

  it("adds hysteresis to the walking thresholds", () => {
    const adapter = createExplorationLodAdapter(high, { hysteresis: 5, nearDetailDistance: 24 });
    expect(adapter.update(10).plantDetail).toBe(true);
    expect(adapter.update(28).plantDetail).toBe(true);
    expect(adapter.update(30).plantDetail).toBe(false);
    expect(adapter.update(20).plantDetail).toBe(false);
    expect(adapter.update(18).plantDetail).toBe(true);
    expect(adapter.descriptor()?.plantDetail).toBe(true);
    adapter.dispose();
    expect(adapter.descriptor()).toBeNull();
  });

  it("divides the eye distance by the spyglass zoom before choosing detail", () => {
    const far = explorationLodAtDistance(60, high, {}, 1);
    const zoomed = explorationLodAtDistance(60, high, {}, 3);
    expect(far.plantDetail).toBe(false);
    expect(far.terrainDetail).toBe("coarse");
    expect(far.useImpostors).toBe(true);
    expect(zoomed.plantDetail).toBe(true);
    expect(zoomed.terrainDetail).toBe("near");
    expect(zoomed.useImpostors).toBe(false);
    expect(zoomed.distance).toBeCloseTo(20, 8);
    const adapter = createExplorationLodAdapter(high);
    expect(adapter.update(60, 3).plantDetail).toBe(true);
    expect(adapter.update(60, 1).plantDetail).toBe(false);
    adapter.dispose();
  });

  it("scales possessed LOD by the real spyglass field of view", () => {
    expect(explorationLodZoom(EXPLORATION_FIELD_OF_VIEW, EXPLORATION_FIELD_OF_VIEW)).toBe(1);
    const zoom3 = explorationLodZoom(explorationSpyglassFieldOfView(3), EXPLORATION_FIELD_OF_VIEW);
    const zoom8 = explorationLodZoom(explorationSpyglassFieldOfView(8), EXPLORATION_FIELD_OF_VIEW);
    expect(zoom3).toBeCloseTo(3.37, 1);
    expect(zoom8).toBeCloseTo(9.07, 1);
    expect(explorationLodZoom(0, EXPLORATION_FIELD_OF_VIEW)).toBe(1);
    expect(explorationLodZoom(Number.NaN, EXPLORATION_FIELD_OF_VIEW)).toBe(1);

    expect(EXPLORATION_SPYGLASS_LOD_CAPS).toEqual({ detail: 160, detailMinimal: 120, grass: 90 });
    expect(explorationLodDistances(1, false)).toEqual({ detail: 55, grass: 38 });
    expect(explorationLodDistances(3.37, false)).toEqual({ detail: 160, grass: 90 });
    expect(explorationLodDistances(3.37, true)).toEqual({ detail: 120, grass: 90 });
    expect(explorationLodDistances(10, true)).toEqual({ detail: 120, grass: 90 });
  });

  it("never decreases detail or grass distance as magnification grows", () => {
    let previous = explorationLodDistances(1, false);
    for (let zoom = 1.25; zoom <= 10; zoom += 0.25) {
      const next = explorationLodDistances(zoom, false);
      expect(next.detail).toBeGreaterThanOrEqual(previous.detail);
      expect(next.grass).toBeGreaterThanOrEqual(previous.grass);
      previous = next;
    }
    expect(previous).toEqual({ detail: 160, grass: 90 });
  });

  it("bounds the adapter and keeps the single-island, no-prefetch policy", () => {
    const adapter = createExplorationLodAdapter(high);
    const far = adapter.update(1_000);
    expect(far.distance).toBe(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
    expect(far.maxPropDistance).toBe(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
    expect(far.maxAnimalDistance).toBeLessThanOrEqual(EXPLORATION_LOD_DEFAULTS.maxViewDistance);
    expect(EXPLORATION_LOD_LOAD_POLICY).toEqual({
      assetScopes: "current-island",
      catalogPrefetch: false,
      otherIslands: false,
      scenes: 1
    });
    adapter.dispose();
  });
});
