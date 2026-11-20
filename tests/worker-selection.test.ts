import { describe, expect, it } from "vitest";

import {
  isWorkerUnderPointer,
  listWorkersInBox,
  pickWorkerAt,
  selectionAfterClick,
  toScreenBox
} from "../src/app/worker-selection";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";

type Projector = Pick<TerrainRenderer, "projectToViewport">;

/** A straight-down test camera: x and z map to screen pixels, height lifts the point. */
const topDown: Projector = {
  projectToViewport: (x: number, y: number, z: number) => ({
    depth: 0,
    x: x * 10,
    y: z * 10 - y * 40
  })
};

const workerAt = (x: number, z: number, selected = false) =>
  ({ selected, x, y: 0, z }) as WorkerFrame;

describe("worker screen picking", () => {
  const worker = { x: 30, y: 0, z: 30 } as WorkerFrame;
  const renderer = (depth: number): Projector => ({
    projectToViewport: (_x: number, y: number, _z: number) => ({ x: 100, y: 200 - y * 40, depth })
  });

  it.each([-0.5, -40])("accepts visible workers at any depth %s", (depth) => {
    expect(isWorkerUnderPointer(renderer(depth), worker, 100, 185)).toBe(true);
    expect(isWorkerUnderPointer(renderer(depth), worker, 130, 185)).toBe(false);
  });
  it("rejects a projection before the renderer has a camera", () => {
    const unready = { projectToViewport: () => ({ x: NaN, y: NaN, depth: 0 }) };
    expect(isWorkerUnderPointer(unready, worker, 100, 185)).toBe(false);
  });
  it("picks the overlapping worker standing nearest the camera (lowest on screen)", () => {
    const workers = [workerAt(10, 10), workerAt(10, 10.5), workerAt(30, 30)];
    expect(pickWorkerAt(topDown, workers, 100, 90)).toBe(1);
    expect(pickWorkerAt(topDown, workers, 200, 200)).toBe(-1);
  });
});

describe("box selection", () => {
  it("normalises a drag in any direction", () => {
    expect(toScreenBox(50, 80, 10, 20)).toEqual({ bottom: 80, left: 10, right: 50, top: 20 });
  });
  it("selects the workers whose projected body centre is inside the box", () => {
    const workers = [workerAt(10, 10), workerAt(12, 11), workerAt(30, 30)];
    // Body centres on screen: (100, ~79), (120, ~89), (300, ~279).
    const box = toScreenBox(90, 70, 130, 100);
    expect(listWorkersInBox(topDown, workers, box)).toEqual([true, true, false]);
  });
  it("selects nobody with an empty box", () => {
    const workers = [workerAt(10, 10)];
    expect(listWorkersInBox(topDown, workers, toScreenBox(0, 0, 5, 5))).toEqual([false]);
  });
});

describe("click selection", () => {
  const workers = [workerAt(1, 1, true), workerAt(2, 2), workerAt(3, 3, true)];
  it("selects only the clicked worker, or nobody on empty ground", () => {
    expect(selectionAfterClick(workers, 1, false)).toEqual([false, true, false]);
    expect(selectionAfterClick(workers, -1, false)).toEqual([false, false, false]);
  });
  it("toggles one worker with Shift and keeps the others", () => {
    expect(selectionAfterClick(workers, 1, true)).toEqual([true, true, true]);
    expect(selectionAfterClick(workers, 0, true)).toEqual([false, false, true]);
    expect(selectionAfterClick(workers, -1, true)).toEqual([true, false, true]);
  });
});
