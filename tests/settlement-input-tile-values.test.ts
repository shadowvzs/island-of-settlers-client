import { describe, expect, it } from "vitest";

import { setNavigationInvalidation } from "../src/shared/settlement/navigation-change-journal";
import { noteInputRead } from "../src/shared/settlement/settlement-input-reads";
import {
  createTileValues, renewChangedTileValues, settleTileValues, tileValue
} from "../src/shared/settlement/settlement-input-tile-values";
import { createShipSea } from "./helpers/ship-motion-scenarios";

/**
 * PERF-FOLLOWUPS: values of one search pass (a jetty's land feet) keep their results while the
 * terrain they read is unchanged; a changed height renews only the values whose reads meet it.
 */
const fixture = () => {
  const { context, world } = createShipSea(60);
  const cache = createTileValues<number>();
  let computed = 0;
  /** Two values: one reading the tiles round (5, 5), one round (30, 30). */
  const pass = (read = (x: number, z: number) => x + z) => {
    renewChangedTileValues(context, cache);
    const values = [[1, 5.5], [2, 30.5]].map(([key, at]) => tileValue(cache, key!, () => {
      computed++;
      noteInputRead(at!, at!, 1);
      return read(at!, at!);
    }));
    settleTileValues(context, cache);
    return values;
  };
  const raiseVertex = (x: number, z: number) => { world.heights[z * (world.cellsX + 1) + x]! += 1; };
  return { computed: () => computed, pass, raiseVertex, world };
};

describe("terrain tile values (PERF-FOLLOWUPS)", () => {
  it("keeps every value while the terrain is unchanged", () => {
    const { computed, pass } = fixture();
    expect(pass()).toEqual([11, 61]);
    expect(pass()).toEqual([11, 61]);
    expect(computed()).toBe(2);
  });

  it("renews only the value whose reads meet a changed vertex, then keeps it again", () => {
    const { computed, pass, raiseVertex } = fixture();
    pass();
    // Vertex (7, 7) belongs to tiles 6..7: the first value read tiles 4..6.
    raiseVertex(7, 7);
    pass();
    expect(computed()).toBe(3);
    pass();
    expect(computed()).toBe(3);
    // Vertex (8, 8) lies inside the copy but beyond both values' reads.
    raiseVertex(8, 8);
    pass();
    expect(computed()).toBe(3);
  });

  it("strict mode recomputes a kept value and throws when it read an unnoted input", () => {
    const { pass, raiseVertex, world } = fixture();
    const stride = world.cellsX + 1;
    // Reads vertex (20, 20) without noting it.
    const unnoted = (x: number) => x + world.heights[20 * stride + 20]!;
    pass(unnoted);
    raiseVertex(20, 20);
    const previous = setNavigationInvalidation({ strict: true });
    try {
      expect(() => pass(unnoted)).toThrow(/Stale tile value/);
    } finally {
      setNavigationInvalidation(previous);
    }
  });
});
