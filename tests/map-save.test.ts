import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createEditGround, refreshBuildLayers } from "../src/shared/world/editing/build-refresh";
import { paintGround } from "../src/shared/world/editing/ground-paint";
import { stampOreDeposit } from "../src/shared/world/editing/mine-land";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { removePropsInBrush, TREE_PROPS } from "../src/shared/world/editing/prop-removal";
import { applyStampChange } from "../src/shared/world/editing/terrain/terrain-apply";
import {
  createTerrainEditState,
  lowerStampAt,
  raiseStampAt,
  type TerrainEditState
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { propPhase } from "../src/shared/world/prop-quantum";
import { compressBytes, decompressBytes } from "../src/shared/world/save/map-bytes";
import {
  MAP_CODEC_OFFSET,
  MAP_FORMAT_VERSION,
  MAP_PREFIX_BYTES,
  MapFileError
} from "../src/shared/world/save/map-format";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { type MapSaveInput,writeMapFile } from "../src/shared/world/save/map-writer";
import { MATERIAL, ORE, PROP, type WorldData } from "../src/shared/world/world-data";
import { findOpenSpots, SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD, { ...SMALL_EDITOR_WORLD, rivers: 0 }, DEFAULT_WORLD_OPTIONS);

const BRUSH = { radius: 3, softness: 0.5 };
const INPUT: MapSaveInput = {
  animals: [{ species: 1, x: 40.5, z: 41.25 }],
  name: "Test island",
  savedAt: 1_700_000_000_000,
  source: "forest=2"
};

/**
 * A small island with every kind of edit: mountain, lake, tiles, ore, trees, stones, removal;
 * the terrain state keeps the mountain's and the lake's stamps.
 */
const createEditedWorld = () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  const [mountain, lake, tiles, trees] = findOpenSpots(world, 4, 14);
  const state = createTerrainEditState();
  for (let level = 0; level < 3; level += 1) {
    applyStampChange(world, state, raiseStampAt(state, mountain!.x, mountain!.z, 7));
  }
  applyStampChange(world, state, raiseStampAt(state, lake!.x, lake!.z, 8, "lake"));
  applyStampChange(world, state, raiseStampAt(state, lake!.x, lake!.z, 8, "lake"));
  const ground = createEditGround(world);
  const mine = paintGround(world, { ...BRUSH, ...tiles!, material: MATERIAL.mine, strength: 1 });
  refreshBuildLayers(world, ground, mine.cells);
  stampOreDeposit(world, { ...BRUSH, ...tiles! }, ORE.gold);
  const sand = { ...BRUSH, x: tiles!.x + 5, z: tiles!.z, material: MATERIAL.sand, strength: 1 };
  refreshBuildLayers(world, ground, paintGround(world, sand).cells);
  for (const [step, kind] of [PROP.broadleafTree, PROP.coniferTree, PROP.smallRock].entries()) {
    placeProp(world, { kind, seed: step, x: trees!.x + step * 2, z: trees!.z });
  }
  placeProp(world, { kind: PROP.pebbles, seed: 9, x: trees!.x, z: trees!.z + 3 });
  const removal = { ...BRUSH, radius: 2, x: trees!.x, z: trees!.z };
  removePropsInBrush(world, removal, (index) => TREE_PROPS.has(world.props.types[index]!));
  return { lake: lake!, mountain: mountain!, state, world };
};

/** The world as a save keeps it (survey state and the build revision are runtime state). */
const toSavedShape = (world: WorldData) => {
  const { buildRevision: _revision, fogRevision: _fog, terrainRevision: _terrainRevision, ...rest } = world;
  return {
    ...rest,
    mineZones: world.mineZones.map((zone) => ({ ...zone, surveyed: false })),
    props: {
      ...world.props,
      form: world.props.form.subarray(0, world.props.count),
      // S05b: phases are derived from the world seed and the spatial prop id when saved.
      phase: Float32Array.from({ length: world.props.count }, (_, id) => propPhase(world.seed, id)),
      rotation: world.props.rotation.subarray(0, world.props.count),
      scale: world.props.scale.subarray(0, world.props.count),
      types: world.props.types.subarray(0, world.props.count),
      x: world.props.x.subarray(0, world.props.count),
      y: world.props.y.subarray(0, world.props.count),
      z: world.props.z.subarray(0, world.props.count)
    }
  };
};

/** The file with its JSON header changed (the payload zipped again). */
const rewriteHeader = async (file: Uint8Array, change: (header: Record<string, unknown>) => void) => {
  const payload = await decompressBytes(file.subarray(MAP_PREFIX_BYTES), "gzip");
  const length = new DataView(payload.buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + length)));
  change(header);
  const text = new TextEncoder().encode(JSON.stringify(header));
  const next = new Uint8Array(4 + text.length + payload.length - 4 - length);
  new DataView(next.buffer).setUint32(0, text.length, true);
  next.set(text, 4);
  next.set(payload.subarray(4 + length), 4 + text.length);
  return new Uint8Array([...file.subarray(0, MAP_PREFIX_BYTES), ...(await compressBytes(next, "gzip"))]);
};

const setVersion = (file: Uint8Array, version: number) => {
  const copy = file.slice();
  new DataView(copy.buffer).setUint16(4, version, true);
  return copy;
};

/** One level back on the stamp at the point (as Ctrl + click does). */
const lowerAt = (world: WorldData, state: TerrainEditState, point: Point, kind?: "lake") => {
  applyStampChange(world, state, lowerStampAt(state, point.x, point.z, kind)!);
};

type Point = { x: number; z: number };

const expectRejected = async (bytes: Uint8Array, message: RegExp) => {
  const reading = readMapFile(bytes);
  await expect(reading).rejects.toBeInstanceOf(MapFileError);
  await expect(reading).rejects.toThrow(message);
};

describe("map save / load", () => {
  const { state, world } = createEditedWorld();

  it("loads the edited world exactly as saved (every layer, props, zones, animals)", async () => {
    const file = await writeMapFile(world, INPUT);
    const loaded = await readMapFile(file);
    expect(loaded.meta).toEqual({ name: INPUT.name, savedAt: INPUT.savedAt, source: "forest=2" });
    expect(loaded.animals).toEqual(INPUT.animals);
    expect(world.lakeWater).toBeDefined();
    expect(loaded.world).toEqual(toSavedShape(world));
  });

  it("keeps exact shared-catalog provenance in the canonical map file", async () => {
    const provenance = {
      hash: "b".repeat(64),
      mapId: "2f1e7d42-9b0a-4c74-8f36-3f7aae3d9c11",
      revision: 7
    };
    const loaded = await readMapFile(await writeMapFile(world, { ...INPUT, provenance }));
    expect(loaded.meta.provenance).toEqual(provenance);
  });

  it("stores the content catalog version only when given, so older-style saves keep their bytes", async () => {
    const plain = await writeMapFile(world, INPUT);
    expect((await readMapFile(plain)).meta).not.toHaveProperty("contentCatalogVersion");
    await rewriteHeader(plain, header => expect(header).not.toHaveProperty("contentCatalogVersion"));
    const authored = await readMapFile(await writeMapFile(world, { ...INPUT, contentCatalogVersion: "0a1b2c3d" }));
    expect(authored.meta.contentCatalogVersion).toBe("0a1b2c3d");
    await expectRejected(await rewriteHeader(plain, header => { header.contentCatalogVersion = "v1"; }), /damaged/);
  });

  it("keeps each layer in a buffer of its own (layers are transferred to workers)", async () => {
    const { world: loaded } = await readMapFile(await writeMapFile(world, INPUT));
    const buffers = [loaded.heights, loaded.splat, loaded.props.x, loaded.mineZone].map(
      (array) => array.buffer
    );
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(loaded.heights.byteLength).toBe(loaded.heights.buffer.byteLength);
  });

  it("rejects foreign, newer and damaged files with a clear message", async () => {
    const file = await writeMapFile(world, INPUT);
    await expectRejected(new TextEncoder().encode("hello, not a map"), /not an island map/);
    await expectRejected(setVersion(file, 99), /newer version/);
    await expectRejected(setVersion(file, 0), /Unknown map file version/);
    const cut = file.slice(0, Math.floor(file.length / 2));
    await expectRejected(cut, /damaged/);
    const flipped = file.slice();
    flipped[MAP_PREFIX_BYTES + 40] = flipped[MAP_PREFIX_BYTES + 40]! ^ 0xff;
    await expectRejected(flipped, /damaged/);
  });

  it("rejects a header whose layer sizes do not fit the map", async () => {
    const header = JSON.stringify({ ...INPUT, cellsX: 96, cellsZ: 96, chunks: [] });
    const text = new TextEncoder().encode(header);
    const payload = new Uint8Array(4 + text.length);
    new DataView(payload.buffer).setUint32(0, text.length, true);
    payload.set(text, 4);
    const file = await writeMapFile(world, INPUT);
    const forged = new Uint8Array([
      ...file.subarray(0, MAP_PREFIX_BYTES),
      ...(await compressBytes(payload, "gzip"))
    ]);
    await expectRejected(forged, /damaged/);
  });

  it("keeps the editor's stamps: a loaded map lowers them as before the save", async () => {
    const original = createEditedWorld();
    const file = await writeMapFile(original.world, { ...INPUT, terrain: original.state });
    const loaded = await readMapFile(file);
    expect(loaded.terrain).toEqual(original.state);
    expect(loaded.terrain!.stamps).toHaveLength(2);
    const copies = [original, { state: loaded.terrain!, world: loaded.world }];
    for (const { state: terrain, world: edited } of copies) {
      lowerAt(edited, terrain, original.mountain);
      lowerAt(edited, terrain, original.lake, "lake");
    }
    expect(loaded.terrain!.stamps.map(({ level }) => level)).toEqual([2, 1]);
    // Terrain edits may append props with a local phase; saved maps derive every phase (S05b).
    loaded.world.props.phase = Float32Array.from({ length: loaded.world.props.count },
      (_, id) => propPhase(loaded.world.seed, id));
    const { buildRevision: _revision, terrainRevision: _terrainRevision, ...lowered } = loaded.world;
    expect(lowered).toEqual(toSavedShape(original.world));
    expect(loaded.terrain).toEqual(original.state);
  });

  it("reads version 1 files (no stamps) and saves no stamps for a map without any", async () => {
    const plain = await writeMapFile(world, INPUT);
    expect(new DataView(plain.buffer).getUint16(4, true)).toBe(MAP_FORMAT_VERSION);
    const versionOne = await readMapFile(setVersion(plain, 1));
    expect(versionOne.terrain).toBeNull();
    expect(versionOne.world).toEqual(toSavedShape(world));
    const empty = await writeMapFile(world, { ...INPUT, terrain: createTerrainEditState() });
    expect(empty.length).toBe(plain.length);
  });

  it("rejects damaged stamps", async () => {
    const file = await writeMapFile(world, { ...INPUT, terrain: state });
    const levels = await rewriteHeader(file, (header) => {
      (header.terrain as { stamps: { level: number }[] }).stamps[0]!.level = 99;
    });
    await expectRejected(levels, /\(terrain\)/);
    const props = await rewriteHeader(file, (header) => {
      (header.terrain as { stampProps: unknown[] }).stampProps = [[1, [1e9]]];
    });
    await expectRejected(props, /\(terrain\)/);
    const template = await rewriteHeader(file, (header) => {
      (header.terrain as { stamps: { template?: string }[] }).stamps[0]!.template = "unknown-source";
    });
    await expectRejected(template, /\(terrain\)/);
  });

  it("logs the size of the default island's file", async () => {
    const island = cachedWorld(DEFAULT_WORLD_OPTIONS);
    const startedAt = performance.now();
    const file = await writeMapFile(island, INPUT);
    const savedMs = performance.now() - startedAt;
    const loadStart = performance.now();
    await readMapFile(file);
    const loadMs = performance.now() - loadStart;
    const kib = (file.length / 1024).toFixed(0);
    console.log(
      `default island map: ${kib} KiB, save ${savedMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms`
    );
    expect(file.length).toBeLessThan(4 * 1024 * 1024);
  }, 60_000);
});

it("retains stable road-grading source heights across map save and reload", async () => {
  const { levelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  const x = Math.round(world.start.x), z = Math.round(world.start.z);
  const roads = [{ start: { x, z }, end: { x: x + .5, z }, tier: "dirt" as const }];
  levelRoadGround(world, roads, []);
  const loaded = (await readMapFile(await writeMapFile(world, INPUT))).world;
  expect(loaded.roadGradeBase).toEqual(world.roadGradeBase);
  expect(loaded.roadGradeApplied).toEqual(world.roadGradeApplied);
  const heights = loaded.heights.slice();
  expect(levelRoadGround(loaded, roads, [])).toBeNull();
  expect(loaded.heights).toEqual(heights);
});
it("round-trips permanently cleared stone footprints independently of current roads", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.clearedStoneGround = new Uint8Array(world.cellsX * world.cellsZ);
  world.clearedStoneGround[19] = 1;
  const { world: restored } = await readMapFile(await writeMapFile(world, INPUT));
  expect(restored.clearedStoneGround).toEqual(world.clearedStoneGround);
});
it("round-trips authored starts/enemies and editable river originals separately from runtime state", async () => {
  const { createMapScenario } = await import("../src/shared/world/map-scenario");
  const { editAuthoredRiver } = await import("../src/shared/world/editing/authored-rivers");
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  world.scenario = { ...createMapScenario(), kind: "adventure", landing: { x: 20, z: 20 },
    units: [{ id: 1, x: 24, z: 24, type: "shield", faction: 1, rank: 0, group: 1, heading: 0 }],
    decorations: [{ item: "roadDecoration:roman-rusticated-arch:marble", x: 30.25, yaw: 1.5, z: 31.75 }] };
  editAuthoredRiver(world, { id: 1, points: [{ x: 24, z: 28 }, { x: 40, z: 43 }], width: 2, depth: .8 });
  const { world: restored } = await readMapFile(await writeMapFile(world, INPUT));
  // ACT1: the legacy decoration row gets the next stable id and the counter starts once, on read.
  expect(restored.scenario).toEqual({ ...world.scenario, nextObjectId: 3,
    decorations: [{ ...world.scenario.decorations![0], id: 2 }] });
  expect(restored.authoredRivers).toEqual(world.authoredRivers);
  expect(restored.heights).toEqual(world.heights);
  editAuthoredRiver(restored, null, 1);
  expect(restored.authoredRivers).toEqual([]);
});

const bitsOf = (values: Float32Array) => Uint32Array.from(new Uint32Array(values.buffer, values.byteOffset, values.length));

describe("predicted map layers (map format 3)", () => {
  /** A world whose near-copy layers deviate from their predictions at a few vertices. */
  const createDeviatingWorld = () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    world.roadGradeApplied = world.heights.slice();
    world.roadGradeBase = world.heights.slice();
    world.restoreBaselineHeights = world.heights.slice();
    world.restoreBaselineWater = world.waterSurface.slice();
    world.restoreBaselineLake = new Uint8Array(world.heights.length);
    world.restoreBaselineName = "baseline";
    for (const vertex of [10, 200, 3000]) world.waterDepth[vertex] = world.waterDepth[vertex]! + 0.37;
    for (const vertex of [5, 6, 90, 700, 1500]) world.roadGradeBase![vertex] = world.heights[vertex]! - 1.25;
    world.roadGradeApplied[42] = 1e-40;
    world.restoreBaselineHeights[7] = -0;
    return world;
  };

  it("restores every predicted layer bit for bit, also where it deviates", async () => {
    const world = createDeviatingWorld();
    const { world: loaded } = await readMapFile(await writeMapFile(world, INPUT));
    for (const name of ["waterDepth", "roadGradeBase", "roadGradeApplied", "restoreBaselineHeights"] as const) {
      expect(bitsOf(loaded[name]!), name).toEqual(bitsOf(world[name]!));
    }
  });

  it("stores the predicted layers as residual chunks that compress far smaller", async () => {
    const world = createDeviatingWorld();
    const file = await writeMapFile(world, INPUT, { codec: "gzip" });
    const payload = await decompressBytes(file.subarray(MAP_PREFIX_BYTES), "gzip");
    const length = new DataView(payload.buffer).getUint32(0, true);
    const names = (JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + length))) as
      { chunks: { name: string }[] }).chunks.map(({ name }) => name);
    expect(names).toContain("waterDepth~residual");
    expect(names).toContain("roadGradeApplied~residual");
    expect(names).not.toContain("waterDepth");
    expect(names).not.toContain("heights~residual");
  });

  it("rejects a plain and a residual chunk of one layer and unknown residual layers", async () => {
    const file = await writeMapFile(cachedWorld(SMALL_EDITOR_WORLD), INPUT);
    const both = await rewriteHeader(file, (header) => {
      const chunks = header.chunks as { name: string }[];
      chunks.find(({ name }) => name === "waterSurface")!.name = "waterDepth";
    });
    await expectRejected(both, /damaged/);
    const unknown = await rewriteHeader(file, (header) => {
      const chunks = header.chunks as { name: string }[];
      chunks.find(({ name }) => name === "moisture")!.name = "moisture~residual";
    });
    await expectRejected(unknown, /damaged/);
  });

  it("still loads a version 2 map file with plain layers and rewrites it smaller", async () => {
    const demo = JSON.parse(readFileSync(new URL("../public/demo/continued-0.json", import.meta.url), "utf8")) as
      { map: string };
    const original = Uint8Array.from(Buffer.from(demo.map, "base64"));
    expect(new DataView(original.buffer).getUint16(4, true)).toBe(2);
    const { animals, meta, terrain, world } = await readMapFile(original);
    const rewritten = await writeMapFile(world, { ...meta, animals, terrain }, { codec: "gzip" });
    expect(rewritten.length).toBeLessThan(original.length * 0.85);
    const { world: again } = await readMapFile(rewritten);
    expect(bitsOf(again.waterDepth)).toEqual(bitsOf(world.waterDepth));
    expect(bitsOf(again.heights)).toEqual(bitsOf(world.heights));
  }, 60_000);
});

describe("map file compression codec", () => {
  it("records the codec in the prefix and reads a brotli file back exactly", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const gzip = await writeMapFile(world, INPUT, { codec: "gzip" });
    const brotli = await writeMapFile(world, INPUT, { codec: "brotli" });
    expect(gzip[MAP_CODEC_OFFSET]).toBe(0);
    expect(brotli[MAP_CODEC_OFFSET]).toBe(1);
    expect((await readMapFile(brotli)).world).toEqual((await readMapFile(gzip)).world);
  }, 60_000);

  it("rejects an unknown codec byte", async () => {
    const file = (await writeMapFile(cachedWorld(SMALL_EDITOR_WORLD), INPUT, { codec: "gzip" })).slice();
    file[MAP_CODEC_OFFSET] = 9;
    await expectRejected(file, /Unknown map file compression/);
  });

  it("chooses gzip when brotli is slow or missing", async () => {
    const { chooseMapCodec } = await import("../src/shared/world/save/map-bytes");
    const codec = await chooseMapCodec(new Uint8Array(1024));
    expect(["gzip", "brotli"]).toContain(codec);
  });
});
