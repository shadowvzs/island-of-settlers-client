import { describe, expect, it } from "vitest";

import {
  islandBuildKeys,
  islandBuildRevisions,
  toIslandBuildGroup
} from "../src/app/island-build-keys";
import { toMapCacheKey } from "../src/app/map-editor/map-startup";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { BUILD, FOG, PROP, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

/** A fresh copy per test: the tests mutate terrain, props and build state. */
const createWorld = () => cachedWorld(SMALL_EDITOR_WORLD);

const loadedMap = (
  world: WorldData,
  savedAt: number,
  source = "forest=2&mountains=2"
): LoadedMap => ({ animals: [], meta: { name: "Test island", savedAt, source }, terrain: null, world });

describe("island build cache identity", () => {
  it("reuses the map key and build keys when only savedAt advances", () => {
    const world = createWorld();
    const first = toMapCacheKey("map-1", loadedMap(world, 1_700_000_000_000));
    const capturedAgain = structuredClone(world);
    const second = toMapCacheKey("map-1", loadedMap(capturedAgain, 1_700_003_600_000));

    expect(second).toBe(first);
    expect(second).not.toContain("1700003600000");
    const keys = islandBuildKeys(world), again = islandBuildKeys(capturedAgain);
    expect(again.content).toBe(keys.content);
    expect(again.rockBodies).toBe(keys.rockBodies);
    expect(again.islandNav).toBe(keys.islandNav);
    expect(again.fieldCover(3)).toBe(keys.fieldCover(3));
    expect(again.waterField).toBe(keys.waterField);
  });

  it("keeps the build group across captures and ignores non-persistent revisions", () => {
    const world = createWorld();
    const group = toIslandBuildGroup(world);
    world.buildRevision = 17;
    world.terrainRevision = 23;
    world.fogRevision = 29;

    expect(toIslandBuildGroup(world)).toBe(group);
    expect(toIslandBuildGroup(structuredClone(world))).toBe(group);
  });

  it("invalidates terrain views and the group when heights change without a revision bump", () => {
    const world = createWorld();
    const before = islandBuildKeys(world), group = toIslandBuildGroup(world);
    world.heights[123] = world.heights[123]! + 0.25;

    const after = islandBuildKeys(world);
    expect(toIslandBuildGroup(world)).not.toBe(group);
    expect(after.terrainChunks("terrain", 0, 2))
      .not.toBe(before.terrainChunks("terrain", 0, 2));
    expect(after.rockBodies).not.toBe(before.rockBodies);
    expect(after.waterField).not.toBe(before.waterField);
    expect(after.islandNav).not.toBe(before.islandNav);
  });

  it("invalidates props and leaves the prop-free water field alone", () => {
    const world = createWorld();
    const before = islandBuildKeys(world), group = toIslandBuildGroup(world);
    world.props.types[0] = world.props.types[0] === PROP.bush ? PROP.fern : PROP.bush;
    world.props.x[0] = world.props.x[0]! + 0.5;

    const after = islandBuildKeys(world);
    expect(toIslandBuildGroup(world)).not.toBe(group);
    expect(after.terrainChunks("terrain", 0, 2))
      .not.toBe(before.terrainChunks("terrain", 0, 2));
    expect(after.islandNav).not.toBe(before.islandNav);
    expect(after.waterField).toBe(before.waterField);
  });

  it("invalidates building and resource edits", () => {
    const world = createWorld();
    const before = islandBuildKeys(world), group = toIslandBuildGroup(world);
    const buildCell = 40 * world.cellsX + 40;
    world.buildClass[buildCell] = BUILD.large;
    world.blocking[buildCell] = 0;

    const afterBuilding = islandBuildKeys(world);
    expect(toIslandBuildGroup(world)).not.toBe(group);
    expect(afterBuilding.rockBodies).not.toBe(before.rockBodies);
    expect(afterBuilding.islandNav).not.toBe(before.islandNav);
    expect(afterBuilding.fieldCover(3)).not.toBe(before.fieldCover(3));
    expect(afterBuilding.waterField).toBe(before.waterField);

    const oreCell = 50 * world.cellsX + 50;
    world.oreAmount[oreCell] = (world.oreAmount[oreCell] ?? 0) + 1;
    const afterResource = islandBuildKeys(world);
    expect(afterResource.rockBodies).not.toBe(afterBuilding.rockBodies);
    expect(afterResource.islandNav).not.toBe(afterBuilding.islandNav);
  });

  it("invalidates fog shading without changing navigation", () => {
    const world = createWorld();
    const before = islandBuildKeys(world), group = toIslandBuildGroup(world);
    world.fog[17 * world.cellsX + 17] = FOG.visible;

    const after = islandBuildKeys(world);
    expect(toIslandBuildGroup(world)).not.toBe(group);
    expect(after.waterField).not.toBe(before.waterField);
    expect(after.fieldCover(3)).not.toBe(before.fieldCover(3));
    expect(after.islandNav).toBe(before.islandNav);
  });

  it("invalidates source changes and keeps different slots and islands apart", () => {
    const world = createWorld();
    const sameContent = structuredClone(world);
    const otherIsland = structuredClone(world);
    otherIsland.seed += 1;

    expect(toMapCacheKey("map-1", loadedMap(sameContent, 1, "forest=1")))
      .not.toBe(toMapCacheKey("map-1", loadedMap(world, 1, "forest=2")));
    expect(toMapCacheKey("map-2", loadedMap(sameContent, 1)))
      .not.toBe(toMapCacheKey("map-1", loadedMap(world, 1)));
    expect(toMapCacheKey(null, loadedMap(otherIsland, 1)))
      .not.toBe(toMapCacheKey(null, loadedMap(world, 1)));
    expect(islandBuildRevisions(otherIsland).content)
      .not.toBe(islandBuildRevisions(world).content);
  });

  it("keeps quality-specific build signatures apart", () => {
    const keys = islandBuildKeys(createWorld());
    expect(keys.rockSkins("full", 0, 2)).not.toBe(keys.rockSkins("coarse", 0, 2));
    expect(keys.fieldCover(3)).not.toBe(keys.fieldCover(2));
    expect(keys.terrainChunks("terrain", 0, 2)).not.toBe(keys.terrainChunks("water", 0, 2));
  });
});
