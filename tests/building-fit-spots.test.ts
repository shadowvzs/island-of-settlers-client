import { describe, expect, it, vi } from "vitest";

import { createBuildingFitSpots, listFitCandidates } from "../src/app/build-overlay/building-fit-spots";
import { rotatedFootprint } from "../src/app/settlement/building-plot";
import { createPlacementCheck, placementRevisionKey } from "../src/app/settlement/placement-check";
import type { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { WorldData } from "../src/shared/world/world-data";
import { createPlacementSession, PLACEMENT_SIZE } from "./helpers/placement-session";

const SIZE = PLACEMENT_SIZE;
const session = createPlacementSession;

/** Every top-left cell of the grid where the shared validator accepts the plot. */
const bruteForce = (
  world: WorldData, simulation: ReturnType<typeof createSettlementSimulation>, typeId: number, rotation: number
) => {
  const { depth, width } = rotatedFootprint(typeId, rotation);
  const valid: number[] = [];
  for (let z = 0; z + depth <= SIZE; z++)
    for (let x = 0; x + width <= SIZE; x++)
      if (simulation.validatePlacement(typeId, x + width / 2, z + depth / 2, rotation) === null)
        valid.push(z * SIZE + x);
  return valid;
};

const markedCells = (marks: Uint8Array) => [...marks.keys()].filter((cell) => marks[cell]! > 0);

describe("building fit spots", () => {
  const { simulation, world } = session();
  const owned = () => simulation.territory().owned;

  it.each([[17, 0], [2, 1], [29, 3]])("marks exactly the plots the validator accepts (%s, turn %s)",
    (typeId, rotation) => {
      const spots = createBuildingFitSpots({ getOwnership: owned, validatePlacement: simulation.validatePlacement,
        world });
      spots.update({ rotation, typeId }, "r", undefined, Infinity);
      expect(spots.isScanning()).toBe(false);
      const markers = spots.markers()!;
      const expected = bruteForce(world, simulation, typeId, rotation);
      expect(expected.length).toBeGreaterThan(100);
      expect(markedCells(markers.marks)).toEqual(expected);
      expect(markers.marks.every((mark) => mark === 0 || mark === 1)).toBe(true);
      expect(spots.noSpace()).toBe(false);
    });

  it("prefilters water, foreign territory and the grid edge before the full validator", () => {
    const { depth, width } = rotatedFootprint(17, 0);
    const candidates = [...listFitCandidates(world, owned(), width, depth, false)];
    const lake = 50 * SIZE + 66;
    expect(candidates).not.toContain(lake);
    expect(candidates.every((cell) => owned()[cell] === 1)).toBe(true);
    expect(candidates.length).toBeLessThan(owned().reduce((sum, value) => sum + value, 0));
  });

  it("caches a scan until the building, rotation or placement revision changes", () => {
    const validate = vi.fn(simulation.validatePlacement);
    const spots = createBuildingFitSpots({ getOwnership: owned, validatePlacement: validate, world });
    const first = spots.update({ rotation: 0, typeId: 17 }, "a", undefined, Infinity);
    const calls = validate.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(spots.update({ rotation: 0, typeId: 17 }, "a", undefined, Infinity)).toBe(first);
    expect(spots.update({ rotation: 4, typeId: 17 }, "a", undefined, Infinity)).toBe(first);
    expect(validate.mock.calls.length).toBe(calls);
    spots.update({ rotation: 1, typeId: 17 }, "a", undefined, Infinity);
    expect(validate.mock.calls.length).toBeGreaterThan(calls);
    spots.update(null, "a");
    expect(spots.markers()).toBeNull();
  });

  it("time slices a scan and keeps showing the previous markers while a revision rescans", () => {
    let clock = 0;
    const validate = vi.fn((...args: Parameters<typeof simulation.validatePlacement>) => {
      clock += 0.01;
      return simulation.validatePlacement(...args);
    });
    const spots = createBuildingFitSpots({ getOwnership: owned, now: () => clock, validatePlacement: validate,
      world });
    spots.update({ rotation: 0, typeId: 17 }, "a", undefined, 1);
    expect(spots.isScanning()).toBe(true);
    expect(validate.mock.calls.length).toBeLessThan(200);
    while (spots.isScanning()) spots.update({ rotation: 0, typeId: 17 }, "a", undefined, 1);
    const finished = spots.markers()!.marks;
    spots.update({ rotation: 0, typeId: 17 }, "b", undefined, 1);
    expect(spots.isScanning()).toBe(true);
    expect(spots.markers()!.marks).toBe(finished);
    // Revisions changing during a rescan never restart it: it completes, then catches up.
    for (let step = 0; spots.isScanning(); step++)
      spots.update({ rotation: 0, typeId: 17 }, `c${step}`, undefined, 1);
    expect(spots.markers()!.marks).not.toBe(finished);
  });

  it("validates the plots nearest the camera first", () => {
    let clock = 0;
    const spots = createBuildingFitSpots({ getOwnership: owned, now: () => clock, world,
      validatePlacement: (...args) => { clock += 0.01; return simulation.validatePlacement(...args); } });
    const focus = { x: 30, z: 70 };
    spots.update({ rotation: 0, typeId: 17 }, "a", focus, 1);
    const marked = markedCells(spots.markers()!.marks);
    expect(marked.length).toBeGreaterThan(10);
    expect(marked.every((cell) => Math.hypot(cell % SIZE + 2 - focus.x, Math.floor(cell / SIZE) + 2 - focus.z) < 8))
      .toBe(true);
  });

  it("reports no space only after a complete scan that found no plot", () => {
    let clock = 0;
    const validate = vi.fn(() => {
      clock += 0.01;
      return "Plot overlaps an existing road";
    });
    const spots = createBuildingFitSpots({ getOwnership: owned, now: () => clock, validatePlacement: validate,
      world });
    spots.update({ rotation: 0, typeId: 17 }, "a", undefined, 1);
    expect(spots.isScanning()).toBe(true);
    expect(spots.noSpace()).toBe(false);
    while (spots.isScanning()) spots.update({ rotation: 0, typeId: 17 }, "a", undefined, 1);
    expect(spots.noSpace()).toBe(true);
  });

  it("reports no space at once when no plot passes the prefilter", () => {
    const spots = createBuildingFitSpots({ getOwnership: () => new Uint8Array(SIZE * SIZE),
      validatePlacement: simulation.validatePlacement, world });
    spots.update({ rotation: 0, typeId: 17 }, "a");
    expect(spots.isScanning()).toBe(false);
    expect(spots.noSpace()).toBe(true);
  });
});

describe("placement check", () => {
  it("validates a plot once while the pointer stays on it and the world is unchanged", () => {
    const { simulation, world } = session();
    const validate = vi.spyOn(simulation, "validatePlacement");
    const check = createPlacementCheck(simulation, world, () => 0);
    const first = check(17, { x: 30.2, z: 30.3 }, 0);
    expect(check(17, { x: 30.3, z: 30.2 }, 0)).toBe(first);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(first.ghost).toMatchObject({ nation: "roman", type: 17, valid: first.reason === null });
    const rotated = check(17, { x: 30.3, z: 30.2 }, 1);
    expect(rotated.ghost.rotation).toBeCloseTo(Math.PI / 2);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("rescans fit markers and re-validates when crop or plantation plots change", () => {
    const { simulation, world } = session();
    let plots = 0;
    vi.spyOn(simulation, "navigationRevision").mockImplementation(() => plots);
    const validate = vi.spyOn(simulation, "validatePlacement");
    const check = createPlacementCheck(simulation, world, () => 0);
    const before = placementRevisionKey(simulation);
    check(17, { x: 30.2, z: 30.3 }, 0);
    plots++;
    expect(placementRevisionKey(simulation)).not.toBe(before);
    check(17, { x: 30.2, z: 30.3 }, 0);
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
