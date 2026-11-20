import { beforeEach, describe, expect, it } from "vitest";

import {
  bytesToBase64, compactIsland, expandIsland, type MapBase, type MapBases
} from "../../island-of-settlers-shared/src/save-map-delta";
import { type CapturedGame, persistCapturedGame } from "../src/app/save-store/captured-game";
import type { GameDatabase } from "../src/app/settlement/game-database";
import { splitGameSave } from "../src/shared/settlement/game-save-rows";
import { packSparseCells } from "../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { levelBuildingFoundation } from "../src/shared/settlement/settlement-foundation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { appendProp } from "../src/shared/world/editing/prop-set";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import { MAP_LAYERS } from "../src/shared/world/save/map-layers";
import { compressMapParts, writeMapFile, writeMapParts } from "../src/shared/world/save/map-writer";
import {
  bumpBuildRevision, invalidateAllWorldMirrors, markWorldChanged, markWorldChangedAll
} from "../src/shared/world/save/world-change-journal";
import {
  applyWorldPatch, captureWorldPatch, clearWorldMirrors, MIRROR_OUT_OF_SYNC, VERIFY_EVERY
} from "../src/shared/world/save/world-patch";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { createSyntheticDenseWorld } from "./helpers/synthetic-dense-world";

const input = { animals: [], name: "patch", savedAt: 5, source: "test" };

const createWorld = () => {
  const world = createSyntheticDenseWorld({ cells: 96, seed: 3, treeSpacing: 2 });
  // The writers read these derived layers; the synthetic world only needs them to exist.
  world.buildCap.fill(3);
  return world;
};

const sameBytes = (first: Uint8Array, second: Uint8Array) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

/** The mirrored world writes exactly the map parts the live world writes. */
const expectMirrorMatches = (live: WorldData, mirror: WorldData) => {
  for (const spec of MAP_LAYERS) {
    const left = spec.get(live), right = spec.get(mirror);
    expect(Boolean(left), spec.name).toBe(Boolean(right));
    if (!left || !right) continue;
    expect(left.length, spec.name).toBe(right.length);
    expect(Array.from(left as ArrayLike<number>).every((value, index) => Object.is(value, right[index])),
      spec.name).toBe(true);
  }
  const expected = writeMapParts(live, input), actual = writeMapParts(mirror, input);
  expect(sameBytes(actual.header, expected.header)).toBe(true);
  expect([...actual.chunks.keys()]).toEqual([...expected.chunks.keys()]);
  for (const [name, bytes] of expected.chunks) expect(sameBytes(actual.chunks.get(name)!, bytes), name).toBe(true);
};

const send = (world: WorldData, options?: { forceKeyframe?: boolean }) => {
  const captured = captureWorldPatch(world, options)!;
  // The wire: transferred buffers survive a structured clone.
  const wire = structuredClone(captured.patch);
  return { applied: applyWorldPatch(wire), captured };
};

beforeEach(() => {
  clearWorldMirrors();
});

describe("world patch capture and mirror", () => {
  it("starts with a keyframe that mirrors the whole world", () => {
    const world = createWorld();
    const { applied, captured } = send(world);
    expect(captured.keyframeReason).toBe("first");
    expectMirrorMatches(world, applied.world);
  });

  it("sends only the dirty chunks of an explained edit", () => {
    const world = createWorld();
    send(world);
    for (let vertex = 0; vertex < 40; vertex++) world.heights[40 * 97 + 30 + vertex % 3] = 5 + vertex;
    world.walkCost[40 * 96 + 31] = 77;
    markWorldChanged(world, { maxX: 33, maxZ: 40, minX: 30, minZ: 40 });
    const { applied, captured } = send(world);
    expect(captured.keyframeReason).toBeUndefined();
    expect(captured.patch.chunks!.length).toBe(2);
    const bytes = captured.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    expect(bytes).toBeLessThan(400_000);
    expectMirrorMatches(world, applied.world);
  });

  it("follows removed and appended props", () => {
    const world = createWorld();
    send(world);
    const gone = [0, 1, 2, 30].filter(index => index < world.props.count);
    removePropsAt(world, gone);
    const index = appendProp(world.props, { form: 2, phase: 1, rotation: 2, scale: 3, type: PROP.bush,
      x: 10.5, y: 4, z: 11.5 });
    bumpBuildRevision(world, { maxX: 10, maxZ: 11, minX: 10, minZ: 11 });
    const { applied, captured } = send(world);
    expect(captured.keyframeReason).toBeUndefined();
    expect(applied.world.props.count).toBe(world.props.count);
    expect(applied.world.props.types[gone[0]!]).toBe(PROP_REMOVED);
    expect(applied.world.props.x[index]).toBe(10.5);
    expectMirrorMatches(world, applied.world);
  });

  it("follows a real foundation levelling", () => {
    const world = createWorld();
    send(world);
    const building = { depth: 3, width: 3, x: 50.5, y: 3.4, z: 60.5 } as unknown as SettlementBuilding;
    expect(levelBuildingFoundation(world, building, [])).not.toBeNull();
    const { applied, captured } = send(world);
    expect(captured.keyframeReason).toBeUndefined();
    expectMirrorMatches(world, applied.world);
  });

  it("sends a replaced layer whole", () => {
    const world = createWorld();
    send(world);
    world.clearedStoneGround = new Uint8Array(96 * 96).fill(1);
    const { applied, captured } = send(world);
    expect(captured.patch.full).toEqual(["clearedStoneGround"]);
    expectMirrorMatches(world, applied.world);
    world.clearedStoneGround = undefined;
    const dropped = send(world);
    expect(dropped.captured.patch.absent).toEqual(["clearedStoneGround"]);
    expectMirrorMatches(world, dropped.applied.world);
  });

  it("falls back to a full copy for a change it cannot explain", () => {
    const world = createWorld();
    send(world);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    world.heights[100] = 9;
    const direct = send(world);
    expect(direct.captured.keyframeReason).toBe("revision");
    expectMirrorMatches(world, direct.applied.world);
    world.heights[200] = 9;
    markWorldChangedAll(world);
    const all = send(world);
    expect(all.captured.keyframeReason).toBe("unexplained");
    expectMirrorMatches(world, all.applied.world);
    world.props.count = world.props.count - 5;
    const shrunk = send(world);
    expect(shrunk.captured.keyframeReason).toBe("props-shrunk");
  });

  it("sends a keyframe after the worker mirror was lost, and refuses a patch that does not follow", () => {
    const world = createWorld();
    send(world);
    invalidateAllWorldMirrors();
    clearWorldMirrors();
    markWorldChanged(world, { maxX: 1, maxZ: 1, minX: 0, minZ: 0 });
    const recovered = send(world);
    expect(recovered.captured.keyframeReason).toBe("worker-lost");
    expectMirrorMatches(world, recovered.applied.world);
    markWorldChanged(world, { maxX: 1, maxZ: 1, minX: 0, minZ: 0 });
    const captured = captureWorldPatch(world)!;
    clearWorldMirrors();
    expect(() => applyWorldPatch(captured.patch)).toThrow(MIRROR_OUT_OF_SYNC);
  });

  it("repairs the mirror when the periodic self check finds a missed edit", () => {
    const world = createWorld();
    send(world);
    let healed: string[] = [];
    for (let save = 2; save <= VERIFY_EVERY; save++) {
      // An unmarked edit: the writer forgot to tell the journal.
      if (save === 4) world.walkCost[90 * 96 + 90] = 99;
      markWorldChanged(world, { maxX: 1, maxZ: 1, minX: 0, minZ: 0 });
      const { applied } = send(world);
      healed = [...healed, ...applied.healed];
      if (save === VERIFY_EVERY) expectMirrorMatches(world, applied.world);
    }
    expect(healed).toEqual(["walkCost"]);
  });
});

describe("live map delta", () => {
  const createBases = () => {
    const keys = new Map<string, MapBase>(), byHash = new Map<string, string>();
    const bases: MapBases = {
      find: async key => keys.get(key) ?? null,
      read: async hash => byHash.get(hash) ?? null,
      write: async (key, base) => { keys.set(key, base); byHash.set(base.hash, base.map); }
    };
    return { bases, keys };
  };
  const island = (map: string, world: WorldData) => ({ format: "island-settlers-game", map,
    settlement: { world: { cellsX: world.cellsX, cellsZ: world.cellsZ, seed: world.seed } } });

  it("stores the same delta as the full map file and restores the exact map bytes", async () => {
    const world = createWorld();
    const { bases } = createBases();
    const baseMap = bytesToBase64(await writeMapFile(world, input, { codec: "gzip" }));
    await compactIsland(island(baseMap, world), "home", bases);
    removePropsAt(world, [3, 4]);
    world.heights[777] = world.heights[777]! + 1;
    const full = bytesToBase64(await writeMapFile(world, input, { codec: "gzip" }));
    const expected = await compactIsland(island(full, world), "home", bases);
    const parts = writeMapParts(world, input);
    const live = { file: async () => bytesToBase64(await compressMapParts(parts)), parts };
    const actual = await compactIsland(island("", world), "home", bases, live);
    expect(actual.saveEncoding).toEqual(expected.saveEncoding);
    const restored = await expandIsland(actual, bases);
    const restoredFromFull = await expandIsland(expected, bases);
    expect(restored.map).toBe(restoredFromFull.map);
  });

  it("writes the base from the parts when the slot has none", async () => {
    const world = createWorld();
    const { bases, keys } = createBases();
    const parts = writeMapParts(world, input);
    const live = { file: async () => bytesToBase64(await compressMapParts(parts, { codec: "gzip" })), parts };
    const compact = await compactIsland(island("", world), "home", bases, live);
    expect(keys.size).toBe(1);
    expect(compact.map).toBe("");
    expect(compact.saveEncoding).toBeDefined();
  });
});

describe("persisting a patched capture", () => {
  const settlementOf = (world: WorldData) => ({
    format: "island-settlers-settlement", version: 4,
    occupied: packSparseCells(new Uint8Array(world.cellsX * world.cellsZ)),
    world: { cellsX: world.cellsX, cellsZ: world.cellsZ, seed: world.seed }
  }) as unknown as SettlementSaveV1;

  const createStore = () => {
    const keys = new Map<string, MapBase>(), byHash = new Map<string, string>();
    const bases: MapBases = {
      find: async key => keys.get(key) ?? null,
      read: async hash => byHash.get(hash) ?? null,
      write: async (key, base) => { keys.set(key, base); byHash.set(base.hash, base.map); }
    };
    const rows: Record<string, unknown>[] = [];
    const database: Pick<GameDatabase, "backend" | "mapBases" | "writeGame"> = {
      backend: "indexeddb", mapBases: () => bases,
      writeGame: async (_slot, save, options) => {
        rows.length = 0;
        for (const island of splitGameSave(save).islands)
          rows.push(await compactIsland(island.save as unknown as Record<string, unknown>, island.id, bases,
            options?.live?.[island.id]));
      }
    };
    return { database, rows };
  };

  const captureOf = (world: WorldData, patched: boolean): CapturedGame => {
    const base = { save: [world, settlementOf(world), input, undefined] } as CapturedGame;
    if (!patched) return base;
    const { patch } = captureWorldPatch(world)!;
    return { ...base, save: [null as unknown as WorldData, base.save[1], input, undefined],
      worldPatch: structuredClone(patch) };
  };

  it("stores the same rows as a capture of the live world, across saves", async () => {
    const world = createWorld();
    const live = createStore(), patched = createStore();
    const target = { kind: "local", slotId: "guest" } as const;
    for (let save = 0; save < 3; save++) {
      if (save > 0) {
        removePropsAt(world, [save, save + 10]);
        world.heights[300 + save] = world.heights[300 + save]! + 0.5;
        markWorldChanged(world, { maxX: 3, maxZ: 3, minX: 0, minZ: 0 });
      }
      await persistCapturedGame(captureOf(world, false), target, live.database);
      await persistCapturedGame(captureOf(world, true), target, patched.database);
      expect(patched.rows.map(row => row.saveEncoding)).toEqual(live.rows.map(row => row.saveEncoding));
      expect(patched.rows[0]!.map).toBe("");
    }
  });
});
