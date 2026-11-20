import {
  Box3, type BufferGeometry, ImageLoader, type Mesh, MeshStandardMaterial, Raycaster, Vector3
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import type { FrameState } from "../src/render-common/renderer-contract";
import { createDepositSignModel, DEPOSIT_NAMES } from "../src/renderers/three/settlement/deposit-sign-model";
import { createThreeDepositSigns } from "../src/renderers/three/settlement/three-deposit-signs";
import { ROAD_RESERVED_HALF_WIDTH, type RoadSegment } from "../src/shared/settlement/road-types";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { BUILD, FOG, type MineZone, ORE, type WorldData } from "../src/shared/world/world-data";
import { createFakeCanvasDocument } from "./helpers/fake-canvas-dom";

// The worker crowd module needs a browser base URL; the signs only borrow its scene lights.
vi.mock("../src/renderers/three/three-worker", () => ({ createCrowdLights: () => () => {} }));

/** BoxGeometry keeps 24 vertices; mergeGeometries keeps the authoring order. */
const BOX_VERTICES = 24;
const TOUCH = .004;
const wood = new MeshStandardMaterial();
const materials = new Proxy({}, { get: () => wood }) as Record<BuildingSurface, MeshStandardMaterial>;

const partBounds = (geometry: BufferGeometry, vertices: number) => {
  const position = geometry.getAttribute("position");
  const parts: Box3[] = [];
  for (let start = 0; start < position.count; start += vertices) {
    const box = new Box3();
    for (let i = start; i < start + vertices; i++) box.expandByPoint(new Vector3().fromBufferAttribute(position, i));
    parts.push(box);
  }
  return parts;
};
const touches = (a: Box3, b: Box3) => a.clone().expandByScalar(TOUCH).intersectsBox(b);
const modelParts = () => {
  const root = createDepositSignModel(materials, new MeshStandardMaterial());
  const [timber, painting] = root.children as Mesh[];
  return { painting: painting!, paintings: partBounds(painting!.geometry, 4), root,
    timber: partBounds(timber!.geometry, BOX_VERTICES) };
};

describe("deposit sign model", () => {
  it("authors a post, a board, two rails and a two-sided ore painting", () => {
    const { painting, paintings, root, timber } = modelParts();
    expect(timber).toHaveLength(4);
    expect(paintings).toHaveLength(2);
    expect(painting.name).toBe("deposit_ore_painting");
    expect(root.rotation.y).toBeCloseTo(Math.PI / 4);
  });

  it("stands on the ground and every timber piece is joined to the grounded post", () => {
    const { timber } = modelParts();
    const lowest = Math.min(...timber.map(box => box.min.y));
    expect(lowest).toBeCloseTo(0, 6);
    const grounded = new Set([timber.findIndex(box => Math.abs(box.min.y) < 1e-6)]);
    for (let changed = true; changed;) {
      changed = false;
      timber.forEach((box, index) => {
        if (grounded.has(index) || ![...grounded].some(other => touches(box, timber[other]!))) return;
        grounded.add(index); changed = true;
      });
    }
    expect(grounded.size).toBe(timber.length);
  });

  it("lays each painting flat against a board face, inside the board edges", () => {
    const { paintings, timber } = modelParts();
    const board = timber[1]!;
    for (const picture of paintings) {
      expect(picture.max.z - picture.min.z).toBeLessThan(1e-6);
      expect(picture.min.x).toBeGreaterThanOrEqual(board.min.x);
      expect(picture.max.x).toBeLessThanOrEqual(board.max.x);
      expect(picture.min.y).toBeGreaterThanOrEqual(board.min.y);
      expect(picture.max.y).toBeLessThanOrEqual(board.max.y);
      const gap = Math.min(Math.abs(picture.min.z - board.max.z), Math.abs(picture.min.z - board.min.z));
      expect(gap).toBeLessThan(TOUCH);
    }
    expect(Math.sign(paintings[0]!.min.z)).toBe(-Math.sign(paintings[1]!.min.z));
  });

  it("maps the whole ore texture onto each face without mirroring the back", () => {
    const { painting } = modelParts();
    const uv = painting.geometry.getAttribute("uv"), position = painting.geometry.getAttribute("position");
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.min(...us)).toBe(0); expect(Math.max(...us)).toBe(1);
    // Viewed from its own side, u grows to the viewer's right on both faces.
    for (const [first, second] of [[0, 1], [4, 5]]) {
      const facing = Math.sign(position.getZ(first!));
      const rightward = (position.getX(second!) - position.getX(first!)) * facing;
      expect(Math.sign(rightward)).toBe(Math.sign(uv.getX(second!) - uv.getX(first!)));
    }
  });
});

const SIZE = 24;
const zone = (fields: Partial<MineZone> = {}): MineZone => ({ cellCount: 20, centreX: 12.5, centreZ: 12.5,
  id: 1, ore: ORE.iron, richness: .8, surveyed: true, ...fields });
const createWorld = (mineZones: MineZone[]) => ({
  blocking: new Uint8Array(SIZE * SIZE), buildRevision: 0, cellsX: SIZE, cellsZ: SIZE,
  buildClass: new Uint8Array(SIZE * SIZE).fill(BUILD.large),
  buildCap: new Uint8Array(SIZE * SIZE).fill(BUILD.large),
  heights: Float32Array.from({ length: (SIZE + 1) * (SIZE + 1) }, (_, i) => 1 + (i % (SIZE + 1)) * .05),
  mineZones, terrainRevision: 0
}) as unknown as WorldData;
const environment = { ambientGround: [.2, .2, .2], ambientSky: [.5, .5, .5],
  sun: { azimuthX: 1, azimuthZ: 0, elevation: .6 }, sunColor: [1, 1, 1] };
const frameWith = (roads: RoadSegment[] = []) =>
  ({ buildings: [], environment, roadRevision: roads.length, roads }) as unknown as FrameState;
const rayDownAt = (x: number, z: number) => new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0));
/** Sweeps vertical rays over the map; returns every column that hits a sign. */
const hitColumns = (signs: ReturnType<typeof createThreeDepositSigns>) => {
  const columns: { x: number; z: number }[] = [];
  for (let z = 6; z <= 19; z += .1) for (let x = 6; x <= 19; x += .1)
    if (signs.pickHit(rayDownAt(x, z))) columns.push({ x, z });
  return columns;
};

describe("deposit sign layer", () => {
  beforeEach(() => {
    vi.stubGlobal("document", createFakeCanvasDocument().document);
    vi.spyOn(ImageLoader.prototype, "load").mockImplementation((() => {}) as never);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("plants surveyed signs on the sloped terrain and skips unsurveyed or barren zones", () => {
    const world = createWorld([zone(), zone({ centreX: 4.5, id: 2, surveyed: false }),
      zone({ centreX: 20.5, id: 3, ore: ORE.none })]);
    const signs = createThreeDepositSigns(world, materials);
    signs.update(frameWith());
    expect(signs.pickHit(rayDownAt(4.5, 12.5))).toBeNull();
    expect(signs.pickHit(rayDownAt(20.5, 12.5))).toBeNull();
    const hit = signs.pickHit(rayDownAt(12.5, 12.5));
    expect(hit).toMatchObject({ id: 1, label: DEPOSIT_NAMES[ORE.iron] });
    const ground = sampleSmooth(world, world.heights, 12.5, 12.5);
    expect(10 - hit!.distance).toBeGreaterThan(ground + .6);
    expect(10 - hit!.distance).toBeLessThan(ground + 1.2);
    signs.dispose();
  });

  it("moves a sign off a newly built road and labels every painted ore", () => {
    const world = createWorld([zone({ ore: ORE.gold })]);
    const signs = createThreeDepositSigns(world, materials);
    signs.update(frameWith());
    expect(signs.pickHit(rayDownAt(12.5, 12.5))?.label).toBe("Gold deposit");
    const road = { end: { x: 12.5, z: 16 }, start: { x: 12.5, z: 9 }, tier: "dirt" } as RoadSegment;
    signs.update(frameWith([road]));
    expect(signs.pickHit(rayDownAt(12.5, 12.5))).toBeNull();
    const columns = hitColumns(signs);
    expect(columns.length).toBeGreaterThan(0);
    for (const { x } of columns) expect(Math.abs(x - 12.5)).toBeGreaterThan(ROAD_RESERVED_HALF_WIDTH);
    expect(Object.values(DEPOSIT_NAMES).sort()).toEqual(
      ["Coal deposit", "Gold deposit", "Granite deposit", "Iron deposit"]);
    signs.dispose();
  });

  it("cannot be hovered while its cell is still under fog", () => {
    const world = createWorld([zone({ ore: ORE.coal })]);
    world.fog = new Uint8Array(SIZE * SIZE).fill(FOG.hidden);
    const signs = createThreeDepositSigns(world, materials);
    signs.update(frameWith());
    expect(signs.pickHit(rayDownAt(12.5, 12.5))).toBeNull();
    world.fog.fill(FOG.discovered);
    signs.update(frameWith());
    expect(signs.pickHit(rayDownAt(12.5, 12.5))?.label).toBe("Coal deposit");
    signs.dispose();
  });
});
