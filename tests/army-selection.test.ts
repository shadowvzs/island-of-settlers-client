import { describe, expect, it } from "vitest";

import { boxFromCorners, isSelectableSoldierBody, nearestSoldierAt, soldiersInBox }
  from "../src/app/settlement/army-selection";
import { edgeScrollDirection } from "../src/render-common/camera-controller";
import { isPrimaryDragSelecting, setPrimaryDragSelects } from "../src/render-common/camera-input-mode";

/** A flat test projection: one tile is 10 CSS pixels, height lifts the point up the screen. */
const project = (x: number, y: number, z: number) => ({ x: x * 10, y: z * 10 - y * 10 });
const soldier = (uid: number, x: number, z: number, phase = "militaryField", mounted = false) =>
  ({ mounted, navalOrder: undefined, phase, uid, visible: true, x, y: 0, z });

describe("army selection", () => {
  it("lets soldiers walking back to storage be selected, but not stored or garrisoned ones", () => {
    expect(isSelectableSoldierBody(soldier(1, 0, 0, "retire"))).toBe(true);
    expect(isSelectableSoldierBody(soldier(1, 0, 0, "militaryMountedReturn"))).toBe(true);
    expect(isSelectableSoldierBody(soldier(1, 0, 0, "militaryReturnBlocked"))).toBe(true);
    expect(isSelectableSoldierBody({ ...soldier(1, 0, 0, "militaryReserve"), visible: false })).toBe(false);
    expect(isSelectableSoldierBody({ ...soldier(1, 0, 0, "garrison"), visible: false })).toBe(false);
    expect(isSelectableSoldierBody({ ...soldier(1, 0, 0), navalOrder: 3 })).toBe(false);
  });

  it("picks the nearest soldier under the cursor, a rider also by its raised body", () => {
    const actors = [soldier(1, 10, 10), soldier(2, 20, 10, "militaryField", true)];
    expect(nearestSoldierAt(actors, project, { x: 101, y: 95 })?.uid).toBe(1);
    expect(nearestSoldierAt(actors, project, { x: 200, y: 88 })?.uid).toBe(2);
    expect(nearestSoldierAt(actors, project, { x: 400, y: 400 })).toBeUndefined();
  });

  it("selects every soldier inside a dragged box, whichever corner it starts from", () => {
    const actors = [soldier(1, 10, 10), soldier(2, 12, 11), soldier(3, 30, 30)];
    const box = boxFromCorners({ x: 130, y: 120 }, { x: 90, y: 80 });
    expect(box).toEqual({ bottom: 120, left: 90, right: 130, top: 80 });
    expect(soldiersInBox(actors, project, box)).toEqual([1, 2]);
  });

  it("switches the left drag between panning and box selection", () => {
    expect(isPrimaryDragSelecting()).toBe(false);
    setPrimaryDragSelects(true); expect(isPrimaryDragSelecting()).toBe(true);
    setPrimaryDragSelects(false); expect(isPrimaryDragSelecting()).toBe(false);
  });

  it("scrolls at the screen edges only", () => {
    const bounds = { bottom: 800, left: 0, right: 1200, top: 0 };
    expect(edgeScrollDirection(bounds, { x: 600, y: 400 })).toEqual({ x: 0, y: 0 });
    expect(edgeScrollDirection(bounds, { x: 5, y: 795 })).toEqual({ x: -1, y: 1 });
    expect(edgeScrollDirection(bounds, { x: 1195, y: 3 })).toEqual({ x: 1, y: -1 });
    expect(edgeScrollDirection(bounds, { x: 1300, y: 400 })).toEqual({ x: 0, y: 0 });
  });
});
