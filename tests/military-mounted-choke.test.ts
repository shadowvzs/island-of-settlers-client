import { expect, it } from "vitest";

import { runFieldBattle } from "../tools/bench/military-playtest-scenarios";

it("resolves a cavalry battle through a four-tile passage without choosing foot-only attack slots", () => {
  const battle = runFieldBattle("narrow-gap", "cavalry", 19);
  expect(battle.seconds).toBeLessThan(300);
  expect(Math.min(battle.player, battle.enemy)).toBe(0);
  // SAVE-DRIFT 2026-11-11: the scenario's reloads at 20 s and 60 s are now exact, so this is the uninterrupted
  // battle (its longest quiet contact is 11 s); the old bound of 10 held only on the drifted reloads.
  expect(battle.longestQuietContact).toBeLessThan(15);
  expect(battle.checkpoint).toBeUndefined();
}, 60000);
