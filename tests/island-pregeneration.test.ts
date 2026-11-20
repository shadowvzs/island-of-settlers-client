import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createIslandPregeneration as CreateIslandPregeneration } from "../src/app/island-pregeneration";
import type * as IslandWorldPreparation from "../src/app/island-world-preparation";
import type { prefetchVoyageAssets as PrefetchVoyageAssets } from "../src/app/voyage-asset-prefetch";
import { enemyNationFor } from "../src/shared/settlement/enemy-nation";

vi.mock("../src/app/voyage-asset-prefetch", () => ({ prefetchVoyageAssets: vi.fn(async () => true) }));

let createIslandPregeneration: typeof CreateIslandPregeneration;
let prefetchVoyageAssets: typeof PrefetchVoyageAssets;
let prepareIslandWorld: typeof IslandWorldPreparation.prepareIslandWorld;
let toIslandCacheGroup: typeof IslandWorldPreparation.toIslandCacheGroup;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mocks,
// then drop the mocks and the mocked graph so later files of the worker get the real modules.
beforeAll(async () => {
  vi.resetModules();
  ({ prefetchVoyageAssets } = await import("../src/app/voyage-asset-prefetch"));
  ({ createIslandPregeneration } = await import("../src/app/island-pregeneration"));
  ({ prepareIslandWorld, toIslandCacheGroup } = await import("../src/app/island-world-preparation"));
});
afterAll(() => {
  vi.doUnmock("../src/app/voyage-asset-prefetch");
  vi.resetModules();
});
beforeEach(() => vi.clearAllMocks());

import type { AppParams } from "../src/app/app-params";
import { toIslandBuildGroup } from "../src/app/island-build-keys";
import type { WorkerPool } from "../src/app/worker-pool";
import type { SharedContentBuilders } from "../src/render-common/content-builders";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import type { ColonyExpeditionSnapshot } from "../src/shared/settlement/settlement-colony-expeditions";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const expedition = { id: 4, island: { id: 1, seed: 123, difficulty: "easy" }, status: "sailing" } as ColonyExpeditionSnapshot;
const fixture = () => {
  const world = { seed: 456, fog: new Uint8Array(4), mineZones: [{ surveyed: false }] } as WorldData;
  const params = { cache: true, garden: false, island: "large", seed: 9 } as unknown as AppParams;
  const chartIsland = vi.fn(async () => world);
  const slots: { group: string; key: string }[] = [];
  const pool = { chartIsland, runPacked: vi.fn(async slot => { slots.push(slot); return []; }), runCached: vi.fn(async (slot, request) => {
    slots.push(slot);
    if (request.kind === "rockBodies") return { chunks: [], placed: [] };
    return [];
  }) } as unknown as WorkerPool;
  const warmer = createIslandPregeneration({ builders: {} as SharedContentBuilders, fog: false,
    nation: "roman", params, pool, quality: QUALITY_PRESETS.minimal, revealOre: true });
  return { chartIsland, params, slots, warmer, world };
};
const flush = async () => { for (let step = 0; step < 20; step++) await Promise.resolve(); };

describe("voyage island warming", () => {
  it("warms the arrival group once, including navigation, using arrival's world preparation", async () => {
    const { chartIsland, params, slots, warmer, world } = fixture();
    warmer.update([expedition]);
    await flush();
    warmer.update([expedition]);
    await flush();
    // The colony key names its resource tier (060b5c0), "legacy" for an untiered offer.
    const group = toIslandCacheGroup(params, false, true, "colony:123:4:mine-sites-v1:resource-tier-legacy");
    expect(chartIsland).toHaveBeenCalledExactlyOnceWith(expedition.island, group);
    expect(slots.every(slot => slot.group === toIslandBuildGroup(world))).toBe(true);
    expect(slots.map(slot => slot.key)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^rock bodies /),
      expect.stringMatching(/^terrain terrain 0 2 /),
      expect.stringMatching(/^terrain water 0 2 /),
      expect.stringMatching(/^water field /),
      expect.stringMatching(/^animal nav /)
    ]));
    // Minimal draws the cheap two-sample field cover, so arrival and voyage warming both build it.
    expect(slots.some(slot => slot.key.startsWith("field cover"))).toBe(true);
    const arrival = { seed: 456, fog: new Uint8Array(4), mineZones: [{ surveyed: false }] } as WorldData;
    prepareIslandWorld(arrival, params, false, true, "roman");
    expect(world).toEqual(arrival);
    // Fog off is a presentation-only override (owner 2026-10-18): exploration bytes stay as saved.
    expect(world.fogDisplayDisabled).toBe(true);
    expect(world.fog.every(value => value === FOG.hidden)).toBe(true);
  });

  it("uses the adventure arrival key and never overlaps two expedition builds", async () => {
    const { chartIsland, params, warmer } = fixture();
    const adventure = { ...expedition, id: 5,
      island: { ...expedition.island, kind: "adventure", size: 96 } } as ColonyExpeditionSnapshot;
    warmer.update([expedition, adventure]);
    warmer.update([expedition, adventure]);
    expect(chartIsland).toHaveBeenCalledTimes(1);
    await flush();
    warmer.update([expedition, adventure]);
    await flush();
    expect(chartIsland).toHaveBeenCalledTimes(2);
    expect(chartIsland).toHaveBeenLastCalledWith(adventure.island,
      toIslandCacheGroup(params, false, true, "adventure:123:5"));
  });

  it("skips visited islands and stops before builds when an expedition is cancelled", async () => {
    const { chartIsland, slots, warmer } = fixture();
    warmer.update([expedition], [{ expeditionId: 4 }]);
    expect(chartIsland).not.toHaveBeenCalled();
    warmer.update([expedition], [{ expeditionId: 4, landing: {} }]);
    warmer.update([]);
    await flush();
    expect(chartIsland).toHaveBeenCalledOnce();
    expect(slots).toEqual([]);
  });

  it("suspends and disposes without starting new expedition work", async () => {
    const { chartIsland, warmer } = fixture();
    warmer.update([expedition]);
    await flush();
    expect(chartIsland).toHaveBeenCalledOnce();
    const next = { ...expedition, id: 6,
      island: { ...expedition.island, seed: 999 } } as ColonyExpeditionSnapshot;
    warmer.suspend();
    warmer.update([expedition, next]);
    await flush();
    expect(chartIsland).toHaveBeenCalledOnce();
    const prefetchCount = vi.mocked(prefetchVoyageAssets).mock.calls.length;
    warmer.dispose();
    warmer.update([next]);
    await flush();
    expect(chartIsland).toHaveBeenCalledOnce();
    expect(prefetchVoyageAssets).toHaveBeenCalledTimes(prefetchCount);
  });

  it("warms the actual charted enemy nation and deduplicates it across visits", async () => {
    const { warmer, world } = fixture();
    warmer.update([expedition]);
    await flush();
    warmer.update([expedition]);
    await flush();
    expect(prefetchVoyageAssets).toHaveBeenLastCalledWith("roman", false,
      expect.any(Function), enemyNationFor("roman", world.seed));
    const count = vi.mocked(prefetchVoyageAssets).mock.calls.length;
    warmer.update([expedition]);
    await flush();
    expect(prefetchVoyageAssets).toHaveBeenCalledTimes(count);
  });

  it("charts the enemy nation with cache disabled without warming island build jobs", async () => {
    const { chartIsland, params, slots, warmer, world } = fixture();
    params.cache = false;
    warmer.update([expedition]);
    await flush();
    warmer.update([expedition]);
    await flush();
    expect(chartIsland).toHaveBeenCalledOnce();
    expect(slots).toEqual([]);
    expect(prefetchVoyageAssets).toHaveBeenLastCalledWith("roman", false,
      expect.any(Function), enemyNationFor("roman", world.seed));
  });

  it("warms a second expedition's different enemy without downloading unrelated nations", async () => {
    const { chartIsland, warmer, world } = fixture();
    const firstEnemy = enemyNationFor("roman", world.seed);
    const nextSeed = Array.from({ length: 32 }, (_, index) => index)
      .find(seed => enemyNationFor("roman", seed) !== firstEnemy)!;
    chartIsland.mockResolvedValueOnce(world).mockResolvedValueOnce({ ...world, seed: nextSeed });
    const second = { ...expedition, id: 5 };
    for (let turn = 0; turn < 4; turn++) {
      warmer.update([expedition, second]);
      await flush();
    }
    expect(vi.mocked(prefetchVoyageAssets).mock.calls.map(call => call[3])).toEqual([
      undefined, firstEnemy, enemyNationFor("roman", nextSeed)
    ]);
  });
});
