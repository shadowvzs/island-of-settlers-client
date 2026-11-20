import { describe, expect, it, vi } from "vitest";

import {
  DestinationPreparationCancelled,
  matchesImportedDestination,
  matchesMapDestination,
  matchesNewDestination,
  matchesSavedDestination,
  matchesVisitDestination,
  prepareImportedDestination,
  prepareMapDestination,
  prepareNewDestination,
  prepareSavedDestination,
  prepareVisitDestination
} from "../src/app/island-destination";
import type { IslandBuilders } from "../src/app/pool-builders";
import type { ColonyArrival } from "../src/app/settlement/colony-boot";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import type { ColonyVisitRequest } from "../src/shared/settlement/archipelago";
import type { GameSaveV1, LoadedGameSave } from "../src/shared/settlement/game-save";
import type { WorldData } from "../src/shared/world/world-data";

const save = (savedAt = 1_000) => ({ format: "island-settlers-game", savedAt, version: 4 } as GameSaveV1);
const world = { cellsX: 96, cellsZ: 96, expeditionKind: undefined, seed: 123 } as WorldData;
const loaded = { map: { world } } as LoadedGameSave;
const builders = {} as IslandBuilders;
const options = (deps: Parameters<typeof prepareSavedDestination>[0]["deps"] = {}) => ({
  builders: {} as never,
  deps,
  fog: false,
  nation: "roman" as const,
  params: { cache: true, garden: false, island: "large", seed: 123 } as never,
  pool: {} as never,
  quality: QUALITY_PRESETS.high,
  revealOre: false,
  save: save(),
  targetKey: "home"
});

describe("saved destination preparation", () => {
  it("uses the session clock even when the device clock is far ahead", async () => {
    const deviceTime = vi.spyOn(Date, "now").mockReturnValue(99_000_000);
    const catchUp = vi.fn(async (_save: GameSaveV1, at: number) => save(at));
    try {
      const prepared = await prepareSavedDestination({
        ...options({ catchUp, prepareWorld: async () => ({ builders, world }), stage: async () => loaded }),
        sessionClock: () => 2_000
      });
      expect(catchUp.mock.calls[0]![1]).toBe(2_000);
      expect(prepared.savedAt).toBe(2_000);
    } finally {
      deviceTime.mockRestore();
    }
  });

  it("catches up, stages, prepares the world and builds without touching a scene", async () => {
    const calls: string[] = [];
    const caughtUp = save(2_000);
    const result = await prepareSavedDestination(options({
      catchUp: vi.fn(async () => { calls.push("catch-up"); return caughtUp; }),
      now: () => 2_000,
      prepareWorld: vi.fn(async value => {
        expect(value).toBe(loaded);
        calls.push("world+builds");
        return { builders, world };
      }),
      stage: vi.fn(async value => { expect(value).toBe(caughtUp); calls.push("stage"); return loaded; })
    }));
    expect(calls).toEqual(["catch-up", "stage", "world+builds"]);
    expect(result).toMatchObject({
      builders,
      identity: { expeditionKind: null, seed: 123, targetKey: "home" },
      loaded,
      save: caughtUp,
      savedAt: 2_000,
      world
    });
  });

  it("skips catch-up when the save is already at or after the current time", async () => {
    const catchUp = vi.fn();
    const result = await prepareSavedDestination(options({
      catchUp,
      now: () => 500,
      prepareWorld: async () => ({ builders, world }),
      stage: async () => loaded
    }));
    expect(catchUp).not.toHaveBeenCalled();
    expect(result.savedAt).toBe(1_000);
  });

  it("stops before further work when the handoff is cancelled", async () => {
    let current = true;
    const prepareWorld = vi.fn(async () => ({ builders, world }));
    const staging = prepareSavedDestination({
      ...options({
        catchUp: async () => save(2_000),
        now: () => 2_000,
        prepareWorld,
        stage: async () => { current = false; return loaded; }
      }),
      isCurrent: () => current
    });
    await expect(staging).rejects.toBeInstanceOf(DestinationPreparationCancelled);
    expect(prepareWorld).not.toHaveBeenCalled();
  });

  it("reports phases and matches only the requested saved destination", async () => {
    const phases: string[] = [];
    const prepared = await prepareSavedDestination({
      ...options({
        catchUp: async () => save(2_000),
        now: () => 2_000,
        prepareWorld: async () => ({ builders, world }),
        stage: async () => loaded
      }),
      onProgress: phase => phases.push(phase)
    });
    expect(phases).toEqual(["catch-up", "stage", "world", "builds"]);
    expect(matchesSavedDestination(prepared, { kind: "saved", targetKey: "home" })).toBe(true);
    expect(matchesSavedDestination(prepared, { kind: "saved", targetKey: "colony:1" })).toBe(false);
    expect(matchesSavedDestination(prepared, { kind: "visit", targetKey: "home" })).toBe(false);
  });
});

describe("visit destination preparation", () => {
  const visit = {
    archipelago: { active: 7 },
    player: {},
    settlement: {}
  } as unknown as ColonyVisitRequest;
  const visitWorld = { ...world, expeditionKind: "colony" } as WorldData;
  const arrival = {
    mapKey: "colony:456:7",
    record: { expeditionId: 7, island: { kind: "colony", seed: 456 } },
    world: visitWorld
  } as unknown as ColonyArrival;

  const visitOptions = (deps: Parameters<typeof prepareVisitDestination>[0]["deps"] = {}) => ({
    builders: {} as never,
    deps,
    fog: false,
    nation: "roman" as const,
    params: { cache: true, garden: false, island: "large", seed: 123 } as never,
    pool: { chartIsland: vi.fn() } as never,
    quality: QUALITY_PRESETS.high,
    revealOre: false,
    targetKey: "colony:7",
    visit
  });

  it("charts, prepares and builds a visit without touching the active island", async () => {
    const calls: string[] = [];
    const prepared = await prepareVisitDestination(visitOptions({
      plan: vi.fn(async () => { calls.push("chart"); return arrival; }),
      prepareWorld: vi.fn(async value => {
        expect(value).toBe(visitWorld);
        calls.push("world+builds");
        return builders;
      })
    }));
    expect(calls).toEqual(["chart", "world+builds"]);
    expect(prepared).toMatchObject({
      arrival,
      builders,
      identity: { expeditionKind: "colony", seed: 456, targetKey: "colony:7" },
      targetKey: "colony:7",
      world: visitWorld
    });
  });

  it("uses the island cache group for the chart and stops after cancellation", async () => {
    const chartIsland = vi.fn(async (_island: unknown, _group: string) => visitWorld);
    let current = true;
    const prepareWorld = vi.fn(async () => builders);
    const staging = prepareVisitDestination({
      ...visitOptions({
        plan: async (_visit, chart) => {
          await chart(arrival.record.island, "colony:456:7");
          current = false;
          return arrival;
        },
        prepareWorld
      }),
      isCurrent: () => current,
      pool: { chartIsland } as never
    });
    await expect(staging).rejects.toBeInstanceOf(DestinationPreparationCancelled);
    expect(chartIsland).toHaveBeenCalledOnce();
    expect(chartIsland.mock.calls[0]![1]).toContain('"map":"colony:456:7"');
    expect(prepareWorld).not.toHaveBeenCalled();
  });

  it("matches only the requested visit destination", async () => {
    const prepared = await prepareVisitDestination(visitOptions({
      plan: async () => arrival,
      prepareWorld: async () => builders
    }));
    expect(matchesVisitDestination(prepared, { kind: "visit", targetKey: "colony:7" })).toBe(true);
    expect(matchesVisitDestination(prepared, { kind: "visit", targetKey: "colony:8" })).toBe(false);
    expect(matchesVisitDestination(prepared, { kind: "saved", targetKey: "colony:7" })).toBe(false);
  });
});

describe("editor map destination preparation", () => {
  const mapOptions = (deps: Parameters<typeof prepareMapDestination>[0]["deps"] = {}) => ({
    builders: {} as never,
    deps,
    fog: false,
    nation: "roman" as const,
    params: { cache: true, garden: false, island: "large", seed: 123 } as never,
    pool: {} as never,
    quality: QUALITY_PRESETS.high,
    revealOre: false,
    slotId: "scenario-play",
    targetKey: "map:scenario-play"
  });

  it("reads the slot, prepares its world/builds and matches the slot", async () => {
    const loadedMap = { world } as never;
    const prepareWorld = vi.fn(async () => builders);
    const read = vi.fn(async () => ({ error: "", loaded: loadedMap }));
    const prepared = await prepareMapDestination(mapOptions({ prepareWorld, read }));
    expect(read).toHaveBeenCalledWith("scenario-play");
    expect(prepareWorld).toHaveBeenCalledWith(world);
    expect(prepared).toMatchObject({ builders, loaded: loadedMap, targetKey: "map:scenario-play", world });
    expect(matchesMapDestination(prepared, { kind: "map", targetKey: "map:scenario-play" })).toBe(true);
    expect(matchesMapDestination(prepared, { kind: "map", targetKey: "map:other" })).toBe(false);
  });

  it("rejects a missing or unreadable slot before preparing a world", async () => {
    const prepareWorld = vi.fn(async () => builders);
    await expect(prepareMapDestination(mapOptions({
      prepareWorld,
      read: async () => ({ error: "The map is gone", loaded: null })
    }))).rejects.toThrow("The map is gone");
    expect(prepareWorld).not.toHaveBeenCalled();
  });

  it("stops before preparing a world when the handoff is cancelled", async () => {
    let current = true;
    const prepareWorld = vi.fn(async () => builders);
    const staging = prepareMapDestination({
      ...mapOptions({
        prepareWorld,
        read: async () => {
          current = false;
          return { error: "", loaded: { world } as never };
        }
      }),
      isCurrent: () => current
    });
    await expect(staging).rejects.toBeInstanceOf(DestinationPreparationCancelled);
    expect(prepareWorld).not.toHaveBeenCalled();
  });

  it("rejects a stale map target after preparing its world", async () => {
    let current = true;
    const prepareWorld = vi.fn(async () => { current = false; return builders; });
    const staging = prepareMapDestination({
      ...mapOptions({
        prepareWorld,
        read: async () => ({ error: "", loaded: { world } as never })
      }),
      isCurrent: () => current
    });
    await expect(staging).rejects.toBeInstanceOf(DestinationPreparationCancelled);
    expect(prepareWorld).toHaveBeenCalledOnce();
  });
});

describe("fresh and imported destination preparation", () => {
  const common = () => ({
    builders: {} as never,
    fog: false,
    nation: "roman" as const,
    params: { cache: true, garden: false, island: "large", seed: 123 } as never,
    pool: { generateWorld: vi.fn(async () => world) } as never,
    quality: QUALITY_PRESETS.high,
    revealOre: false
  });

  it("generates a fresh island in its own cache group and prepares its builds", async () => {
    const generate = vi.fn(async (_options: unknown, _group: string) => world);
    const prepareWorld = vi.fn(async () => builders);
    const prepared = await prepareNewDestination({
      ...common(),
      deps: { generate, prepareWorld },
      targetKey: "new:9",
      worldOptions: { seed: 123 } as never
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]![1]).toContain('"map":"new:9"');
    expect(prepareWorld).toHaveBeenCalledWith(world);
    expect(prepared).toMatchObject({
      builders,
      identity: { expeditionKind: null, seed: 123, targetKey: "new:9" },
      targetKey: "new:9",
      world
    });
    expect(matchesNewDestination(prepared, { kind: "new", targetKey: "new:9" })).toBe(true);
    expect(matchesNewDestination(prepared, { kind: "saved", targetKey: "new:9" })).toBe(false);
  });

  it("stops before preparing a world when generation is cancelled", async () => {
    let current = true;
    const generate = vi.fn(async () => { current = false; return world; });
    const prepareWorld = vi.fn(async () => builders);
    const staging = prepareNewDestination({
      ...common(),
      deps: { generate, prepareWorld },
      isCurrent: () => current,
      targetKey: "new:9",
      worldOptions: { seed: 123 } as never
    });
    await expect(staging).rejects.toBeInstanceOf(DestinationPreparationCancelled);
    expect(generate).toHaveBeenCalledOnce();
    expect(prepareWorld).not.toHaveBeenCalled();
  });

  it("rejects a stale new target after preparing its world", async () => {
    let current = true;
    const prepareWorld = vi.fn(async () => { current = false; return builders; });
    const staging = prepareNewDestination({
      ...common(),
      deps: { generate: async () => world, prepareWorld },
      isCurrent: () => current,
      targetKey: "new:9",
      worldOptions: { seed: 123 } as never
    });
    await expect(staging).rejects.toBeInstanceOf(DestinationPreparationCancelled);
    expect(prepareWorld).toHaveBeenCalledOnce();
  });

  it("validates and prepares an imported game save", async () => {
    const base = options({
      catchUp: async value => value,
      now: () => 1_000,
      prepareWorld: async () => ({ builders, world }),
      stage: async () => loaded
    });
    const { save: _ignored, ...rest } = base;
    const prepared = await prepareImportedDestination({ ...rest, value: save() });
    expect(prepared).toMatchObject({ targetKey: "home", world });
    expect(matchesImportedDestination(prepared, { kind: "import", targetKey: "home" })).toBe(true);
    expect(matchesImportedDestination(prepared, { kind: "saved", targetKey: "home" })).toBe(false);
    await expect(prepareImportedDestination({ ...rest, value: { format: "map" } }))
      .rejects.toThrow("not an island-settlers game save");
  });
});
