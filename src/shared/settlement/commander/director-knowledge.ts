import type { FactionKnowledge } from "../faction-knowledge";
import { probeSiteRead } from "../faction-vision-probe";
import type { MilitaryDoor } from "../military-combat-rules";
import { raidSiegeSites } from "../raid-target-priority";
import { isHomeBuilding } from "../settlement-home";
import { ownerOf } from "../settlement-ownership";
import type { SettlementBuilding, SettlementPoint } from "../settlement-types";
import type { CommanderUnit } from "./commander-types";
import type { DirectorKnowledge, DirectorTarget } from "./director-types";

export interface DirectorKnowledgeSources {
  buildings: () => readonly SettlementBuilding[];
  doors: ReadonlyMap<number, MilitaryDoor>;
  /** Clear ground for a scout goal (terrain is known from the start, owner Q3). */
  isClear: (point: SettlementPoint) => boolean;
  knowledge: FactionKnowledge;
  /** The faction's perception of the field (the commander's: own, known now, remembered). */
  perceive: (faction: number) => readonly CommanderUnit[];
  /** The faction's scout age (its commander profile, plan §7). */
  scoutAgeTicks: (faction: number) => number;
}

const byTierThenUid = (a: DirectorTarget, b: DirectorTarget) => a.tier - b.tier || a.uid - b.uid;

/**
 * The director's knowledge over the strategic knowledge (A14-4b): targets are the enemy buildings of the raid
 * tier list in the faction's known-sites ledger (or in sight now); scout goals are the faction's scout plan over
 * the stale sectors, led by the enemy's home (HQ or colony landing harbour), known from the start (owner Q3).
 */
export const createDirectorKnowledge = (sources: DirectorKnowledgeSources): DirectorKnowledge => {
  const { knowledge } = sources;
  /** The enemy's start-known places (owner Q3): a remembered, static place, never a live read. */
  const starts = (faction: number) => {
    const out: SettlementPoint[] = [];
    for (const site of sources.buildings()) {
      if (!isHomeBuilding(site) || ownerOf(site) === faction) continue;
      probeSiteRead("director.startArea", faction, site, true);
      out.push({ x: site.access.x, z: site.access.z });
    }
    return out;
  };
  return {
    knowsSite: (faction, uid) => knowledge.strategic.site(faction, uid) !== undefined,
    perceive: sources.perceive,
    scoutGoals: (faction, from) => knowledge.strategic.scoutGoals(faction, from, starts(faction), sources.isClear,
      sources.scoutAgeTicks(faction)),
    targets: faction => {
      const entries = raidSiegeSites({ buildings: sources.buildings(), doors: sources.doors,
        knows: site => knowledge.knowsBuilding(faction, site) });
      const targets: DirectorTarget[] = [];
      for (const { known, site, tier } of entries) {
        if (!known) continue;
        probeSiteRead("director.target", faction, site, knowledge.strategic.site(faction, site.uid) !== undefined);
        targets.push({ tier, uid: site.uid, x: site.access.x, z: site.access.z });
      }
      return targets.sort(byTierThenUid);
    }
  };
};
