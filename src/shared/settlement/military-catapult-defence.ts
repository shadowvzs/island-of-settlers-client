import { buildingStructure } from "./fort-assault-rules";
import type { MilitaryCombatant, MilitaryDoor } from "./military-combat-rules";
import { fortifyPlayerSite, isPlayerFortCandidate, isUncommitted, plotDistance } from "./military-siege-sites";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A soldier standing this close to a tower's plot (tiles) takes it on by contact. */
const CONTACT_REACH = .25;
/**
 * Computer soldiers idle this close to the player's tower besiege it (CAT-CAPTURE 2026-11-08): an
 * attack group sent at the tower spreads round its access, and every member joins the assault,
 * as a counterattack's siege order does, instead of only the one that happens to touch the walls.
 * The player's other military buildings use the same reach (MIL-ASSAULT 2026-11-08).
 */
const HOSTILE_ASSAULT_REACH = 2;
const MELEE_TYPES: readonly string[] = ["shield", "heavy"];

type Besiege = (ids: readonly number[], building: number, faction: number) => boolean;
type ActorById = (id: number) => SettlementActor | undefined;

/** A new tower enters the existing door-duel/structure lifecycle; restored damage is never reset. */
const ensureTowerDoor = (site: SettlementBuilding, doors: Map<number, MilitaryDoor>) => {
  site.militaryFaction ??= 0;
  if (!doors.has(site.uid)) doors.set(site.uid, { building: site.uid, faction: site.militaryFaction,
    hp: 200, maximum: 200, structure: buildingStructure(16) });
  const door = doors.get(site.uid)!;
  door.structure ??= buildingStructure(16);
  // Balance migration preserves the damaged fraction of the former 20k prototype, including fallen ruins.
  if (door.structure?.maximum === 20_000) {
    const maximum = buildingStructure(16)!.maximum;
    door.structure.hp *= maximum / door.structure.maximum;
    door.structure.maximum = maximum;
  }
  return door;
};

/** How near this soldier must stand to take the tower on, or null when it never does. */
const assaultReach = (site: SettlementBuilding, state: MilitaryCombatant) => {
  if (state.faction === site.militaryFaction) return null;
  const playerTower = site.militaryFaction === 0;
  // Besieging refuses archers while the crew holds the tower; they join once its walls stand undefended.
  if (playerTower && state.faction > 0) return state.type === "cavalry" ? null : HOSTILE_ASSAULT_REACH;
  return MELEE_TYPES.includes(state.type) ? CONTACT_REACH : null;
};

const besiegeTower = (
  context: SettlementContext, site: SettlementBuilding, soldiers: ReadonlyMap<number, SettlementSoldier>,
  besiege: Besiege, actorById: ActorById
) => {
  for (const soldier of soldiers.values()) {
    const state = soldier.combat, body = actorById(soldier.actor);
    if (!state || !body || soldier.stationed || !isUncommitted(state, body)) continue;
    if (context.buildingByUid?.get(soldier.building)?.catapultSupply?.porter?.actor === soldier.actor) continue;
    const reach = assaultReach(site, state);
    if (reach === null || plotDistance(site, body) > reach) continue;
    besiege([soldier.actor], site.uid, state.faction);
  }
};

/**
 * Every standing Catapult Tower has a door with walls: its crew meets attackers at the door, then
 * the undefended walls are struck until the tower burns down (never captured, like colony forts).
 */
export const updateCatapultDefences = (
  context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>, doors: Map<number, MilitaryDoor>,
  besiege: Besiege, actorById: ActorById
) => {
  for (const site of context.buildings) {
    if (site.typeId !== 16 || site.construction !== 1) continue;
    const door = ensureTowerDoor(site, doors);
    if (door.structure?.hp === 0) continue;
    besiegeTower(context, site, soldiers, besiege, actorById);
  }
};

interface HostileIdler { actor: number; body: SettlementActor; faction: number }

/** Computer foot soldiers standing idle in the field (riders never besiege walls on their own). */
const hostileIdlers = (
  context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>, actorById: ActorById
) => {
  const idlers: HostileIdler[] = [];
  for (const soldier of soldiers.values()) {
    const state = soldier.combat, body = actorById(soldier.actor);
    if (!state || !body || state.faction <= 0 || state.type === "cavalry" || soldier.stationed) continue;
    if (!isUncommitted(state, body)) continue;
    if (context.buildingByUid?.get(soldier.building)?.catapultSupply?.porter?.actor === soldier.actor) continue;
    idlers.push({ actor: soldier.actor, body, faction: state.faction });
  }
  return idlers;
};

/**
 * Computer soldiers idling within reach of the player's Barracks, Guardhouse, Watchtower or Fortress
 * besiege it (MIL-ASSAULT 2026-11-08). Its door and walls are created at that first assault only.
 * An Academy or a Lodge is besieged the same way once no garrison building shields it (2026-11-09).
 */
export const updatePlayerFortDefences = (
  context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>, doors: Map<number, MilitaryDoor>,
  besiege: Besiege, actorById: ActorById
) => {
  let idlers: HostileIdler[] | undefined;
  for (const site of context.buildings) {
    if (!isPlayerFortCandidate(site, doors, context.buildings)) continue;
    idlers ??= hostileIdlers(context, soldiers, actorById);
    if (!idlers.length) return;
    const near = idlers.filter(idler => plotDistance(site, idler.body) <= HOSTILE_ASSAULT_REACH);
    if (!near.length || !fortifyPlayerSite(site, doors, context.buildings)) continue;
    for (const idler of near) besiege([idler.actor], site.uid, idler.faction);
    idlers = idlers.filter(idler => !near.includes(idler));
  }
};
