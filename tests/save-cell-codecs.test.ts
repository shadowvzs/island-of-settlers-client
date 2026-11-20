import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "../../island-of-settlers-shared/src/save-map-delta";
import {
  flushSavedOccupancy,
  isSparseCells,
  packBits,
  packFog,
  packSparseCells,
  savedOccupancy,
  unpackBitCells,
  unpackFog,
  unpackSparseCells
} from "../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";

describe("packed fog", () => {
  it("restores every cell, including partial bytes", () => {
    for (let length = 0; length <= 33; length += 1) {
      const fog = Uint8Array.from({ length }, (_, cell) => cell % 3);
      const packed = packFog(fog);
      expect(packed.length).toBe(length);
      expect(unpackFog(packed, length)).toEqual(fog);
    }
  });

  it("stores four cells per byte", () => {
    expect(packFog(new Uint8Array([2, 1, 0, 2, 1])).packed).toBe("hgE=");
  });

  it("rejects corrupt states", () => {
    expect(() => packFog([3])).toThrow("Invalid saved fog");
    expect(() => unpackFog({ length: 1, packed: "/w==" }, 1)).toThrow("Invalid saved fog");
    expect(() => unpackFog({ length: 9, packed: "AA==" }, 9)).toThrow("Invalid saved fog");
    expect(() => unpackFog({ length: 4, packed: "AA==" }, 8)).toThrow("Invalid saved fog");
    expect(() => unpackFog([0, 1], 2)).toThrow("Invalid saved fog");
  });
});

describe("bit sets", () => {
  it("round trips the matching cells", () => {
    const values = Uint8Array.from({ length: 19 }, (_, cell) => (cell % 5 === 0 ? 2 : 1));
    const bits = packBits(values, 2);
    expect(bits.length).toBe(19);
    expect(unpackBitCells(bits, 19)).toEqual([0, 5, 10, 15]);
  });

  it("stores one bit per cell", () => {
    expect(packBits(new Uint8Array(1_048_576), 2).bits.length).toBe(Math.ceil(131_072 / 3) * 4);
  });

  it("rejects a stray bit past the last cell and a wrong length", () => {
    const stray = { bits: bytesToBase64(new Uint8Array([0, 0b100])), length: 10 };
    expect(() => unpackBitCells(stray, 10)).toThrow("Invalid saved bit set");
    expect(() => unpackBitCells(packBits(new Uint8Array(8), 2), 16)).toThrow("Invalid saved bit set");
  });
});

describe("sparse cells", () => {
  it("round trips and stores only the non-zero cells", () => {
    const grid = new Uint8Array(100);
    grid[0] = 1;
    grid[7] = 2;
    grid[99] = 1;
    const sparse = packSparseCells(grid);
    expect(sparse).toEqual({ cells: [1, 1, 7, 2, 92, 1], length: 100 });
    expect(unpackSparseCells(sparse, 100)).toEqual(grid);
  });

  it("keeps a 1024 x 1024 grid far below the API node cap", () => {
    const grid = new Uint8Array(1024 * 1024);
    for (let cell = 0; cell < grid.length; cell += 997) grid[cell] = 1 + (cell % 2);
    expect(packSparseCells(grid).cells.length).toBeLessThan(2200);
  });

  it("rejects malformed cells", () => {
    expect(isSparseCells({ cells: [1, 1], length: 10 }, 10)).toBe(true);
    expect(isSparseCells({ cells: [1, 1], length: 9 }, 10)).toBe(false);
    expect(isSparseCells({ cells: [1], length: 10 }, 10)).toBe(false);
    expect(isSparseCells({ cells: [0, 1], length: 10 }, 10)).toBe(false);
    expect(isSparseCells({ cells: [1, 0], length: 10 }, 10)).toBe(false);
    expect(isSparseCells({ cells: [1, 3], length: 10 }, 10)).toBe(false);
    expect(isSparseCells({ cells: [10, 1], length: 10 }, 10)).toBe(true);
    expect(isSparseCells({ cells: [11, 1], length: 10 }, 10)).toBe(false);
    expect(isSparseCells({ cells: [1.5, 1], length: 10 }, 10)).toBe(false);
    expect(isSparseCells(undefined, 10)).toBe(false);
    expect(() => unpackSparseCells({ cells: [3, 1, 0, 1], length: 10 }, 10)).toThrow("Invalid saved occupancy");
  });
});

describe("working occupancy of a saved settlement", () => {
  const settlement = () => ({ occupied: packSparseCells(new Uint8Array(16).fill(0)),
    world: { cellsX: 4, cellsZ: 4, seed: 1 } }) as unknown as SettlementSaveV1;

  it("decodes once, shows writers' changes and writes them back on flush", () => {
    const saved = settlement();
    const grid = savedOccupancy(saved);
    expect(savedOccupancy(saved)).toBe(grid);
    grid[5] = 1;
    expect(saved.occupied.cells).toEqual([]);
    flushSavedOccupancy(saved);
    expect(saved.occupied).toEqual({ cells: [6, 1], length: 16 });
    expect(savedOccupancy(saved)).toBe(grid);
  });

  it("decodes again when the saved form was replaced", () => {
    const saved = settlement();
    const first = savedOccupancy(saved);
    saved.occupied = packSparseCells(Uint8Array.from({ length: 16 }, (_, cell) => (cell === 2 ? 2 : 0)));
    const second = savedOccupancy(saved);
    expect(second).not.toBe(first);
    expect(second[2]).toBe(2);
  });
});
