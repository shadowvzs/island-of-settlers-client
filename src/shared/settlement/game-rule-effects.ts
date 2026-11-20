import { markFogChanged } from "../world/fog-revision";
import { FOG, type WorldData } from "../world/world-data";
import type { SettlementContext } from "./settlement-types";
import { rulesOf } from "./sim-rules";

/**
 * Fog of war off (owner Q9, plan §8.6): the island's fog and its permanent (starting) sight become visible, so
 * live sight never fades a cell back. Switching fog on again never re-hides a cell (no rollback of knowledge).
 * Writes `permanentFog` in place: the simulation's player fog (player-fog.ts) reads that array.
 */
const revealWorldFog = (world: WorldData) => {
  if (!world.fog) return false;
  const permanent = world.permanentFog ?? (world.permanentFog = world.fog.slice());
  let changed = false;
  for (let cell = 0; cell < world.fog.length; cell++) {
    if (world.fog[cell] === FOG.visible && permanent[cell] === FOG.visible) continue;
    world.fog[cell] = FOG.visible;
    permanent[cell] = FOG.visible;
    changed = true;
  }
  if (changed) markFogChanged(world, true);
  return changed;
};

/**
 * The state consequences of the island's rules (GS4a). Runs at island creation, at the end of every restore and
 * after a successful `adoptGameRules`, so a save whose pin changed without a command (server catch-up, GS2) reaches
 * the same state on load. Idempotent: the default rules change nothing.
 */
export const applyGameRuleEffects = (context: SettlementContext) => {
  const rules = rulesOf(context);
  if (!rules.fogOfWar) revealWorldFog(context.options.world);
  if (!rules.trade) context.trade?.applyRules();
};
