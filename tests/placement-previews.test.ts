import { describe, expect, it, vi } from "vitest";

import { createNoSpaceNotice, noSpaceMessage } from "../src/app/build-overlay/no-space-notice";
import { createPlacementPreviews, PREVIEW_CAP } from "../src/app/build-overlay/placement-previews";
import {
  createPackingScratch, type FitSpots, isInsideQuad, packPreviewPlots, plotsOverlap
} from "../src/app/build-overlay/preview-packing";
import { getNationBuildingDefinition } from "../src/render-common/buildings/nation-building-text";
import { createCamera } from "../src/render-common/camera-state";
import type { WorldData } from "../src/shared/world/world-data";

const SIZE = 64;
/** Every top-left cell of a SIZE × SIZE grid is a valid plot of a 3 × 2 building. */
const fullSpots = (): FitSpots => ({ depth: 2, marks: new Uint8Array(SIZE * SIZE).fill(1), width: 3 });
const VIEW = [{ x: 10, z: 10 }, { x: 50, z: 10 }, { x: 50, z: 50 }, { x: 10, z: 50 }];
const topLeft = (cell: number) => ({ x: cell % SIZE, z: Math.floor(cell / SIZE) });

const pack = (spots: FitSpots, options: { cap?: number; gap?: number; focus?: { x: number; z: number } } = {}) => {
  const chosen = new Int32Array(64);
  const count = packPreviewPlots({ cap: options.cap ?? 40, cellsX: SIZE, focus: options.focus ?? { x: 30, z: 30 },
    gap: options.gap ?? 1, spots, view: VIEW }, chosen, createPackingScratch());
  return [...chosen.subarray(0, count)].map(topLeft);
};

describe("preview ghost packing", () => {
  it("never lets two chosen plots come closer than the gap", () => {
    const spots = fullSpots(), plots = pack(spots, { gap: 1 });
    expect(plots.length).toBeGreaterThan(10);
    for (const [index, plot] of plots.entries())
      for (const other of plots.slice(index + 1)) expect(plotsOverlap(spots, plot, other, 1)).toBe(false);
  });

  it("takes the plot nearest the camera centre first and stays in view", () => {
    const spots = fullSpots(), focus = { x: 21.5, z: 33 };
    const [first, ...rest] = pack(spots, { focus });
    expect(first).toEqual({ x: 20, z: 32 });
    for (const plot of [first!, ...rest]) expect(isInsideQuad(VIEW, plot.x + 1.5, plot.z + 1)).toBe(true);
  });

  it("stops at the cap and only uses valid plots", () => {
    const spots = fullSpots();
    expect(pack(spots, { cap: 5 })).toHaveLength(5);
    spots.marks.fill(0);
    spots.marks[30 * SIZE + 30] = 1;
    expect(pack(spots)).toEqual([{ x: 30, z: 30 }]);
  });

  it("tests points against a turned view quad", () => {
    const diamond = [{ x: 0, z: -2 }, { x: 2, z: 0 }, { x: 0, z: 2 }, { x: -2, z: 0 }];
    expect(isInsideQuad(diamond, 0, 0)).toBe(true);
    expect(isInsideQuad(diamond, 1.8, 1.8)).toBe(false);
  });
});

describe("placement preview frame", () => {
  const world = { cellsX: SIZE, cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2) } as unknown as WorldData;
  /** Straight down: one cell is 10 px, the plots further south are nearer the camera. */
  const renderer = { projectToViewport: (x: number, _y: number, z: number) => ({ depth: -z, x: x * 10, y: z * 10 }) };
  const camera = Object.assign(createCamera(32, 32, 1), { viewportHeight: 900, viewportWidth: 1400 });
  const input = (cursor: { x: number; z: number } | null = null, fitRevision = 1) => ({
    camera, cursor, fitRevision, nation: "roman" as const, selection: { rotation: 0, typeId: 17 }, spots: fullSpots()
  });

  it("is capped, rewritten only on changes and hides the preview under the cursor ghost", () => {
    const previews = createPlacementPreviews(world, renderer, PREVIEW_CAP.minimal);
    const frame = previews.update(input())!;
    expect(frame.count).toBe(PREVIEW_CAP.minimal);
    const revision = frame.revision;
    expect(previews.update(input())!.revision).toBe(revision);
    const cursor = { x: frame.positions[0]!, z: frame.positions[2]! };
    const hidden = previews.update(input(cursor))!;
    expect(hidden.revision).toBe(revision + 1);
    expect(hidden.count).toBe(PREVIEW_CAP.minimal - 1);
    expect(previews.update(input(cursor, 2))!.revision).toBe(revision + 2);
    expect(previews.update({ ...input(), selection: null })).toBeNull();
  });

  it("picks the preview under a screen point", () => {
    const previews = createPlacementPreviews(world, renderer, 8);
    const frame = previews.update(input())!;
    const centre = { x: frame.positions[0]!, z: frame.positions[2]! };
    expect(previews.pick(centre.x * 10, centre.z * 10)).toEqual(centre);
    expect(previews.pick(-100, -100)).toBeNull();
  });

  it("prefers the nearer preview where two pick boxes overlap", () => {
    const lifted = { projectToViewport: (x: number, y: number, z: number) => ({ depth: -z, x: x * 10, y: (z - y) * 10 }) };
    const previews = createPlacementPreviews(world, lifted, 8);
    const frame = previews.update(input())!;
    const centre = { x: frame.positions[0]!, z: frame.positions[2]! };
    // A building-high box of the plot south of it covers this centre too; the nearer (southern) one wins.
    expect(previews.pick(centre.x * 10, centre.z * 10)!.z).toBeGreaterThan(centre.z);
  });
});

describe("no space notice", () => {
  it("tells once per selection and footprint orientation", () => {
    const notify = vi.fn();
    const tell = createNoSpaceNotice(notify);
    tell({ rotation: 0, typeId: 17 }, true);
    tell({ rotation: 2, typeId: 17 }, true);
    expect(notify).toHaveBeenCalledTimes(1);
    tell({ rotation: 1, typeId: 17 }, true);
    expect(notify).toHaveBeenCalledTimes(2);
    tell({ rotation: 1, typeId: 17 }, false);
    tell(null, false);
    tell({ rotation: 0, typeId: 17 }, true);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenLastCalledWith(17);
  });

  it("names the building as the player's nation does", () => {
    const name = getNationBuildingDefinition(5, "viking").name;
    expect(noSpaceMessage(5, "viking")).toBe(`No space for ${name} in your territory`);
    expect(noSpaceMessage(10, "roman")).toMatch(/^No free surveyed deposit for .+: send a Geologist/);
  });
});
