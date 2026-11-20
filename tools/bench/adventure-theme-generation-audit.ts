import assert from "node:assert/strict";

import { adventureOffers } from "../../src/shared/settlement/adventure-rules";
import { ADVENTURE_THEMES } from "../../src/shared/settlement/adventure-themes";
import { chooseAdventureWorld } from "../../src/shared/settlement/colony-world-choice";

/** Deterministic hard-island audit: every chart must pass normal full-camp infantry/cavalry checks. */
const seeds = Number(process.env.SEEDS ?? 12);
for (const theme of ADVENTURE_THEMES) {
  let longest = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const island = { ...adventureOffers(seed)[0]!, theme, difficulty: "hard" as const };
    const started = performance.now();
    const world = chooseAdventureWorld(island);
    assert.equal(world.adventureTheme, theme);
    longest = Math.max(longest, performance.now() - started);
  }
  console.log(`${theme}: ${seeds} hard islands charted; slowest ${longest.toFixed(0)} ms`);
}
