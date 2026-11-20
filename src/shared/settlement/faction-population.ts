import { factionAiPopulationLimit } from "../world/scenario-faction-ai";
import { isActiveResidence } from "./residences";
import { findFactionHome } from "./settlement-home";
import { computerEconomies } from "./settlement-ownership";
import { addIdleSettlers, ownerIdleSettlers, populationLimit, residenceBirthDue } from "./settlement-population";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** A computer economy's people: the idle settlers in its storages plus its civilians on duty. */
const factionPeople = (context: SettlementContext, owner: number) => {
  let people = ownerIdleSettlers(context, owner);
  for (const actor of context.actors)
    if (actor.hostileCivilianFaction === owner && actor.phase !== "retired" && actor.job !== "Mount") people++;
  return people;
};

/** Its home's base and residences (as the player's), at most the civilians the map allows the faction. */
const factionLimit = (context: SettlementContext, owner: number, home: SettlementBuilding) => {
  const entry = context.options.world.scenario?.factionAi?.find(candidate => candidate.faction === owner);
  if (!entry) return 0;
  const mode = context.factionAi?.setting(owner)?.mode ?? entry.mode;
  return Math.min(factionAiPopulationLimit(entry, mode), populationLimit(context, home)!);
};

const growFaction = (context: SettlementContext, owner: number, dt: number) => {
  const home = findFactionHome(context, owner);
  if (!home || home.construction !== 1) return;
  const limit = factionLimit(context, owner, home);
  let people = factionPeople(context, owner);
  for (const building of context.buildings) {
    if (people >= limit) return;
    if (!isActiveResidence(building, owner) || !residenceBirthDue(building, dt)) continue;
    addIdleSettlers(context, home);
    people++;
  }
};

/**
 * Growth of the computer economies (enemy economy AI plan §3.6: settlers come from the faction's own
 * population), on the same half-second schedule as the player's: each completed residence of a faction bears
 * into that faction's home while it has fewer people than its limit. Only residences bear (a computer economy
 * has no base timer), so nothing new is saved: each residence keeps its own saved timer. No-op on every island
 * without a computer economy.
 */
export const updateFactionPopulationGrowth = (context: SettlementContext, dt: number) => {
  for (const owner of computerEconomies(context)) growFaction(context, owner, dt);
};
