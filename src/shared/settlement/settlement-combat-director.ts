import { HOME_ARRIVAL } from "../balance/commander-director";
import { emitFactionAttackLaunched } from "../script-world/script-building-events";
import { admitAiOrder } from "../script-world/script-order-guard";
import { createMilitaryDirector, type MilitaryDirector } from "./commander/commander-director";
import { createCommanderProfileSource } from "./commander/commander-profile-source";
import type { CommanderUnit } from "./commander/commander-types";
import { distance } from "./commander/director-forces";
import { createDirectorKnowledge } from "./commander/director-knowledge";
import type { DirectorMember, MilitaryOrderMode } from "./commander/director-types";
import { militaryHealth } from "./military-combat-rules";
import type { CombatCore } from "./settlement-combat-core";
import { COMBAT_PHASE } from "./settlement-combat-tick-inputs";
import { isNavigationClear } from "./settlement-navigation";
import type { SettlementPoint } from "./settlement-types";
import { markTickPhase } from "./tick-phase-profile";

/** Tick phases of the strategic director (A14-4a): its decisions, and the marches they order. */
export const DIRECTOR_PHASE = "director";
export const DIRECTOR_MARCH_PHASE = "director.march";
/** A soldier standing in the open field has this building id. */
const FIELD_BUILDING = -3;

export interface CombatDirectorDeps {
  /** The commander's field units and one faction's perception over them. */
  units: () => readonly CommanderUnit[];
  perceive: (faction: number, units: readonly CommanderUnit[]) => readonly CommanderUnit[];
  march: (ids: readonly number[], point: SettlementPoint, faction: number, mode: MilitaryOrderMode) => boolean;
  siege: (ids: readonly number[], site: number, faction: number) => boolean;
  rejoin: (uid: number, site: number) => boolean;
}

/** A member's director view from its soldier record and body (undefined unless it stands in the field). */
const memberOf = (core: CombatCore, uid: number, faction: number): DirectorMember | undefined => {
  const soldier = core.soldiers.get(uid), state = soldier?.combat, body = core.actorById(uid);
  if (!soldier || !state || state.faction !== faction || soldier.building !== FIELD_BUILDING || !body?.visible)
    return undefined;
  const memory = core.memories.get(uid);
  return { health: state.hp / militaryHealth(state.type, soldier.rank), marching: state.destination !== undefined,
    morale: memory?.morale, moraleState: memory?.moraleState, rank: soldier.rank, type: state.type, uid,
    x: body.x, z: body.z };
};

/** An own building of `faction` whose entrance lies at the soldier's feet (its withdrawal's end). */
const ownSiteAt = (core: CombatCore, point: SettlementPoint, faction: number) =>
  core.context.buildings.find(site => site.militaryFaction === faction && distance(site.access, point) <= HOME_ARRIVAL);

/** The entrance of the faction's own building nearest to `near` (the lower uid on ties), else `near` itself. */
const homeNear = (core: CombatCore, faction: number, near: SettlementPoint): SettlementPoint => {
  let best: SettlementPoint = near, bestSpan = Infinity, bestUid = Infinity;
  for (const site of core.context.buildings) {
    if (site.militaryFaction !== faction) continue;
    const span = distance(site.access, near);
    if (span > bestSpan || (span === bestSpan && site.uid > bestUid)) continue;
    best = site.access;
    bestSpan = span;
    bestUid = site.uid;
  }
  return { x: best.x, z: best.z };
};

const soldiersOf = (core: CombatCore, faction: number) => {
  const ids: number[] = [];
  for (const [uid, soldier] of core.soldiers) if (soldier.combat?.faction === faction) ids.push(uid);
  return ids;
};

/**
 * The strategic director wired to the combat layer (A14-4a): the clock, the members, the faction knowledge
 * and the computer side's ordinary orders (script-held soldiers excluded, like every AI order). It is offered
 * to the rest of the simulation as `context.militaryDirector` (not while the AI commander is switched off).
 */
export const createCombatDirector = (core: CombatCore, deps: CombatDirectorDeps): MilitaryDirector => {
  const { context, knowledge } = core;
  const profile = createCommanderProfileSource(context);
  const orderPhase = <T>(order: () => T) => {
    markTickPhase(DIRECTOR_MARCH_PHASE);
    const result = order();
    markTickPhase(DIRECTOR_PHASE);
    return result;
  };
  const director = createMilitaryDirector({
    enlists: (uid, faction) => core.soldiers.get(uid)?.combat?.faction === faction,
    homeOf: (faction, near) => homeNear(core, faction, near),
    knowledge: createDirectorKnowledge({ buildings: () => context.buildings, doors: core.doors,
      isClear: point => isNavigationClear(context, point), knowledge,
      perceive: faction => deps.perceive(faction, deps.units()),
      scoutAgeTicks: faction => profile(faction).scoutAgeTicks }),
    member: (uid, faction) => memberOf(core, uid, faction),
    now: () => knowledge.now(),
    onAttackLaunched: (faction, target) => emitFactionAttackLaunched(context, faction, target),
    profile,
    soldiers: faction => soldiersOf(core, faction),
    orders: {
      isClear: point => isNavigationClear(context, point),
      march: (ids, point, faction, mode) =>
        orderPhase(() => deps.march(admitAiOrder(context, ids), point, faction, mode)),
      rejoin: (uid, faction) => {
        const body = core.actorById(uid), site = body && ownSiteAt(core, body, faction);
        return Boolean(site && deps.rejoin(uid, site.uid));
      },
      siege: (ids, site, faction) => orderPhase(() => deps.siege(ids, site, faction))
    }
  });
  if (context.options.withoutMilitaryCommander) return director;
  context.militaryDirector = director.port;
  context.options.onMilitaryDirector?.(director.port);
  return director;
};

/** Runs the director as its own tick phase (A14-4a), measured apart from the commander and the combat update. */
export const updateDirectorPhase = (director: MilitaryDirector) => {
  markTickPhase(DIRECTOR_PHASE);
  director.update();
  markTickPhase(COMBAT_PHASE);
};
