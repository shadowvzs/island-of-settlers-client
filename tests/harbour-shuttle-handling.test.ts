import { describe, expect, it } from "vitest";

import { LIGHTER_BEAM } from "../src/render-common/ships/lighter-dimensions";
import { shuttleBoatContact, shuttleGangwayContact, shuttleHandling } from "../src/shared/settlement/harbour-shuttle-handling";

/** A narrow work deck has no passing bay; this exercises the complete maximum-load clock. */
describe("finite shuttle boatmen handling", () => {
  it.each([false, true])("keeps four boxes and two people physically ordered (unloading=%s)", unloading => {
    const duration = shuttleHandling(4, 8, unloading, 0, 2).seconds;
    let carrying = false, indoors = false;
    const observedBoxes = new Set<number>();
    for (let time = 0; time <= duration + .02; time += .01) {
      const work = shuttleHandling(4, 8, unloading, time, 2);
      observedBoxes.add(work.boxes);
      const active = work.places.filter(place => place !== null);
      expect(active.length + work.aboard.filter(Boolean).length).toBeLessThanOrEqual(2);
      const walking = active.filter(place => place.moving);
      expect(new Set(walking.map(place => place.outward)).size).toBeLessThanOrEqual(1);
      carrying ||= walking.some(place => place.carrying);
      indoors ||= work.places.some((place, index) => !place && !work.aboard[index]);
    }
    expect(carrying).toBe(true); expect(indoors).toBe(true);
    expect([...observedBoxes].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(shuttleHandling(4, 8, unloading, duration + 1, 2)).toMatchObject({
      aboard: [true, true], boxes: unloading ? 0 : 4, places: [null, null]
    });
  });
  it.each([false, true])("handles the maximum four crates with exactly one finite paddler (unloading=%s)", unloading => {
    const seconds = shuttleHandling(4, 8, unloading, 0).seconds, counts = new Set<number>();
    for (let time = 0; time <= seconds + .02; time += .01) {
      const work = shuttleHandling(4, 8, unloading, time);
      expect(work.places).toHaveLength(1); expect(work.aboard).toHaveLength(1);
      expect(work.places.filter(Boolean).length + work.aboard.filter(Boolean).length).toBeLessThanOrEqual(1);
      counts.add(work.boxes);
    }
    expect([...counts].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(shuttleHandling(4, 8, unloading, seconds + 1)).toMatchObject({ aboard: [true], places: [null], boxes: unloading ? 0 : 4 });
  });
  it("keeps the second empty boatman behind a one-box carrier during final setdown", () => {
    const duration = shuttleHandling(1, 8, false, 0, 2).seconds;
    let witnessed = false;
    for (let time = 0; time < duration; time += .01) {
      const { places } = shuttleHandling(1, 8, false, time, 2), a = places[0], b = places[1];
      if (a && b && (a.moving || b.moving)) {
        witnessed = true; expect(Math.abs(a.share - b.share) * 8).toBeGreaterThan(.43);
      }
    }
    expect(witnessed).toBe(true);
  });
  it("hands cargo at the gunwale, matching the gangway instead of entering the central crate grid", () => {
    const contact = shuttleBoatContact({ x: 10, z: 10 }, { x: 10, z: 14 });
    expect(contact.x).toBe(10);
    expect(contact.z - 10).toBeCloseTo(LIGHTER_BEAM / 2 + .05);
    // Four crates occupy ±.32 across the hull; even a .15 foot clearance stays outside them.
    expect(contact.z - 10 - .15).toBeGreaterThan(.32);
    const board = shuttleGangwayContact({ x: 10, z: 10 }, { x: 10, z: 14 });
    expect(board.z).toBeLessThan(contact.z);
    expect(board.z - 10).toBeLessThan(LIGHTER_BEAM / 2);
  });
});
