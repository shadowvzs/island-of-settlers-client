import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { getEditRevision } from "../src/render-common/map-edit/edit-revision";
import { buildEditedRegion } from "../src/render-common/map-edit/region-rebuild";
import { getKnownRocks } from "../src/render-common/rocks/island-rock-instances";
import {
  buildIslandRockBodies,
  type IslandRockMesh
} from "../src/render-common/rocks/island-rocks";
import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import { getChunkCounts, listRegionChunks } from "../src/render-common/terrain-chunks";
import { applyStampChanges } from "../src/shared/world/editing/terrain/terrain-apply";
import {
  addStamp,
  createTerrainEditState
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import type { WorldData } from "../src/shared/world/world-data";
import { findOpenSpots } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, erosionDroplets: 8000 };

/** A rock's look and place, rounded (one string per instance, order free). */
const describeRock = ({ axes, centre, family, role, tile, tint, variant }: RockInstance) =>
  [...centre, ...axes.flat(), tint].map((value) => value.toFixed(5)).join(",") +
  `|${family}|${role}|${tile}|${variant}`;

const describeRocks = (rocks: RockInstance[]) => rocks.map(describeRock).sort();

const sortMeshes = (meshes: IslandRockMesh[]) =>
  [...meshes].sort(
    (a, b) =>
      a.chunk - b.chunk ||
      (a.group ?? "").localeCompare(b.group ?? "") ||
      Number(a.small) - Number(b.small)
  );

/**
 * A full rock build of the world, then an editor mountain and lake rebuilt the way the map editor
 * does (worker region rebuild of the touched chunks), and a full build of a copy of the edited
 * world (a saved and loaded map: no caches).
 */
const buildEditedWorld = () => {
  const world: WorldData = cachedWorld(OPTIONS);
  buildIslandRockBodies(world, createVertexFog(world));
  const [mountain, lake] = findOpenSpots(world, 2, 24);
  const state = createTerrainEditState();
  const changes = [
    addStamp(state, mountain!, 5, 7),
    addStamp(state, lake!, 3, 11, { kind: "lake" })
  ];
  const { cells } = applyStampChanges(world, state, changes);
  const chunks = listRegionChunks(world, cells);
  const placed = getKnownRocks(world);
  const request = { cells, chunks, modes: [], placed, waterField: false };
  const rebuild = buildEditedRegion(world, request);
  const skin = buildEditedRegion(world, request, "skin");
  const loaded = structuredClone(world);
  const full = buildIslandRockBodies(loaded, createVertexFog(loaded));
  const { chunksX } = getChunkCounts(world);
  const rebuilt = new Set(chunks.map(({ chunkX, chunkZ }) => chunkZ * chunksX + chunkX));
  return { before: placed, full, rebuild, rebuilt, revision: getEditRevision(world), skin };
};

describe("rock rebuild of an edited area", () => {
  const { before, full, rebuild, rebuilt, revision, skin } = buildEditedWorld();

  it("rebuilds only a part of the island", () => {
    expect(rebuilt.size).toBeGreaterThan(0);
    expect(rebuilt.size).toBeLessThan(16);
    expect(before.some(({ tile }) => !rebuilt.has(tile!))).toBe(true);
  });

  it("places the same rocks as a full build of the edited world, inside and outside", () => {
    expect(rebuild.placed.some(({ tile }) => rebuilt.has(tile!))).toBe(true);
    expect(describeRocks(rebuild.placed)).toEqual(describeRocks(full.placed));
  });

  it("keeps the rocks outside the area untouched", () => {
    const outside = (rocks: RockInstance[]) => rocks.filter(({ tile }) => !rebuilt.has(tile!));
    expect(describeRocks(outside(rebuild.placed))).toEqual(describeRocks(outside(before)));
  });

  it("builds the same rock meshes (slabs, apron, scree, pebbles, stones) in the area", () => {
    const area = full.chunks.filter(({ chunk }) => rebuilt.has(chunk));
    const smallRocks = rebuild.rocks.filter(({ small }) => small);
    expect(smallRocks.length).toBeGreaterThan(0);
    expect(sortMeshes(rebuild.rocks)).toEqual(sortMeshes(area));
  });

  it("has mountain foot boulders on the edited mountain", () => {
    const apron = rebuild.placed.filter(
      ({ role, tile }) => role === ROCK_ROLE.outcrop && rebuilt.has(tile!)
    );
    expect(apron.length).toBeGreaterThan(0);
  });

  it("adds no skin meshes, so the editor schedules only the main region job", () => {
    expect(skin.rocks).toEqual([]);
    expect(skin.chunks).toEqual([]);
    expect(skin.revision).toEqual(revision);
    expect(rebuild.revision).toEqual(revision);
  });
});
