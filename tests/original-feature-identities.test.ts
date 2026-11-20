import { describe, expect, it } from "vitest";

import { recoverOriginalFeatureIdentities } from "../src/app/map-editor/original-feature-selector";
import { applyWorldDiff,createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  featureCellRuns, featureContainsCell,   type GeneratedFeatureIdentity,
originalFeatureCells, validGeneratedFeatureIdentities} from "../src/shared/world/generation/generated-feature-identities";
import { createMountainHeights } from "../src/shared/world/generation/mountains";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

describe("original generated feature identity", () => {
  it("captures independent overlapping native source supports without altering generated heights", () => {
    const grid = { cellsX: 128, cellsZ: 128 }, mask = new Float32Array(129 * 129).fill(1);
    const room = new Float32Array(mask.length).fill(70), relief = { amount: 4, landShare: 1 };
    const original = createMountainHeights(grid, 1234, mask, room, relief);
    let records: GeneratedFeatureIdentity[] = [];
    const recorded = createMountainHeights(grid, 1234, mask, room, relief, value => { records = value; });
    expect(recorded).toEqual(original); expect(records.length).toBeGreaterThan(1);
    expect(validGeneratedFeatureIdentities(records, grid)).toBe(true);
    const overlapping = Array.from({ length: 128 * 128 }, (_, cell) =>
      records.filter(feature => featureContainsCell(feature, cell)).length).some(count => count > 1);
    expect(overlapping).toBe(true);
    expect(originalFeatureCells(records[0]!, 1)).toBeNull();
  });

  it("validates sparse bounded support runs rather than treating bounding squares as features", () => {
    const runs = featureCellRuns(new Set([0, 1, 5, 8, 9]));
    expect(runs).toEqual([[0, 2], [5, 1], [8, 2]]);
    const feature: GeneratedFeatureIdentity = { version: 1, id: 1, source: "massif", kind: "relief", x: 1, z: 1, runs };
    expect(validGeneratedFeatureIdentities([feature], { cellsX: 4, cellsZ: 4 })).toBe(true);
    expect(featureContainsCell(feature, 3)).toBe(false);
    expect(validGeneratedFeatureIdentities([{ ...feature, runs: [[0, 8], [5, 2]] }],
      { cellsX: 4, cellsZ: 4 })).toBe(false);
  });

  const options = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, forest: 0,
    mountains: 2, rivers: 0, erosionDroplets: 0 };
  preloadWorlds(options);
  it("recovers only metadata from a matching recipe, persists it and includes recovery in undo", async () => {
    const world = cachedWorld(options), candidate = structuredClone(world);
    world.generatedFeatureIdentities = undefined;
    world.heights[100] = world.heights[100]! + .8;
    const before = world.heights.slice(), snapshot = createWorldSnapshot(world, null);
    snapshot.capture(); world.generatedFeatureIdentities = recoverOriginalFeatureIdentities(world, candidate);
    expect(world.heights).toEqual(before);
    const diff = snapshot.diff()!; expect(diff.featureIdentities).toBeDefined();
    const loaded = (await readMapFile(await writeMapFile(world, {
      name: "Original feature identities", source: "generated", savedAt: 1, animals: []
    }))).world;
    expect(loaded.generatedFeatureIdentities).toEqual(candidate.generatedFeatureIdentities);
    applyWorldDiff(world, null, diff, "before"); expect(world.generatedFeatureIdentities).toBeUndefined();
    applyWorldDiff(world, null, diff, "after"); expect(world.generatedFeatureIdentities).toEqual(candidate.generatedFeatureIdentities);
    expect(() => recoverOriginalFeatureIdentities({ ...world, generationProvenance: undefined }, candidate))
      .toThrow("no exact saved generator recipe");
    expect(() => recoverOriginalFeatureIdentities(world, { ...candidate, seed: candidate.seed + 1 }))
      .toThrow("Regenerated candidate does not match the saved map recipe.");
  });
});
