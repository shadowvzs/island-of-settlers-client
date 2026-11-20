import { COMMANDER_SEARCH_RADIUS } from "../../balance/commander-profiles";
import { probeAccept } from "../faction-vision-probe";
import { enemyInfluence, influenceCellOf, type InfluenceMap, ownInfluence } from "../military-influence-map";
import type { MilitarySpatialGrid } from "../military-spatial-grid";
import { distanceBetween } from "../settlement-geometry";
import type { RetreatBudget } from "./commander-retreat-budget";
import { centreOf, homeOf, strengthOf } from "./commander-squads";
import type { CommanderUnit, SquadContext, SquadMemory, SquadView } from "./commander-types";

interface SquadViewSources {
  budget: RetreatBudget;
  map: InfluenceMap;
  nearbyUnits: MilitarySpatialGrid<CommanderUnit>;
}

/**
 * Reads a squad's situation from the deciding faction's influence map and unit grid: its centre and
 * camp, the nearest known enemy and the strengths round both. `forFaction` is taken once per decision.
 */
export const createSquadViews = ({ budget, map, nearbyUnits }: SquadViewSources) => ({
  forFaction: (faction: number) => {
    // Beyond the largest attack radius enemies cannot affect any utility choice or retreat budget.
    const isEnemy = probeAccept(
      "commander.nearestEnemy",
      faction,
      (enemy: CommanderUnit) => enemy.faction !== faction
    );
    return (squad: readonly CommanderUnit[], memory: SquadMemory | undefined): SquadContext => {
      const centre = centreOf(squad),
        home = homeOf(squad),
        cell = influenceCellOf(map, centre);
      const nearest = nearbyUnits.nearest(centre.x, centre.z, COMMANDER_SEARCH_RADIUS, isEnemy);
      let own = 0,
        shaken = 0,
        spread = 0,
        marching = false;
      for (const unit of squad) {
        own += strengthOf(unit);
        if (unit.moraleState) shaken++;
      }
      for (const unit of squad) {
        spread += distanceBetween(unit, centre);
        marching ||= unit.marching;
      }
      const view: SquadView = {
        current: memory?.action,
        enemyDistance: nearest ? distanceBetween(nearest, centre) : Infinity,
        enemyStrength: nearest ? enemyInfluence(map, faction, influenceCellOf(map, nearest)) : 0,
        homeDistance: distanceBetween(centre, home),
        own,
        retreatSpent: budget.spent(squad),
        shaken: shaken / squad.length,
        spread: spread / squad.length,
        support: ownInfluence(map, faction, cell),
        threat: enemyInfluence(map, faction, cell)
      };
      return { centre, home, marching, nearest, squad, view };
    };
  }
});
