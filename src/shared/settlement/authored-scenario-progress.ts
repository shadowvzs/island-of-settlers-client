import type { AuthoredObjectUids } from "./authored-object-uids";
import { addGood } from "./production-rules";
import { findHomeBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import { ownerOf } from "./settlement-ownership";
import type { SettlementContext } from "./settlement-types";

export interface AuthoredScenarioProgress {
  patrols?: { unit: number; actor: number; next: number; wait: number }[];
  elapsed: number;
  claiming: number;
  status: "active" | "won" | "expired";
  sites: number[];
  rewardPaid: boolean;
  pendingCoins: number;
  /** Map-file object id → runtime uid of the spawned authored objects (ACT1). */
  objects?: AuthoredObjectUids;
}
/**
 * The authored adventure objective (capture/defeat, coin reward, expiry). Inert on a campaign map (C12): there the
 * map's victory rule decides and its rewards come from the campaign claim, so no scenario coins are paid (they would
 * land in the landing harbour) and no scenario outcome is announced.
 */
export const updateAuthoredScenario = (context: SettlementContext, dt: number, soldiers: () => readonly SettlementSoldier[]) => {
  const definition = context.options.world.scenario, state = context.authoredScenario;
  if (!definition || !state || state.status !== "active" || context.campaignMap) return;
  state.elapsed += dt;
  if (definition.expirySeconds > 0 && state.elapsed >= definition.expirySeconds) {
    state.status = "expired"; context.options.onScenarioOutcome?.("expired", 0); return;
  }
  const captured = state.sites.length > 0 && state.sites.every(uid =>
    !context.buildings.some(site => site.uid === uid && ownerOf(site) > 0));
  const enemies = soldiers().some(soldier => (soldier.combat?.faction ?? 0) > 0);
  const won = definition.objective === "capture" && state.sites.length ? captured : !enemies;
  if (!won) { state.claiming = 0; return; }
  state.claiming += dt;
  if (state.claiming + 1e-8 < definition.claimSeconds) return;
  state.status = "won";
  const home = findHomeBuilding(context);
  if (home) { addGood(home.inventory, "coins", definition.rewardCoins); state.rewardPaid = true; }
  else state.pendingCoins = definition.rewardCoins;
  context.options.onScenarioOutcome?.("won", definition.rewardCoins);
};
