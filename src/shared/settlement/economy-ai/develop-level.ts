import { DEVELOP_LEVEL_SCALING } from "../../balance/enemy-scaling";
import { factionAiDevelopSoldierLimit, type ScenarioFactionAi } from "../../world/scenario-faction-ai";
import type { ScenarioStartTroop } from "../../world/scenario-start-troops";
import { commanderPaceOf } from "../commander/commander-profile-source";
import type { SettlementContext } from "../settlement-types";
import { DEVELOP_MODE } from "./constants";

/** The soldiers a `develop` faction may have: the map's limit, else the cap of the level it plays at now. */
export const developSoldierLimit = (context: SettlementContext, entry: ScenarioFactionAi) =>
  factionAiDevelopSoldierLimit(entry, DEVELOP_LEVEL_SCALING[commanderPaceOf(context, entry.faction)].soldierCap);

/** The first `limit` soldiers of `troops`, in line order. */
const trimTroops = (troops: readonly ScenarioStartTroop[], limit: number) => {
  let left = limit;
  return troops.flatMap(line => {
    const count = Math.min(line.count, left);
    left -= count;
    return count > 0 ? [{ ...line, count }] : [];
  });
};

/**
 * The reserve soldiers a start kit without its own `soldiers` gives a `develop` faction (enemy scaling table, lane
 * EAI-FINAL): its level's start soldiers within its soldier limit; undefined for any other faction.
 */
export const developStartSoldiers = (
  context: SettlementContext, faction: number
): readonly ScenarioStartTroop[] | undefined => {
  if (context.factionAi?.setting(faction)?.mode !== DEVELOP_MODE) return undefined;
  const entry = context.options.world.scenario?.factionAi?.find(candidate => candidate.faction === faction);
  const troops = DEVELOP_LEVEL_SCALING[commanderPaceOf(context, faction)].startSoldiers;
  return entry ? trimTroops(troops, developSoldierLimit(context, entry)) : troops;
};
