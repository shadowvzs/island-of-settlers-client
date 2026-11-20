import { beforeAll, describe, expect, it } from "vitest";

import {
  compactIsland,
  expandIsland,
  type MapBase,
  type MapBases,
  mapHash
} from "../../island-of-settlers-shared/src/save-map-delta";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { packSparseCells } from "../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { type MapSaveInput, writeMapFile } from "../src/shared/world/save/map-writer";
import type { PropSet, WorldData } from "../src/shared/world/world-data";
import { createSyntheticDenseWorld } from "./helpers/synthetic-dense-world";

/**
 * A synthetic dense 1024 x 1024 island (about 500k props, owner D-S8: at most 600k, trees 1.2 cells
 * apart) through the whole save codec chain: map file, game save, storage compaction. Run it when
 * the codec changes (a ~100 MB world).
 */
const CELLS = 1024;
const MAP_INPUT: MapSaveInput = { animals: [], name: "dense", savedAt: 1, source: "synthetic" };
const COMPACT_UNCHANGED_LIMIT = 512 * 1024;
const COMPACT_ONE_PROP_GROWTH_LIMIT = 4 * 1024;

const settlementStub = () => ({ format: "island-settlers-settlement", version: 4,
  occupied: packSparseCells(new Uint8Array(CELLS * CELLS)), world: { cellsX: CELLS, cellsZ: CELLS, seed: 7 }
}) as unknown as SettlementSaveV1;

const growPropSet = (props: PropSet): PropSet => {
  const grow = <T extends Float32Array | Uint8Array>(array: T) => {
    const bigger = new (array.constructor as new (length: number) => T)(props.count + 1);
    bigger.set(array.subarray(0, props.count));
    return bigger;
  };
  const grown = { count: props.count + 1, form: grow(props.form), phase: grow(props.phase),
    rotation: grow(props.rotation), scale: grow(props.scale), types: grow(props.types), x: grow(props.x),
    y: grow(props.y), z: grow(props.z) };
  grown.x[props.count] = 100.5;
  grown.z[props.count] = 200.5;
  return grown;
};

const createBases = () => {
  const keys = new Map<string, MapBase>(), byHash = new Map<string, string>();
  const bases: MapBases = {
    find: async (key) => keys.get(key) ?? null,
    read: async (hash) => byHash.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); byHash.set(base.hash, base.map); }
  };
  return bases;
};

const compactBytes = async (save: GameSaveV1, bases: MapBases) =>
  Buffer.byteLength(JSON.stringify(await compactIsland(save as unknown as Record<string, unknown>, "home", bases)));

describe("1024 x 1024 dense island save pipeline", () => {
  let world: WorldData;
  let game: GameSaveV1;

  beforeAll(async () => {
    world = createSyntheticDenseWorld({ cells: CELLS, seed: 7, smallPropSpacing: 0.95, treeSpacing: 1.2 });
    game = await createGameSave(world, settlementStub(), MAP_INPUT);
  }, 120_000);

  it("is a dense forest within the owner's prop budget", () => {
    expect(world.props.count).toBeGreaterThan(450_000);
    expect(world.props.count).toBeLessThanOrEqual(600_000);
  });

  it("reads the written map file back bit for bit", async () => {
    const loaded = (await readMapFile(await writeMapFile(world, MAP_INPUT))).world;
    expect(loaded.props.count).toBe(world.props.count);
    for (const name of ["x", "y", "z", "rotation", "scale", "phase", "types", "form"] as const)
      expect(loaded.props[name].subarray(0, world.props.count)).toEqual(world.props[name].subarray(0, world.props.count));
    expect(loaded.heights).toEqual(world.heights);
    expect(loaded.splat).toEqual(world.splat);
  }, 120_000);

  it("expands a compacted save to the exact map and keeps an unchanged repeat save small", async () => {
    const bases = createBases();
    const first = await compactIsland(game as unknown as Record<string, unknown>, "home", bases);
    expect(first.map).toBe("");
    const expanded = await expandIsland(first, bases);
    expect(expanded.map).toBe(game.map);
    expect(await mapHash(expanded.map as string)).toBe(await mapHash(game.map));
    expect(await compactBytes(game, bases)).toBeLessThan(COMPACT_UNCHANGED_LIMIT);
  }, 120_000);

  it("grows the compact save by under 4 KB when one prop is planted", async () => {
    const bases = createBases();
    const unchanged = await compactBytes(game, bases);
    const planted = await createGameSave({ ...world, props: growPropSet(world.props) }, settlementStub(), MAP_INPUT);
    const grown = await compactBytes(planted, bases);
    expect(grown - unchanged).toBeLessThan(COMPACT_ONE_PROP_GROWTH_LIMIT);
    const restored = await expandIsland(await compactIsland(
      planted as unknown as Record<string, unknown>, "home", bases), bases);
    expect(restored.map).toBe(planted.map);
  }, 120_000);
});
