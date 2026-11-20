import { describe, expect, it } from "vitest";

import { hasKnownMineDeposit } from "../src/app/build-overlay/build-spots";
import {
  getMineOutlineKey,
  traceCellOutlines,
  traceMineOutlines
} from "../src/app/build-overlay/mine-outline";
import { findMineZoneAt, getMineFieldLabel } from "../src/app/build-overlay/mine-tooltip";
import {
  FOG,
  type MineZone,
  NO_MINE_ZONE,
  ORE,
  type WorldData
} from "../src/shared/world/world-data";

/** A grid from rows of characters: "." outside, any other character its own group. */
const parseGrid = (rows: string[]) => {
  const grid = { cellsX: rows[0]!.length, cellsZ: rows.length };
  const cells = rows.join("");
  const groupOf = (cell: number) => (cells[cell] === "." ? 0 : cells.charCodeAt(cell));
  return { grid, groupOf };
};

const toCorners = (points: number[]) =>
  Array.from({ length: points.length / 2 }, (_, index) => [
    points[index * 2],
    points[index * 2 + 1]
  ]);

/** Every step of a loop moves one cell side along x or z, and the last step closes it. */
const isClosedCellLoop = (points: number[]) => {
  const corners = toCorners(points);
  return corners.every(([x, z], index) => {
    const [nextX, nextZ] = corners[(index + 1) % corners.length]!;
    return Math.abs(nextX! - x!) + Math.abs(nextZ! - z!) === 1;
  });
};

/** Signed area of a loop (shoelace, x right, z down): positive clockwise on screen. */
const getSignedArea = (points: number[]) => {
  const corners = toCorners(points);
  return corners.reduce((sum, [x, z], index) => {
    const [nextX, nextZ] = corners[(index + 1) % corners.length]!;
    return sum + (x! * nextZ! - nextX! * z!) / 2;
  }, 0);
};

describe("mine field outline", () => {
  it("traces one closed loop around a block, along the map edge too", () => {
    const { grid, groupOf } = parseGrid(["aa..", "aa..", "...."]);
    const outlines = traceCellOutlines(grid, groupOf);
    expect(outlines).toHaveLength(1);
    const [outline] = outlines;
    expect(outline!.points).toHaveLength(16);
    expect(isClosedCellLoop(outline!.points)).toBe(true);
    expect(getSignedArea(outline!.points)).toBe(4);
    expect([outline!.minX, outline!.minZ, outline!.maxX, outline!.maxZ]).toEqual([0, 0, 2, 2]);
  });

  it("traces a hole as its own loop, turning the other way", () => {
    const { grid, groupOf } = parseGrid(["aaaa", "a..a", "aaaa"]);
    const outlines = traceCellOutlines(grid, groupOf);
    expect(outlines).toHaveLength(2);
    expect(outlines.every(({ points }) => isClosedCellLoop(points))).toBe(true);
    const areas = outlines.map(({ points }) => getSignedArea(points)).sort((a, b) => a - b);
    expect(areas).toEqual([-2, 12]);
  });

  it("gives every group its own loops and keeps loops closed at a pinched corner", () => {
    const groups = parseGrid(["aab", "aab"]);
    const outlines = traceCellOutlines(groups.grid, groups.groupOf);
    expect(outlines.map(({ group }) => String.fromCharCode(group)).sort()).toEqual(["a", "b"]);
    const pinched = parseGrid(["a.", ".a"]);
    const loops = traceCellOutlines(pinched.grid, pinched.groupOf);
    expect(loops.every(({ points }) => isClosedCellLoop(points))).toBe(true);
    const corners = loops.reduce((sum, { points }) => sum + points.length / 2, 0);
    expect(corners).toBe(8);
  });

  it("outlines the mine land as one region and only surveyed ore deposits on their own", () => {
    const zones: MineZone[] = [
      { cellCount: 0, centreX: 0, centreZ: 0, id: 1, ore: ORE.none, richness: 0, surveyed: true },
      { cellCount: 0, centreX: 0, centreZ: 0, id: 2, ore: ORE.iron, richness: 1, surveyed: true },
      { cellCount: 0, centreX: 0, centreZ: 0, id: 3, ore: ORE.gold, richness: 1, surveyed: false }
    ];
    const rows = ["11111", "12213", "11113"];
    const mineZone = Uint16Array.from(rows.join(""), (id) => Number(id) || NO_MINE_ZONE);
    const world = { cellsX: 5, cellsZ: 3, mineZone, mineZones: zones } as unknown as WorldData;
    const outlines = traceMineOutlines(world);
    expect(outlines.mineLand).toHaveLength(1);
    expect(outlines.deposits).toHaveLength(1);
    const [iron] = outlines.deposits;
    expect(iron!.ore).toBe(ORE.iron);
    expect(iron!.outlines.map(({ group }) => group)).toEqual([2]);
  });
});

describe("mine field tooltip", () => {
  it("tells nothing before a survey, then the ore and richness or that it is barren", () => {
    const gold = { ore: ORE.gold, richness: 0.8 };
    expect(getMineFieldLabel({ ...gold, surveyed: false })).toBe("Unsurveyed mine field");
    expect(getMineFieldLabel({ ore: ORE.none, richness: 0, surveyed: false })).toBe(
      "Unsurveyed mine field"
    );
    expect(getMineFieldLabel({ ...gold, surveyed: true })).toBe("Gold deposit, rich (80 %)");
    expect(getMineFieldLabel({ ore: ORE.coal, richness: 0.2, surveyed: true })).toBe(
      "Coal deposit, poor (20 %)"
    );
    expect(getMineFieldLabel({ ore: ORE.none, richness: 0, surveyed: true })).toBe(
      "Barren mine field (no ore)"
    );
  });
});

describe("mine knowledge and fog boundaries", () => {
  const fixture = () =>
    ({
      cellsX: 3,
      cellsZ: 1,
      mineZone: Uint16Array.of(1, 1, 2),
      fog: Uint8Array.of(FOG.visible, FOG.hidden, FOG.visible),
      mineZones: [
        { id: 1, ore: ORE.gold, richness: 0.8, surveyed: true },
        { id: 2, ore: ORE.iron, richness: 0.4, surveyed: false }
      ]
    }) as unknown as WorldData;

  it("clips ore and land outlines to explored cells and prevents hidden hover knowledge", () => {
    const world = fixture(),
      result = traceMineOutlines(world);
    expect(result.mineLand).toHaveLength(2);
    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]!.outlines[0]!.maxX).toBe(1);
    expect(findMineZoneAt(world, 1.5, 0.5)).toBeNull();
    expect(getMineFieldLabel(findMineZoneAt(world, 2.5, 0.5)!)).toBe("Unsurveyed mine field");
  });

  it("invalidates when surveyed identities swap at the same count or fog changes", () => {
    const world = fixture(),
      initial = getMineOutlineKey(world);
    world.mineZones[0]!.surveyed = false;
    world.mineZones[1]!.surveyed = true;
    expect(getMineOutlineKey(world)).not.toBe(initial);
    const swapped = getMineOutlineKey(world);
    world.fogRevision = 1;
    expect(getMineOutlineKey(world)).not.toBe(swapped);
  });
});

it("hides type-specific slots until a visible matching deposit is surveyed", () => {
  const world = {
    cellsX: 1,
    cellsZ: 1,
    mineZone: Uint16Array.of(1),
    fog: Uint8Array.of(FOG.visible),
    oreAmount: Uint8Array.of(10),
    mineZones: [{ id: 1, ore: ORE.gold, surveyed: false }]
  } as unknown as WorldData;
  const plot = { x: 0.5, z: 0.5, width: 1, depth: 1 };
  expect(hasKnownMineDeposit(world, 13, plot)).toBe(false);
  world.mineZones[0]!.surveyed = true;
  expect(hasKnownMineDeposit(world, 13, plot)).toBe(true);
  expect(hasKnownMineDeposit(world, 11, plot)).toBe(false);
  world.fog[0] = FOG.hidden;
  expect(hasKnownMineDeposit(world, 13, plot)).toBe(false);
});
