import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compressSceneData,
  decodeSceneData,
  decompressSceneBytes,
  encodeSceneData,
  unpackSceneData
} from "../src/app/scene-replay/codec";
import { createFrameInterpolator, lerpAngle } from "../src/app/scene-replay/interpolation";
import { createSceneJournal, readSceneReplay, type SceneSegment } from "../src/app/scene-replay/journal";
import { createScenePlayer, nextSceneSegment } from "../src/app/scene-replay/player";
import { applySceneWorldEdits, createSceneWorldTracker } from "../src/app/scene-replay/world-delta";
import { createWorldScrubber } from "../src/app/scene-replay/world-scrubber";

const MEBIBYTE = 1048576;
const FELLED = { chop: [1, 0, 0, 0], phase: "falling", showStump: true, showTree: true };
/** The live felling/growth views a drawn frame carries (functions, as in the game). */
const liveTrees = () => ({
  felling: { felledIds: () => new Set([7]).values(), getState: (id: number) => id === 7 ? FELLED : undefined,
    leaves: { alpha: new Float32Array([.5]) } },
  growth: { growing: () => [{ id: 3, progress: .5, stage: 2 }], grownIds: () => [4], isGrowing: () => false,
    isGrown: () => false, revision: () => 9 }
});

it("roundtrips actual renderer typed-array species as raw bytes and protects import object keys", () => {
  const source = { animals: { positions: new Float32Array([1.25, NaN, -3]) }, birds: new Uint8Array([0, 255]),
    ids: new Int32Array([-7, 1 << 30]), time: 4 };
  const text = encodeSceneData(source);
  expect(text).toContain('"base64"');
  expect(decodeSceneData(text)).toEqual(source);
  expect(() => decodeSceneData('{"__proto__":{"bad":true}}')).toThrow(/Invalid scene/);
  expect(() => decodeSceneData('{"$sceneArray":"Date","base64":"AA=="}')).toThrow(/Invalid scene/);
  expect(() => decodeSceneData('{"$sceneArray":"Float32Array","base64":"AAA="}')).toThrow(/Invalid scene/);
});

it("gzips a world's raw bytes several times smaller and restores fresh copies", async () => {
  const heights = new Float32Array(65536).map((_, index) => Math.round(Math.sin(index / 300) * 64) / 16);
  const world = { fog: new Uint8Array(65536), heights, props: { count: 2, x: new Float64Array([1, NaN]) }, seed: 3 };
  const compressed = await compressSceneData(world);
  expect(compressed.length).toBeLessThan(encodeSceneData(world).length / 4);
  const packed = await decompressSceneBytes(compressed);
  const restored = unpackSceneData(packed) as typeof world;
  expect(restored).toEqual(world);
  restored.fog[0] = 9;
  expect((unpackSceneData(packed) as typeof world).fog[0]).toBe(0);
  expect(() => unpackSceneData(new Uint8Array([0, 0, 0, 99]))).toThrow(/Invalid scene/);
});

describe("world tracker", () => {
  it("replays sparse terrain/fog, removed and appended props without executing AI", () => {
    const observed = { fog: new Uint8Array([0, 0]), heights: new Float32Array([0, 2]),
      props: { count: 1, types: new Uint8Array([1]), x: new Float32Array([4]) } };
    const tracker = createSceneWorldTracker(observed);
    const viewer = structuredClone(observed);
    observed.heights[0] = 3; observed.fog[1] = 2; observed.props.types[0] = 255;
    const edits = tracker.collect();
    applySceneWorldEdits(viewer, decodeSceneData(encodeSceneData(edits)) as typeof edits);
    expect(viewer).toEqual(observed);
    observed.props.count = 2; observed.props.types = new Uint8Array([255, 0]); observed.props.x = new Float32Array([4, 8]);
    applySceneWorldEdits(viewer, tracker.collect());
    expect(viewer).toEqual(observed);
    expect(tracker.collect()).toEqual([]);
    expect(() => applySceneWorldEdits(viewer, [{ path: ["__proto__", "polluted"], value: true }])).toThrow(/Invalid scene/);
  });

  it("finds single changed elements of every width, including the unaligned tail, and a NaN", () => {
    const world = { bytes: new Uint8Array(7), doubles: new Float64Array(3), floats: new Float32Array(5),
      shorts: new Uint16Array(3) };
    const tracker = createSceneWorldTracker(world);
    world.bytes[6] = 9; world.doubles[1] = .5; world.floats[4] = NaN; world.shorts[2] = 300;
    const edits = tracker.collect();
    expect(Object.fromEntries(edits.map(edit => [edit.path[0], edit.entries]))).toEqual({
      bytes: [[6, 9]], doubles: [[1, .5]], floats: [[4, NaN]], shorts: [[2, 300]]
    });
    const viewer = { bytes: new Uint8Array(7), doubles: new Float64Array(3), floats: new Float32Array(5),
      shorts: new Uint16Array(3) };
    applySceneWorldEdits(viewer, decodeSceneData(encodeSceneData(edits)) as typeof edits);
    expect(viewer).toEqual(world);
    expect(tracker.collect()).toEqual([]);
  });

  it("time-slices a large world by its budget yet catches every change within one pass", () => {
    const world = { fog: new Uint8Array(3 * MEBIBYTE), heights: new Float32Array(MEBIBYTE), seed: 1 };
    const tracker = createSceneWorldTracker(world, MEBIBYTE);
    world.fog[3 * MEBIBYTE - 1] = 1; world.heights[0] = 2; world.seed = 2;
    const passes = Array.from({ length: 8 }, () => tracker.collect());
    expect(passes.every(edits => edits.length <= 1)).toBe(true);
    expect(passes.flat().map(edit => edit.path[0]!).sort((left, right) => left.localeCompare(right))).toEqual(["fog", "heights", "seed"]);
  });
});

it("selects recorded snapshots when paused, seeking backwards or changing speed", () => {
  const report = { segments: [{ samples: [{ at: 0, frame: { time: 40 } }, { at: .1, frame: { time: 40.1 } },
    { at: 1, frame: { time: 41 } }] }] } as any;
  const player = createScenePlayer(report);
  expect(player.advance(.2)?.frame.time).toBe(40.1);
  player.toggle(); expect(player.advance(8)?.frame.time).toBe(40.1);
  player.seek(0); expect(player.advance(0)?.frame.time).toBe(40);
  player.setSpeed(4); player.toggle(); expect(player.advance(.3)?.frame.time).toBe(41);
  expect(player.state().playing).toBe(false);
});

it("blends between the snapshots around the clock", () => {
  const samples = [{ at: 0, frame: { time: 0 } }, { at: .1, frame: { time: .1 } }, { at: .2, frame: { time: .2 } }];
  const player = createScenePlayer({ segments: [{ samples }] } as any);
  player.advance(.125);
  const { from, to, weight } = player.blend();
  expect([from?.at, to?.at]).toEqual([.1, .2]);
  expect(weight).toBeCloseTo(.25);
  player.advance(1);
  expect(player.blend()).toMatchObject({ from: samples[2], to: undefined, weight: 0 });
});

it("captures immutable full frames at bounded cadence and honestly stops when full", () => {
  const journal = createSceneJournal(undefined, 3000);
  journal.beginSegment("Island A", "roman", "H4sI");
  const frame = { time: 20, camera: { zoom: 1 }, environment: {}, workers: [{ x: 1 }],
    animals: { x: new Float32Array([2]) }, ...liveTrees() } as any;
  journal.capture(0, frame); frame.workers[0].x = 99;
  journal.capture(.01, frame);
  const [segment] = journal.report().segments;
  expect(segment!.samples).toHaveLength(1);
  expect(segment!.samples[0]!.frame.workers![0]!.x).toBe(1);
  expect(readSceneReplay(encodeSceneData(journal.report())).segments[0]!.samples[0]!.frame.animals)
    .toEqual(frame.animals);
  journal.capture(.5, frame, [{ path: ["fog"], entries: [[0, 2]] }]);
  expect(journal.report().segments[0]!.samples.at(-1)!.worldRevision).toBe(1);
  for (let index = 1; index < 100; index++) journal.capture(index, frame);
  expect(journal.active()).toBe(false); expect(journal.report().truncated).toBe(true);
  expect(encodeSceneData(journal.report()).length).toBeLessThan(3000);
});

it("rejects frames that point past the recorded world deltas and unknown nations", () => {
  const journal = createSceneJournal();
  journal.beginSegment("Island A", "viking", "H4sI");
  journal.capture(0, { camera: {}, environment: {}, time: 0, ...liveTrees() } as any);
  const report = journal.report();
  report.segments[0]!.samples[0]!.worldRevision = 1;
  expect(() => readSceneReplay(encodeSceneData(report))).toThrow(/Invalid scene frame/);
  report.segments[0]!.samples[0]!.worldRevision = 0;
  (report.segments[0] as { nation: string }).nation = "martian";
  expect(() => readSceneReplay(encodeSceneData(report))).toThrow(/Invalid scene segment/);
});

it("finishes a segment only when playback runs into its end, then names the next island", () => {
  const samples = [{ at: 0, frame: { time: 0 } }, { at: 1, frame: { time: 1 } }];
  const report = { segments: [{ samples }, { samples }, { samples: [] }] } as any;
  const player = createScenePlayer(report);
  player.toggle();
  player.seek(5);
  player.advance(0);
  expect(player.state().finished).toBe(false);
  player.seek(.5);
  player.toggle();
  player.advance(2);
  expect(player.state()).toMatchObject({ finished: true, playing: false, position: 1 });
  player.seek(0);
  expect(player.state().finished).toBe(false);
  expect(nextSceneSegment(report, 0)).toBe(1);
  expect(nextSceneSegment(report, 1)).toBeUndefined();
});

describe("frame interpolation", () => {
  const pool = (x: number, heading: number, species = 1) => ({ count: 1, heading: new Float32Array([heading]),
    species: new Uint8Array([species]), x: new Float32Array([x]), y: new Float32Array([0]), z: new Float32Array([0]) });
  const camera = (centerX: number, yaw: number, zoom: number) =>
    ({ centerX, centerZ: 0, tilt: 0, viewportHeight: 1, viewportWidth: 1, yaw, zoom });
  const worker = (actorId: number, x: number, heading: number) =>
    ({ action: "walk", actorId, animationTime: x, gaitPhase: .9, heading, x, y: 0, z: 0 });

  it("turns the short way round", () => {
    expect(Math.abs(lerpAngle(3, -3, .5))).toBeCloseTo(Math.PI);
    expect(lerpAngle(.5, 1.5, .5)).toBeCloseTo(1);
  });

  it("moves camera, workers by actor, ships by id and pool slots halfway; jumps stay put", () => {
    const interpolate = createFrameInterpolator();
    const from = { animals: pool(0, 0), birds: pool(0, 0, 2), camera: camera(0, 0, 1), environment: {},
      ships: [{ id: 4, x: 0, y: 0, yaw: 0, z: 0 }], time: 0,
      workers: [worker(1, 0, 0), worker(2, 0, 0)] } as any;
    const to = { animals: pool(2, 1), birds: pool(9, 0, 2), camera: camera(4, 1, 4), environment: {},
      ships: [{ id: 4, x: 1, y: 0, yaw: 1, z: 0 }], time: .1,
      workers: [worker(2, 20, 0), worker(1, 1, 1)] } as any;
    const frame = interpolate(from, to, .5);
    expect(frame.time).toBeCloseTo(.05);
    expect(frame.camera).toMatchObject({ centerX: 2, yaw: .5, zoom: 2 });
    expect(frame.workers![0]).toMatchObject({ heading: .5, x: .5 });
    expect(frame.workers![1]!.x).toBe(0);
    expect(frame.workers![0]!.gaitPhase).toBeCloseTo(.9);
    expect(frame.ships![0]).toMatchObject({ x: .5, yaw: .5 });
    expect(frame.animals.x[0]).toBe(1);
    expect(frame.animals.heading[0]).toBeCloseTo(.5);
    expect(frame.birds.x[0]).toBe(0);
    expect(from.animals.x[0]).toBe(0);
    expect(interpolate(from, undefined, .5)).toBe(from);
  });
});

it("scrubs world deltas forwards, restores the start world on a backward seek", async () => {
  const packed = async (value: unknown) => decompressSceneBytes(await compressSceneData(value));
  const start = { cellsX: 4, cellsZ: 4, fog: new Uint8Array(4), heights: new Float32Array(4),
    props: { count: 0, types: new Uint8Array(0) } };
  const world = structuredClone(start) as any;
  const segment = { deltas: [
    { at: 1, data: encodeSceneData([{ entries: [[0, 2]], path: ["fog"] }]) },
    { at: 2, data: encodeSceneData([{ entries: [[1, 5]], path: ["heights"] }]) }
  ] } as unknown as SceneSegment;
  const calls: string[] = [];
  const renderer = { mapEdit: {
    refreshChunks: () => calls.push("chunks"), refreshFieldCover: () => calls.push("cover"),
    refreshPlacedProps: () => calls.push("props"), removeProps: () => calls.push("remove")
  } } as any;
  const scrub = createWorldScrubber(world, renderer, segment, await packed(start));
  scrub(0);
  expect(calls).toEqual([]);
  scrub(1);
  expect([world.fog[0], calls]).toEqual([2, []]);
  scrub(2);
  expect([world.heights[1], calls]).toEqual([5, ["chunks", "cover"]]);
  calls.length = 0;
  scrub(0);
  expect([world.fog[0], world.heights[1]]).toEqual([0, 0]);
  expect(calls).toEqual(["chunks", "props", "remove", "cover"]);
});

describe("page reload", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lets the recording persist before the island page reloads", async () => {
    const { reloadPage, setBeforePageReload } = await import("../src/app/page-reload");
    const location = { href: "", reload: vi.fn() };
    vi.stubGlobal("location", location);
    reloadPage("/?map=a");
    expect(location.href).toBe("/?map=a");
    let persisted = false;
    setBeforePageReload(async () => { persisted = true; });
    reloadPage();
    expect(location.reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(location.reload).toHaveBeenCalled());
    expect(persisted).toBe(true);
    setBeforePageReload(undefined);
  });
});

it("stores felling and growth as data and gives the renderer its live views back", async () => {
  const { restoreSceneFrame, snapshotSceneFrame } = await import("../src/app/scene-replay/frame-snapshot");
  const data = decodeSceneData(encodeSceneData(snapshotSceneFrame({ time: 1, ...liveTrees() } as any))) as any;
  const frame = restoreSceneFrame(data);
  expect([...frame.felling.felledIds()]).toEqual([7]);
  expect(frame.felling.getState(7)).toEqual(FELLED);
  expect(frame.felling.getState(8).phase).toBe("standing");
  expect(frame.felling.leaves.alpha).toEqual(new Float32Array([.5]));
  expect([...frame.growth.growing()]).toEqual([{ id: 3, progress: .5, stage: 2 }]);
  expect([frame.growth.isGrown(4), frame.growth.isGrowing(3), frame.growth.isGrown(3), frame.growth.revision()])
    .toEqual([true, true, false, 9]);
  expect(restoreSceneFrame(data)).toBe(frame);
});

it("refreshes only the cells and props a forward delta touched", () => {
  const start = { cellsX: 64, cellsZ: 64, fog: new Uint8Array(4096), heights: new Float32Array(65 * 65),
    props: { count: 2, types: new Uint8Array([1, 1]), x: new Float32Array([40.5, 3]), z: new Float32Array([50.5, 3]) } };
  const world = structuredClone(start) as any;
  const segment = { deltas: [
    { at: 1, data: encodeSceneData([{ entries: [[10 * 65 + 20, 1]], path: ["heights"] }]) },
    { at: 2, data: encodeSceneData([{ entries: [[0, 255]], path: ["props", "types"] }]) }
  ] } as unknown as SceneSegment;
  const calls: unknown[] = [];
  const renderer = { mapEdit: {
    refreshChunks: (chunks: unknown[]) => calls.push(["chunks", chunks.length]),
    refreshFieldCover: (cells: unknown) => calls.push(["cover", cells]),
    refreshPlacedProps: () => calls.push(["props"]),
    removeProps: (ids: number[], cells: unknown) => calls.push(["remove", ids, cells])
  } } as any;
  const scrub = createWorldScrubber(world, renderer, segment, new Uint8Array());
  scrub(1);
  const cells = { maxX: 21, maxZ: 11, minX: 19, minZ: 9 };
  expect(calls).toEqual([["chunks", 1], ["cover", cells]]);
  calls.length = 0;
  scrub(2);
  expect(calls).toEqual([["remove", [0], { maxX: 41, maxZ: 51, minX: 39, minZ: 49 }]]);
});

it("stores only live pool slots and leaves, and unchanged roads, borders and grown trees once", async () => {
  const { inheritSharedFields, snapshotSceneFrame } = await import("../src/app/scene-replay/frame-snapshot");
  const trees = liveTrees();
  trees.felling.leaves = { alpha: new Float32Array([.5, 0, .2, 0, 0]), capacity: 5 } as any;
  const frame = { ...trees, animals: { coat: new Float32Array(16), count: 1, species: new Uint8Array(4) },
    critters: { count: 2, ripples: { age: new Float32Array(8), count: 1 }, x: new Float32Array(8) },
    roadRevision: 3, roads: [{ id: 1 }], territoryBorders: [{ x: 1 }], territoryRevision: 5, time: 0 } as any;
  const first = snapshotSceneFrame(frame);
  expect([first.animals.coat.length, first.animals.species.length]).toEqual([4, 1]);
  expect([(first.critters as any).x.length, (first.critters as any).ripples.age.length]).toEqual([2, 1]);
  expect([first.felling.leaves.alpha.length, first.felling.leaves.capacity]).toEqual([3, 3]);
  const second = snapshotSceneFrame({ ...frame, roadRevision: 4, roads: [{ id: 2 }] }, first);
  expect([second.roads, second.territoryBorders, second.growth.grown]).toEqual([[{ id: 2 }], undefined, undefined]);
  inheritSharedFields([first, second]);
  expect([second.territoryBorders, second.growth.grown]).toEqual([[{ x: 1 }], [4]]);
});

it("stores unchanged felling and barely grown trees once", async () => {
  const { inheritSharedFields, snapshotSceneFrame } = await import("../src/app/scene-replay/frame-snapshot");
  const frame = { ...liveTrees(), time: 0 } as any;
  const first = snapshotSceneFrame(frame);
  const second = snapshotSceneFrame(frame, first);
  expect([second.felling.felled, second.growth.growing]).toEqual([undefined, undefined]);
  const grown = { ...frame, growth: { ...frame.growth, growing: () => [{ id: 3, progress: .6, stage: 2 }] } };
  expect(snapshotSceneFrame(grown, second).growth.growing).toEqual([{ id: 3, progress: .6, stage: 2 }]);
  inheritSharedFields([first, second]);
  expect([second.felling.felled, second.growth.growing]).toEqual([first.felling.felled, first.growth.growing]);
});

it("journal compares each frame with the last complete one, so unchanged parts stay left out", () => {
  const journal = createSceneJournal();
  journal.beginSegment("Island A", "roman", "H4sI");
  const frame = { camera: {}, environment: {}, time: 0, ...liveTrees() } as any;
  for (const at of [0, .1, .2]) journal.capture(at, frame);
  const felled = journal.report().segments[0]!.samples.map(sample => sample.frame.felling.felled);
  expect(felled.map(Boolean)).toEqual([true, false, false]);
});

it("keeps every 10 Hz grid sample although frames land a little late or early", () => {
  const journal = createSceneJournal();
  journal.beginSegment("Island A", "roman", "H4sI");
  const frame = { camera: {}, environment: {}, time: 0, ...liveTrees() } as any;
  let at = 0;
  for (let index = 0; index < 30; index++, at += .1) journal.capture(at + (index % 2) * .03, frame);
  expect(journal.report().segments[0]!.samples).toHaveLength(30);
});
