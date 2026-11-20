import { TRIPO_ROSTER } from "@workers/tripo-roster";
import { describe, expect, it } from "vitest";

import { randomWorkerAppearances, WORKER_NATIONS } from "../src/render-common/workers/worker-appearance";
import {
  assignFormationSlots,
  FORMATION_SPACING,
  listFormationSlots
} from "../src/render-common/workers/worker-formation";

const everywhere = () => true;
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("formation slots", () => {
  it("puts the first slot on the target and spreads the rest around it", () => {
    const slots = listFormationSlots({ x: 10, z: 10 }, 5, everywhere);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual({ x: 10, z: 10 });
    for (let a = 0; a < slots.length; a++)
      for (let b = a + 1; b < slots.length; b++)
        expect(distance(slots[a]!, slots[b]!)).toBeGreaterThan(FORMATION_SPACING * 0.99);
    for (const slot of slots) expect(distance(slot, slots[0]!)).toBeLessThan(1.7);
  });
  it("only uses free ground and gives up when the target is blocked", () => {
    const eastOnly = (x: number) => x >= 10;
    const slots = listFormationSlots({ x: 10, z: 10 }, 5, eastOnly);
    expect(slots).toHaveLength(5);
    expect(slots.every((slot) => slot.x >= 10)).toBe(true);
    expect(listFormationSlots({ x: 5, z: 10 }, 5, eastOnly)).toEqual([]);
  });
  it("returns fewer slots when the free ground is small", () => {
    const tiny = (x: number, z: number) => Math.hypot(x - 10, z - 10) < 0.1;
    expect(listFormationSlots({ x: 10, z: 10 }, 5, tiny)).toEqual([{ x: 10, z: 10 }]);
  });
});

describe("slot assignment", () => {
  it("pairs each worker with a near slot, no slot twice", () => {
    const workers = [
      { x: 0, z: 0 },
      { x: 10, z: 0 }
    ];
    const slots = [
      { x: 9, z: 0 },
      { x: 1, z: 0 }
    ];
    expect(assignFormationSlots(workers, slots)).toEqual([1, 0]);
  });
  it("lets extra workers share the centre slot", () => {
    const workers = [
      { x: 0, z: 0 },
      { x: 5, z: 0 }
    ];
    expect(assignFormationSlots(workers, [{ x: 1, z: 0 }])).toEqual([0, 0]);
    expect(assignFormationSlots(workers, [])).toEqual([-1, -1]);
  });
});

describe("group appearances", () => {
  const sequence = (values: number[]) => {
    let index = 0;
    return () => values[index++ % values.length]!;
  };
  it("gives every worker the chosen nation and a distinct body while the nation has them", () => {
    const appearances = randomWorkerAppearances(5, "viking", sequence([0.3, 0.7, 0.1]));
    expect(appearances.every(({ nation }) => nation === "viking")).toBe(true);
    expect(new Set(appearances.map(({ variant }) => variant)).size).toBe(5);
  });
  it("mixes women and men of the nation's Tripo bodies", () => {
    const appearances = randomWorkerAppearances(4, "japanese", sequence([0.6, 0.2]));
    const { female, male }: Record<"female" | "male", readonly string[]> = TRIPO_ROSTER.japanese;
    const women = appearances.filter(({ variant }) => female.includes(variant));
    const men = appearances.filter(({ variant }) => male.includes(variant));
    expect([women.length, men.length]).toEqual([2, 2]);
  });
  it("picks one random nation, Nubian included, when none is chosen", () => {
    const nationRoll = (WORKER_NATIONS.indexOf("nubian") + .5) / WORKER_NATIONS.length;
    const appearances = randomWorkerAppearances(5, undefined, sequence([nationRoll, 0.5]));
    expect(new Set(appearances.map(({ nation }) => nation))).toEqual(new Set(["nubian"]));
    expect(appearances.every(({ variant }) => variant.startsWith("nubian-"))).toBe(true);
  });
});
