import { describe, expect, it, vi } from "vitest";

import { createTerrainRebuildQueue } from "../src/app/map-editor/terrain-rebuild-queue";
import type { TerrainStats, TerrainToolOptions } from "../src/app/map-editor/terrain-tool";
import { getEditRevision, type TaggedEditResult } from "../src/render-common/map-edit/edit-revision";
import type { RegionRebuild, RegionRebuildRequest } from "../src/render-common/map-edit/region-rebuild";
import { listRegionChunks } from "../src/render-common/terrain-chunks";
import type { NavWorld } from "../src/render-common/wildlife/nav/nav-query";
import {
  type CellRegion,
  unionRegions
} from "../src/shared/world/grid-geometry";
import type { WorldData } from "../src/shared/world/world-data";

const region = (minX: number, minZ: number, maxX: number, maxZ: number): CellRegion =>
  ({ maxX, maxZ, minX, minZ });

const AREA = region(1, 1, 2, 2);
const OTHER = region(40, 40, 41, 41);
const THIRD = region(5, 40, 6, 41);

const createWorld = () => ({
  buildRevision: 1,
  cellsX: 64,
  cellsZ: 64,
  props: { count: 0 },
  terrainRevision: 1
}) as unknown as WorldData;

/** A promise settled by hand, so a worker result can arrive after a newer edit. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const regionResult = (request: RegionRebuildRequest, world: WorldData): RegionRebuild => ({
  cells: request.cells,
  chunks: [],
  placed: [],
  revision: request.revision ?? getEditRevision(world),
  rocks: [],
  waterField: null,
  waterWeeds: null
});
const navResult = (revision: TaggedEditResult<NavWorld>["revision"]): TaggedEditResult<NavWorld> => ({
  revision,
  value: {} as NavWorld
});

const setup = () => {
  const world = createWorld();
  const stats: TerrainStats = {
    applyMs: 0, busy: false, edits: 0, error: "", previewMs: 0, rebuildMs: 0, staleResults: 0
  };
  const applyRegion = vi.fn();
  const setNav = vi.fn();
  const refreshHomes = vi.fn();
  const make = (
    editRegion: (request: RegionRebuildRequest) => Promise<RegionRebuild>,
    editedNav: (
      rocks: Parameters<TerrainToolOptions["builders"]["editedNav"]>[0],
      revision?: TaggedEditResult<NavWorld>["revision"]
    ) => Promise<TaggedEditResult<NavWorld>>
  ) => createTerrainRebuildQueue({
    animals: { setNav },
    builders: { editRegion, editedNav, keepEditWorkers: vi.fn() },
    mapEdit: { applyRegion, surfaceModes: ["terrain"] },
    refreshHomes,
    relocate: vi.fn(),
    world
  } as unknown as TerrainToolOptions, stats, vi.fn());
  return { applyRegion, make, refreshHomes, setNav, stats, world };
};

describe("terrain rebuild revisions", () => {
  it("releases a region result computed before a newer edit and rebuilds both areas", async () => {
    const { applyRegion, make, setNav, stats, world } = setup();
    const first = deferred<RegionRebuild>();
    const second = deferred<RegionRebuild>();
    const editRegion = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const editedNav = vi.fn((_rocks, revision) => Promise.resolve(navResult(revision!)));
    const queue = make(editRegion, editedNav);

    queue.addTerrain(AREA, false);
    const done = queue.rebuild();
    await vi.waitFor(() => expect(editRegion).toHaveBeenCalledTimes(1));
    const firstRequest = editRegion.mock.calls[0]![0] as RegionRebuildRequest;
    expect(firstRequest.cells).toEqual(AREA);
    expect(firstRequest.revision).toEqual({ build: 1, props: 0, terrain: 1 });

    world.terrainRevision = 3;
    world.buildRevision = 2;
    queue.addTerrain(OTHER, false);
    first.resolve(regionResult(firstRequest, world));

    await vi.waitFor(() => expect(editRegion).toHaveBeenCalledTimes(2));
    expect(applyRegion).not.toHaveBeenCalled();
    expect(stats.staleResults).toBe(1);
    const secondRequest = editRegion.mock.calls[1]![0] as RegionRebuildRequest;
    expect(secondRequest.cells).toEqual(unionRegions(AREA, OTHER));
    expect(secondRequest.revision).toEqual(getEditRevision(world));
    expect(new Set(secondRequest.chunks.map(({ chunkX, chunkZ }) => `${chunkX},${chunkZ}`)))
      .toEqual(new Set(listRegionChunks(world, unionRegions(AREA, OTHER))
        .map(({ chunkX, chunkZ }) => `${chunkX},${chunkZ}`)));

    const fresh = regionResult(secondRequest, world);
    second.resolve(fresh);
    await done;
    expect(applyRegion).toHaveBeenCalledTimes(1);
    expect(applyRegion).toHaveBeenCalledWith(fresh);
    expect(setNav).toHaveBeenCalledTimes(1);
  });

  it("releases a navigation result computed before a newer edit instead of setting it", async () => {
    const { applyRegion, make, refreshHomes, setNav, stats, world } = setup();
    const regionBuild = deferred<RegionRebuild>();
    const firstNav = deferred<TaggedEditResult<NavWorld>>();
    const secondNav = deferred<TaggedEditResult<NavWorld>>();
    const editRegion = vi.fn((_request: RegionRebuildRequest) => regionBuild.promise);
    const editedNav = vi.fn()
      .mockImplementationOnce(() => firstNav.promise)
      .mockImplementationOnce(() => secondNav.promise);
    const queue = make(editRegion, editedNav);

    queue.addTerrain(AREA, false);
    const done = queue.rebuild();
    await vi.waitFor(() => expect(editRegion).toHaveBeenCalledTimes(1));
    const request = editRegion.mock.calls[0]![0] as RegionRebuildRequest;
    regionBuild.resolve(regionResult(request, world));
    await vi.waitFor(() => expect(applyRegion).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(editedNav).toHaveBeenCalledTimes(1));

    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    const staleRevision = editedNav.mock.calls[0]![1] as TaggedEditResult<NavWorld>["revision"];
    firstNav.resolve(navResult(staleRevision));

    await vi.waitFor(() => expect(editedNav).toHaveBeenCalledTimes(2));
    expect(setNav).not.toHaveBeenCalled();
    expect(stats.staleResults).toBe(1);
    const currentRevision = editedNav.mock.calls[1]![1] as TaggedEditResult<NavWorld>["revision"];
    expect(currentRevision).toEqual(getEditRevision(world));
    expect(currentRevision).not.toEqual(staleRevision);

    secondNav.resolve(navResult(currentRevision));
    await done;
    expect(setNav).toHaveBeenCalledTimes(1);
    expect(editRegion).toHaveBeenCalledTimes(1);
    expect(refreshHomes).toHaveBeenLastCalledWith(AREA);
  });

  it("releases a payload that was dispatched after the queued revision moved on", async () => {
    const { applyRegion, make, stats, world } = setup();
    let first = true;
    const editRegion = vi.fn(async (request: RegionRebuildRequest) => {
      if (first) {
        first = false;
        // A delayed pool dispatch clones the live world after the request was queued.
        world.terrainRevision = (world.terrainRevision ?? 0) + 1;
        world.buildRevision = (world.buildRevision ?? 0) + 1;
        return regionResult({ ...request, revision: getEditRevision(world) }, world);
      }
      return regionResult(request, world);
    });
    const editedNav = vi.fn((_rocks, revision) => Promise.resolve(navResult(revision!)));
    const queue = make(editRegion, editedNav);

    queue.addTerrain(AREA, false);
    await queue.rebuild();

    expect(stats.staleResults).toBe(1);
    expect(editRegion).toHaveBeenCalledTimes(2);
    expect(applyRegion).toHaveBeenCalledTimes(1);
  });

  it("coalesces edits queued while a rebuild runs into one next payload", async () => {
    const { applyRegion, make, stats, world } = setup();
    const first = deferred<RegionRebuild>();
    const second = deferred<RegionRebuild>();
    const editRegion = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const editedNav = vi.fn((_rocks, revision) => Promise.resolve(navResult(revision!)));
    const queue = make(editRegion, editedNav);

    queue.addTerrain(AREA, false);
    const done = queue.rebuild();
    await vi.waitFor(() => expect(editRegion).toHaveBeenCalledTimes(1));
    const firstRequest = editRegion.mock.calls[0]![0] as RegionRebuildRequest;

    queue.addTerrain(OTHER, false);
    queue.addTerrain(THIRD, false);
    queue.addTerrain(THIRD, true);
    first.resolve(regionResult(firstRequest, world));

    await vi.waitFor(() => expect(editRegion).toHaveBeenCalledTimes(2));
    const secondRequest = editRegion.mock.calls[1]![0] as RegionRebuildRequest;
    expect(secondRequest.cells).toEqual(unionRegions(OTHER, THIRD));
    expect(secondRequest.chunks).toEqual(listRegionChunks(world, unionRegions(OTHER, THIRD)));
    expect(secondRequest.waterField).toBe(true);
    expect(stats.staleResults).toBe(0);

    second.resolve(regionResult(secondRequest, world));
    await done;
    expect(applyRegion).toHaveBeenCalledTimes(2);
    expect(editRegion).toHaveBeenCalledTimes(2);
  });
});
