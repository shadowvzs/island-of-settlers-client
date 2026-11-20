import { describe, expect, it } from "vitest";

import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { enemyNationFor } from "../src/shared/settlement/enemy-nation";

const NATIONS: readonly WorkerNation[] = [
  "roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"
];

describe("enemy nation", () => {
  it("is never the player's nation and stays the same for an island", () => {
    for (const player of NATIONS)
      for (let seed = 0; seed < 200; seed++) {
        const enemy = enemyNationFor(player, seed * 7919);
        expect(enemy).not.toBe(player);
        expect(enemyNationFor(player, seed * 7919)).toBe(enemy);
      }
  });

  it("varies between islands over all the other nations", () => {
    for (const player of NATIONS) {
      const seen = new Set(Array.from({ length: 60 }, (_, seed) => enemyNationFor(player, seed * 104729 + 1)));
      expect(seen.size).toBe(NATIONS.length - 1);
    }
  });
});
