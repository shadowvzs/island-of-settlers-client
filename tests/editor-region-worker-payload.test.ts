import { describe, expect, it, vi } from "vitest";

import { createPoolBuilders } from "../src/app/pool-builders";
import type { WorkerPool } from "../src/app/worker-pool";
import type { SharedContentBuilders } from "../src/render-common/content-builders";
import { getEditRevision } from "../src/render-common/map-edit/edit-revision";
import type { RegionRebuild } from "../src/render-common/map-edit/region-rebuild";
import type { NavWorld } from "../src/render-common/wildlife/nav/nav-query";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import type { WorkerRequest } from "../src/workers/world-worker";
import { cachedWorld } from "./helpers/cached-worlds";

const world = () => cachedWorld({
  ...DEFAULT_WORLD_OPTIONS, cellsX: 32, cellsZ: 32, erosionDroplets: 100, rivers: 0
});

/** A pool that runs each job as a canned tagged reply and records the payload. */
const createRecordingPool = () => {
  const jobs: WorkerRequest[] = [];
  const runUrgent = vi.fn(async (body: WorkerRequest) => {
    jobs.push(body);
    if (body.kind === "editRegion") {
      const revision = getEditRevision(body.world);
      return {
        cells: body.request.cells,
        chunks: [], placed: [], revision, rocks: [], waterField: null, waterWeeds: null
      } satisfies RegionRebuild;
    }
    if (body.kind === "editedNav") {
      return { revision: getEditRevision(body.world), value: {} as NavWorld };
    }
    throw new Error(`unexpected ${body.kind}`);
  });
  return { jobs, pool: { keepAlive: vi.fn(), runUrgent } as unknown as WorkerPool, runUrgent };
};

describe("editor region worker payloads", () => {
  it("schedules one main region job, with no empty skin jobs and a revision tag", async () => {
    const island = world();
    const { jobs, pool, runUrgent } = createRecordingPool();
    const builders = createPoolBuilders(pool, {} as SharedContentBuilders, island, "test island");
    const revision = getEditRevision(island);
    const request = {
      cells: { maxX: 7, maxZ: 7, minX: 0, minZ: 0 },
      chunks: [
        { chunkX: 0, chunkZ: 0 },
        { chunkX: 1, chunkZ: 0 },
        { chunkX: 0, chunkZ: 1 }
      ],
      modes: ["terrain"] as const,
      placed: [],
      revision,
      waterField: false
    };

    const result = await builders.editRegion({ ...request, modes: [...request.modes] });

    expect(runUrgent).toHaveBeenCalledTimes(1);
    const body = jobs[0]!;
    expect(body.kind).toBe("editRegion");
    if (body.kind !== "editRegion") throw new Error("expected an editRegion job");
    expect(body.part).toBe("main");
    expect(body.request.cells).toEqual(request.cells);
    expect(body.request.chunks).toHaveLength(3);
    expect(body.request.revision).toEqual(revision);
    expect(result.revision).toEqual(revision);
    expect(result.rocks).toEqual([]);
  });

  it("tags the edited navigation payload and result with the same revision", async () => {
    const island = world();
    const { jobs, pool, runUrgent } = createRecordingPool();
    const builders = createPoolBuilders(pool, {} as SharedContentBuilders, island, "test island");
    const revision = getEditRevision(island);

    const result = await builders.editedNav([], revision);

    expect(runUrgent).toHaveBeenCalledTimes(1);
    const body = jobs[0]!;
    expect(body.kind).toBe("editedNav");
    if (body.kind !== "editedNav") throw new Error("expected an editedNav job");
    expect(body.revision).toEqual(revision);
    expect(result.revision).toEqual(revision);
    expect(result.value).toEqual({});
  });
});
