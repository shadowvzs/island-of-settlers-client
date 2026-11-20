import assert from "node:assert/strict";

import { ADVENTURE_THEMES } from "../../src/shared/settlement/adventure-themes";
import { colonyIslandOffers } from "../../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../../src/shared/settlement/colony-world-choice";

/** Deterministic hard-island audit: every chart must pass normal full fort and reachable economy checks. */
const seeds = Number(process.env.SEEDS ?? 6);
for (const theme of ADVENTURE_THEMES) {
  let longest = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const island = { ...colonyIslandOffers(seed)[0]!, theme, difficulty: "hard" as const };
    const started = performance.now();
    const world = chooseColonyWorld(island);
    assert.equal(world.expeditionTheme, theme);
    longest = Math.max(longest, performance.now() - started);
  }
  console.log(`${theme}: ${seeds} hard islands charted; slowest ${longest.toFixed(0)} ms`);
}
