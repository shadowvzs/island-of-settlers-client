import { banditCampPlan } from "../../render-common/buildings/bandit-camp-plan";
import {
  ARCHER_HEALTH_VERSION, GARRISON_CAPACITIES, LEGACY_ARCHER_HEALTH_SCALE, MILITARY_PROFILES,
  MILITARY_REST_SECONDS_PER_HP
} from "../balance/military";
import type { StatefulRandom } from "../world/rng";
import { COMMANDER_LODGE_TYPE_ID } from "./building-type-ids";
import { DEFAULT_CATAPULT_AMMO, isCatapultAmmoKind } from "./catapult-ammo-kinds";
import { commanderLevelsSaveError } from "./commander/commander-levels";
import { directorSaveError } from "./commander/director-save";
import { militaryMoraleSaveError } from "./commander/military-morale-update";
import { TROOP_HORSE_RIDER_PHASES } from "./constants";
import { factionKnowledgeSaveError } from "./faction-knowledge";
import { militaryStructureError } from "./fort-assault-rules";
import { normalizeMilitaryAiMode } from "./military-ai-mode";
import { militaryAiSaveError } from "./military-ai-save-validation";
import { catapultBoulderFlight } from "./military-catapult";
import { catapultRollError } from "./military-catapult-roll";
import { civilianTargetError } from "./military-civilian-targets";
import { fightingType, type MilitaryCombatant,militaryHealth } from "./military-combat-rules";
import { militaryDirectSaveProblem } from "./military-direct-state";
import { type GarrisonComposition,isValidComposition } from "./military-garrison-rules";
import { manualArrowLifetimeInvalid, manualBowDrawProblem } from "./military-manual-archery";
import { isValidOrderQueueSave, type MilitaryOrderQueueSave } from "./military-order-queue-rules";
import type { MilitaryRallySave } from "./military-orders";
import { STORAGE_IDS } from "./production-rules";
import { ADVENTURE_LANDING_PHASES } from "./settlement-adventure-landing";
import type { MilitaryCombatSave } from "./settlement-combat";
import { militaryFieldSaveError } from "./settlement-combat-field-save";
import type { CommanderSave } from "./settlement-commander";
import { commanderDefinition, commanderMaximumHealth, isCommanderState } from "./settlement-commander";
import { isOwnBuilding } from "./settlement-home";
import type { MilitaryTrainingFocus, SettlementSoldier } from "./settlement-military";
import { LEGACY_MAX_SOLDIER_RANK, MAX_SOLDIER_RANK, migrateLegacyMilitaryRank,MILITARY_RANK_VERSION }
  from "./settlement-military-ranks";
import type { SettlementContext } from "./settlement-types";
import { auditRandom } from "./simulation-random";

/**
 * Where a rider may be on horseback; since 2026-10-15 also riding off an adventure's landing ship
 * (deck, gangway) and on to the gathering place.
 */
const MOUNTED_PHASES: readonly string[] = ["militaryField", "militaryMountedReturn", "retire", "militaryReturnBlocked",
  "militaryLeaving", ...ADVENTURE_LANDING_PHASES];

export interface SettlementMilitarySave {
  /** Missing in historical saves containing ranks 0..4. Version 1 contains ranks 0..2. */
  rankVersion?: typeof MILITARY_RANK_VERSION;
  /** Missing in saves made before the 2026-10-27 archer HP reduction. */
  archerHealthVersion?: typeof ARCHER_HEALTH_VERSION;
  combat?: MilitaryCombatSave;
  soldiers: SettlementSoldier[];
  targets: [number, number][];
  /** Manual per-type garrison counts; buildings without an entry fill automatically. */
  compositions?: [number, GarrisonComposition][];
  coinsAllowed: [number, boolean][];
  trainingFocus?: [number, MilitaryTrainingFocus][];
  recruitTimers: [number, number][];
  trainTimers: [number, number][];
  randomState: number;
  trainingEncounter?: boolean;
  /**
   * The next garrison arrival order (absent while 0). Soldiers that left had raised it, so it is saved
   * rather than re-derived from the soldiers present.
   */
  nextGarrisonOrder?: number;
  /** The island's one player commander; absent in saves before COMMANDER-SYSTEM-01. */
  commander?: CommanderSave;
  /** The persistent rally banner (absent until the player plants one). */
  rally?: MilitaryRallySave;
  /** The player's Shift order queues (format 27; absent while none is running). */
  orderQueues?: MilitaryOrderQueueSave[];
}

const isValidRally = (rally: unknown) => {
  if (rally === undefined) return true;
  const value = rally as MilitaryRallySave;
  return Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.z) &&
    (value.building === undefined || Number.isSafeInteger(value.building)) &&
    (value.participants === undefined || (Array.isArray(value.participants) && value.participants.length <= 10000 &&
      value.participants.every(id => Number.isSafeInteger(id)) && new Set(value.participants).size === value.participants.length));
};

/** Optional extension of V1 saves; older worlds start without manufactured soldiers. */
type SavedCombatant = MilitaryCombatant & { retreatOrigin?: unknown; retreatDistance?: unknown };
/** Combat fields of older saves no longer used (the archer's 4-tile retreat budget, 2026-10-13). */
const withoutRetiredCombatFields = (combat: SavedCombatant): MilitaryCombatant => {
  const current: SavedCombatant = { ...combat, destination: combat.destination && { ...combat.destination },
    pendingAim: combat.pendingAim && { ...combat.pendingAim },
    pendingRoute: combat.pendingRoute?.map(point => ({ ...point })) };
  delete current.retreatOrigin; delete current.retreatDistance;
  return current;
};

/** One saved soldier with the one-time archer HP reduction and any legacy rank change applied. */
const migrateSavedMilitarySoldier = (
  soldier: SettlementSoldier, saved: Pick<SettlementMilitarySave, "archerHealthVersion" | "commander" | "rankVersion">
): SettlementSoldier => {
  const rank = saved.rankVersion === MILITARY_RANK_VERSION
    ? soldier.rank : migrateLegacyMilitaryRank(soldier.rank);
  const combat = soldier.combat && withoutRetiredCombatFields(soldier.combat);
  if (!combat) return { ...soldier, combat, rank };
  if (soldier.commanderId && saved.commander && isCommanderState(saved.commander) && saved.commander.id === soldier.commanderId)
    combat.commanderLoadout = commanderDefinition(saved.commander.nation, saved.commander.definitionId).loadout;
  if (saved.archerHealthVersion === undefined && combat.type === "archer")
    combat.hp *= LEGACY_ARCHER_HEALTH_SCALE;
  if (saved.rankVersion === undefined) {
    const fraction = combat.hp / militaryHealth(combat.type, soldier.rank);
    combat.hp = militaryHealth(combat.type, rank) * fraction;
  }
  if (combat.type === "archer") combat.hp = Math.min(combat.hp, militaryHealth(combat.type, rank));
  const migrated = { ...soldier, combat, rank };
  if (combat.hp >= militaryHealth(combat.type, rank) - 1e-9) delete migrated.recoverySeconds;
  return migrated;
};

/** A saved targetMilitary lock (format 25): the chased uid and, while out of sight, where it vanished. */
const isSavedChase = (chase: unknown) => {
  if (!chase || typeof chase !== "object") return false;
  const { lost, uid } = chase as { lost?: { seconds?: unknown; x?: unknown; z?: unknown }; uid?: unknown };
  if (!Number.isSafeInteger(uid) || (uid as number) < 0) return false;
  if (lost === undefined) return true;
  return typeof lost === "object" && lost !== null && Number.isFinite(lost.x) && Number.isFinite(lost.z) &&
    Number.isFinite(lost.seconds) && (lost.seconds as number) >= 0;
};

/** Migrates a detached military save in place; the markers make repeated calls a no-op. */
export const migrateSavedMilitaryHealth = (saved: SettlementMilitarySave) => {
  if (saved.rankVersion === MILITARY_RANK_VERSION && saved.archerHealthVersion === ARCHER_HEALTH_VERSION)
    return saved;
  saved.soldiers = saved.soldiers.map(soldier => migrateSavedMilitarySoldier(soldier, saved));
  if (saved.combat && saved.rankVersion === undefined)
    saved.combat.arrows = saved.combat.arrows.map(arrow => ({ ...arrow, rank: migrateLegacyMilitaryRank(arrow.rank) }));
  saved.rankVersion = MILITARY_RANK_VERSION;
  saved.archerHealthVersion = ARCHER_HEALTH_VERSION;
  return saved;
};

/** The military stream's linear congruential generator (its state is `randomState` in the save). */
const createMilitaryGenerator = (initial: number): StatefulRandom => {
  let seed = initial >>> 0;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Object.assign(next, { getState: () => seed, setState: (state: number) => { seed = state >>> 0; } });
};

export const createMilitaryState = (context: SettlementContext) => {
  let trainingEncounter = false, nextGarrisonOrder = 0;
  const initialSeed = () => (context.options.world.seed || 1) >>> 0;
  const random = auditRandom("military", createMilitaryGenerator(initialSeed()));
  const soldiers = new Map<number, SettlementSoldier>();
  const targets = new Map<number, number>(), coinsAllowed = new Map<number, boolean>();
  const trainingFocus = new Map<number, MilitaryTrainingFocus>();
  const compositions = new Map<number, GarrisonComposition>();
  const recruitTimers = new Map<number, number>(), trainTimers = new Map<number, number>();
  const restore = (saved?: SettlementMilitarySave) => {
    soldiers.clear(); targets.clear(); coinsAllowed.clear(); recruitTimers.clear(); trainTimers.clear();
    compositions.clear(); trainingFocus.clear(); nextGarrisonOrder = 0;
    trainingEncounter = saved?.trainingEncounter ?? false;
    random.setState(saved?.randomState ?? initialSeed());
    if (!saved) return;
    nextGarrisonOrder = saved.nextGarrisonOrder ?? 0;
    for (const savedSoldier of saved.soldiers) {
      const soldier = migrateSavedMilitarySoldier(savedSoldier, saved);
      soldiers.set(soldier.actor, soldier);
      if (soldier.combat?.commanderLoadout) {
        const actor = context.actors.find(body => body.uid === soldier.actor);
        if (actor) actor.tool = soldier.combat.commanderLoadout;
      }
    }
    for (const [key, value] of saved.targets) targets.set(key, value);
    for (const [key, value] of saved.compositions ?? []) compositions.set(key, { ...value });
    for (const [key, value] of saved.trainingFocus ?? []) trainingFocus.set(key, value);
    for (const [key, value] of saved.coinsAllowed) coinsAllowed.set(key, value);
    for (const [key, value] of saved.recruitTimers) recruitTimers.set(key, value);
    for (const [key, value] of saved.trainTimers) trainTimers.set(key, value);
  };
  return { soldiers, targets, compositions, trainingFocus, coinsAllowed,
    allocateGarrisonOrder: () => nextGarrisonOrder++, recruitTimers, trainTimers, restore,
    trainingStarted: () => trainingEncounter, markTrainingStarted: () => { trainingEncounter = true; },
    random,
    saveState: (): SettlementMilitarySave => ({
      rankVersion: MILITARY_RANK_VERSION, archerHealthVersion: ARCHER_HEALTH_VERSION, trainingEncounter,
      soldiers: [...soldiers.values()].map((soldier) => ({ ...soldier,
        combat: soldier.combat && { ...soldier.combat,
          pendingAim: soldier.combat.pendingAim && { ...soldier.combat.pendingAim },
          pendingRoute: soldier.combat.pendingRoute?.map(point => ({ ...point })),
          destination: soldier.combat.destination && { ...soldier.combat.destination } } })),
      targets: [...targets], coinsAllowed: [...coinsAllowed], recruitTimers: [...recruitTimers],
      ...(trainingFocus.size ? { trainingFocus: [...trainingFocus] } : {}),
      ...(compositions.size ? { compositions: [...compositions].map(([uid, value]) => [uid, { ...value }]) } : {}),
      trainTimers: [...trainTimers], randomState: random.getState(),
      ...(nextGarrisonOrder ? { nextGarrisonOrder } : {})
    })
  };
};

const savedCombatMaximumHealth = (
  soldier: SettlementSoldier, combat: MilitaryCombatant,
  saved: Pick<SettlementMilitarySave, "archerHealthVersion" | "commander">
) => {
  if (soldier.commanderId && saved.commander && isCommanderState(saved.commander) && saved.commander.id === soldier.commanderId)
    return commanderMaximumHealth(saved.commander.level);
  if (saved.archerHealthVersion === undefined && combat.type === "archer")
    return militaryHealth(combat.type, soldier.rank) / LEGACY_ARCHER_HEALTH_SCALE;
  return militaryHealth(combat.type, soldier.rank);
};

const mismatchedCommanderLoadout = (combat: MilitaryCombatant, commander: CommanderSave) =>
  combat.commanderLoadout !== undefined && combat.commanderLoadout !==
    commanderDefinition(commander.nation, commander.definitionId).loadout;

const invalidCommanderLoadout = (soldier: SettlementSoldier) => {
  const combat = soldier.combat;
  return combat?.commanderLoadout !== undefined && (!soldier.commanderId || combat.type !== "cavalry" ||
    !["axe", "bow", "sword"].includes(combat.commanderLoadout));
};

const militaryVersionProblem = (saved: SettlementMilitarySave) => {
  if (saved.rankVersion !== undefined && saved.rankVersion !== MILITARY_RANK_VERSION)
    return "Unsupported military rank version";
  if (saved.archerHealthVersion !== undefined && saved.archerHealthVersion !== ARCHER_HEALTH_VERSION)
    return "Unsupported military archer health version";
  if (saved.nextGarrisonOrder !== undefined &&
    (!Number.isSafeInteger(saved.nextGarrisonOrder) || saved.nextGarrisonOrder < 0))
    return "Invalid garrison arrival order";
  if (saved.trainingEncounter !== undefined && typeof saved.trainingEncounter !== "boolean")
    return "Invalid military training encounter";
  return null;
};

/**
 * A building's owning faction, when set: any building type may carry one since BD1 (an enemy HQ, a player
 * Academy or civilian building with walls under assault), as long as it is a faction number.
 */
const hasInvalidOwnership = (building: SettlementContext["buildings"][number]) =>
  building.militaryFaction !== undefined &&
  (!Number.isSafeInteger(building.militaryFaction) || building.militaryFaction < 0);

/** A stored soldier waits in a storage of its own faction: the player's, or a computer economy's (EAI2b kit). */
const isReserveStorageOf = (home: SettlementContext["buildings"][number], faction: number,
  economyFaction: (faction: number) => boolean) =>
  faction === 0 ? isOwnBuilding(home) : home.militaryFaction === faction && economyFaction(faction);

// eslint-disable-next-line max-lines-per-function -- one save validator owns the shared military schema
/**
 * A building with a defined owner needs a door record (walls), except a site of a computer faction
 * running an economy: its walls arrive on the first assault, as BD1 does for player buildings (EAI1a E5).
 */
const needsOwnedDoor = (site: SettlementContext["buildings"][number], economyFaction: (faction: number) => boolean) =>
  site.militaryFaction !== undefined && (site.militaryFaction === 0 || !economyFaction(site.militaryFaction));

export const validateMilitarySave = (
  value: unknown,
  buildings: SettlementContext["buildings"],
  actors: SettlementContext["actors"],
  economyFaction: (faction: number) => boolean = () => false
): string | null => {
  if (buildings.some(hasInvalidOwnership)) return "Invalid military ownership";
  if (value === undefined) {
    return actors.some((actor) => actor.job === "Soldier") ? "Missing military soldier state" : null;
  }
  if (!value || typeof value !== "object") return "Invalid military state";
  const saved = value as SettlementMilitarySave;
  const versionProblem = militaryVersionProblem(saved);
  if (versionProblem) return versionProblem;
  if (!isValidRally(saved.rally)) return "Invalid military rally banner";
  if (!isValidOrderQueueSave(saved.orderQueues)) return "Invalid military order queue";
  const queueIds = new Set(saved.orderQueues?.map(queue => queue.id));
  const maximumRank = saved.rankVersion === undefined ? LEGACY_MAX_SOLDIER_RANK : MAX_SOLDIER_RANK;
  if (!Number.isSafeInteger(saved.randomState) || saved.randomState < 0 || saved.randomState > 0xffffffff ||
    ![saved.soldiers, saved.targets, saved.coinsAllowed, saved.recruitTimers, saved.trainTimers].every(Array.isArray))
    return "Invalid military state";
  const byUid = new Map(buildings.map((building) => [building.uid, building]));
  const playerIds = new Set(saved.soldiers.filter(soldier => soldier &&
    (soldier.combat?.faction ?? 0) === 0).map(soldier => soldier.actor));
  if (saved.rally?.participants?.some(id => !playerIds.has(id))) return "Invalid rally participants";
  const soldierIds = new Set<number>();
  const mountIds = new Set<number>();
  for (const soldier of saved.soldiers) {
    if (!soldier || !Number.isSafeInteger(soldier.actor) || soldierIds.has(soldier.actor) ||
      !Number.isSafeInteger(soldier.rank) || soldier.rank < 0 || soldier.rank > maximumRank ||
      !Number.isSafeInteger(soldier.building) || soldier.building < -3 || typeof soldier.stationed !== "boolean")
      return "Invalid military soldier";
    if (soldier.recoverySeconds !== undefined && (!soldier.combat ||
      !Number.isFinite(soldier.recoverySeconds) || soldier.recoverySeconds < 0 ||
      soldier.recoverySeconds >= MILITARY_REST_SECONDS_PER_HP))
      return "Invalid military recovery timer";
    const actor = actors.find((entry) => entry.uid === soldier.actor);
    const building = byUid.get(soldier.building);
    if (building?.typeId === 16 && (soldier.commanderId !== undefined ||
      !["shield", "heavy"].includes(soldier.combat?.type ?? "shield"))) return "Invalid catapult crew";
    let phases = ["outbound", "retire", "enterRetire", "militaryReturnBlocked", "militaryMountedReturn"];
    if (soldier.building === -3)
      phases = ["militaryField", "militaryLeaving", "militarySiege", "commanderEvacuating", "commanderIncapacitated",
        "commanderMuster", "commanderWaiting", "commanderBoarding", "commanderLodgeReturning", "commanderReturning",
        "commanderLanding", ...ADVENTURE_LANDING_PHASES];
    if (soldier.building >= 0) phases = ["assigned", "enterAssigned", "garrison", "militarySiege", "militaryTransferLeaving"];
    if (soldier.building === -1) phases = ["militaryReserve", "navalToHarbour", "navalEnterHarbour", "navalWaiting",
      "navalToShip", "navalBoarding", "navalDeckWalk", "navalAboard", "navalDisembark", "navalLanding",
      "navalLandingEnter", "commanderLodge", "commanderRecovering"];
    if (!actor || !phases.includes(actor.phase) || actor.job !== "Soldier" || actor.demolitionReturning ||
      (soldier.building >= 0 && (!building || building.construction !== 1 || !GARRISON_CAPACITIES[building.typeId] ||
        (actor.phase !== "militaryTransferLeaving" && actor.building !== building.uid))) ||
      (soldier.stationed !== (actor.phase === "garrison")) ||
      (soldier.stationed && (soldier.building < 0 || actor.visible)) ||
      (soldier.building === -1 && actor.phase === "militaryReserve" && actor.visible) ||
      (soldier.building === -1 && actor.phase !== "militaryReserve" && !soldier.commanderId && actor.navalOrder === undefined))
      return "Invalid military soldier references";
    if (soldier.combat) {
      const combat = soldier.combat;
      if(combat.towerFall!==undefined&&(!combat.towerFall||!Number.isFinite(combat.towerFall.remaining)||
        combat.towerFall.remaining<=0||combat.towerFall.remaining>.8||
        !Number.isFinite(combat.towerFall.fromY)||!Number.isFinite(combat.towerFall.groundY)||
        combat.towerFall.fromY<combat.towerFall.groundY||combat.type!=="archer"||soldier.building!==-3||
        actor.phase!=="militaryField"||combat.fallenTowerArcher!==true))return "Invalid tower collapse recovery";
      if(combat.fallenTowerArcher!==undefined&&(combat.fallenTowerArcher!==true||combat.type!=="archer"||
        combat.faction<1||soldier.building!==-3))return "Invalid fallen tower survivor";
      if (invalidCommanderLoadout(soldier)) return "Invalid commander loadout";
      if (building?.militaryFaction !== undefined && combat.faction !== building.militaryFaction)
        return "Military garrison ownership mismatch";
      if (combat.type === "cavalry" && soldier.building >= 0)
        return "Only foot soldiers can garrison military buildings";
      if (!Object.hasOwn(MILITARY_PROFILES, combat.type) ||
        !Number.isSafeInteger(combat.faction) || combat.faction < 0 ||
        !Number.isFinite(combat.hp) || combat.hp < 0 || (combat.hp === 0 && !soldier.commanderId) ||
        !Number.isFinite(combat.cooldown) || combat.cooldown < 0 ||
        (combat.selected !== undefined && typeof combat.selected !== "boolean") ||
        (combat.rallyRunning !== undefined && typeof combat.rallyRunning !== "boolean") ||
        (combat.returnToStorage !== undefined && typeof combat.returnToStorage !== "boolean") ||
        (combat.returnStorageUid !== undefined && (!Number.isSafeInteger(combat.returnStorageUid) ||
          !byUid.has(combat.returnStorageUid))) ||
        (combat.doorMelee !== undefined && (combat.doorMelee !== true || fightingType(combat) !== "archer" || actor.phase !== "militarySiege")) ||
        (combat.closeQuarters !== undefined && (combat.closeQuarters !== true || fightingType(combat) !== "archer")) ||
        (combat.dismounted !== undefined && (combat.dismounted !== true || combat.type !== "cavalry" || actor.mounted)) ||
        (combat.doorBlow !== undefined && combat.doorBlow !== true) ||
        (combat.marchSpeed !== undefined && (!Number.isFinite(combat.marchSpeed) || combat.marchSpeed <= 0)))
        return "Invalid military combatant";
      if (combat.hp > savedCombatMaximumHealth(soldier, combat, saved) + 1e-6) return "Invalid military combatant";
      const aimProblem = manualBowDrawProblem(combat, Boolean(soldier.commanderId), actor.phase);
      if (aimProblem) return aimProblem;
      if (actor.mounted && (combat.type !== "cavalry" || !MOUNTED_PHASES.includes(actor.phase)))
        return "Invalid mounted soldier movement";
      if (combat.pendingRoute !== undefined && (!Array.isArray(combat.pendingRoute) ||
        !combat.pendingRoute.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.z))))
        return "Invalid pending military route";
      if (combat.mountOnClear !== undefined && (combat.mountOnClear !== true || combat.type !== "cavalry"))
        return "Invalid pending mount";
      if (combat.order !== undefined && !["move", "attackMove", "retreat"].includes(combat.order))
        return "Invalid military movement order";
      if (combat.type === "cavalry") {
        // Colony and adventure expeditions embark cavalry on foot; a rider never boards mounted.
        if (actor.navalOrder !== undefined && actor.mounted) return "Mounted soldiers cannot be naval passengers";
        const mount = actors.find(actor => actor.uid === combat.mount);
        // A dismounted rider's horse waits beside it: drawn from the rider's state, never a traffic body.
        const manualHorse = saved.combat?.directControl?.horse;
        const ownedManualHorse = soldier.commanderId !== undefined && manualHorse?.actor === actor.uid &&
          manualHorse.horse === mount?.uid && combat.dismounted === true && actor.mounted !== true;
        // The commander's horse led aboard or standing on a troop ship's deck (the naval check names the ship).
        const shipHorse = soldier.commanderId !== undefined && actor.navalOrder !== undefined &&
          TROOP_HORSE_RIDER_PHASES.includes(actor.phase);
        if (!mount || mount.job !== "Mount" || mount.phase !== "horseMounted" ||
          mount.visible && !ownedManualHorse && !shipHorse ||
          mountIds.has(mount.uid)) return "Invalid military mount identity";
        mountIds.add(mount.uid);
      } else if (combat.mount !== undefined) return "Unmounted soldier owns a horse";
      if (combat.destination && (!Number.isFinite(combat.destination.x) || !Number.isFinite(combat.destination.z)))
        return "Invalid military combat destination";
      for (const time of [combat.routeAge, combat.attackTime])
        if (time !== undefined && (!Number.isFinite(time) || time < 0))
          return "Invalid military combat timer";
      for (const target of [combat.target, combat.siege, combat.pendingTarget])
        if (target !== undefined && (!Number.isSafeInteger(target) || target < 0))
          return "Invalid military combat order";
      if (combat.chase !== undefined && !isSavedChase(combat.chase)) return "Invalid military chase";
      if (combat.queue !== undefined && (combat.faction !== 0 || !queueIds.has(combat.queue)))
        return "Invalid military order queue member";
    } else if (soldier.building === -3) return "Missing battlefield soldier state";
    if (soldier.building === -1 && actor.phase === "militaryReserve") {
      const home = byUid.get(actor.home);
      if (!home || !STORAGE_IDS.has(home.typeId) || home.construction !== 1 ||
        !isReserveStorageOf(home, soldier.combat?.faction ?? 0, economyFaction) || actor.building !== home.uid)
        return "Invalid military reserve storage";
    }
    if (soldier.stationedOrder !== undefined && (!Number.isSafeInteger(soldier.stationedOrder) ||
      soldier.stationedOrder < 0)) return "Invalid garrison arrival order";
    soldierIds.add(soldier.actor);
  }
  if (saved.commander !== undefined) {
    if (!isCommanderState(saved.commander)) return "Invalid commander state";
    const commander = saved.commander;
    const home = byUid.get(commander.homeLodgeUid);
    if (home && home.typeId !== COMMANDER_LODGE_TYPE_ID) return "Commander home is not a lodge";
    const linked = saved.soldiers.filter(soldier => soldier.commanderId === commander.id);
    const away = commander.location === "away";
    const mayLackSoldier = away || (commander.location === "returning" && linked.length === 0);
    if (linked.length > 1) return "Commander roster identity is not unique";
    if (!linked.length && !mayLackSoldier) return "Commander roster identity is not unique";
    if (away && linked.length) return "An away commander cannot own a live soldier";
    if (away && commander.awayHp === undefined) return "An away commander has no saved HP";
    if (!away && commander.awayHp !== undefined && linked.length === 0) return "Commander has no live soldier";
    const soldier = linked[0];
    if (soldier) {
      if (soldier.combat?.type !== "cavalry" || soldier.rank !== 0) return "Invalid commander profile or rank";
      if (mismatchedCommanderLoadout(soldier.combat, commander)) return "Invalid commander loadout";
      const actor = actors.find(entry => entry.uid === soldier.actor);
      const inLodge = actor?.phase === "commanderLodge" || actor?.phase === "commanderRecovering";
      if ((commander.location === "lodge" || commander.location === "recovering") && !inLodge)
        return "Commander location does not match its actor";
      if ((commander.location === "lodge" || commander.location === "recovering") &&
        (soldier.combat?.hp ?? 0) <= 0) return "Invalid commander health state";
      if (commander.location === "field" && (soldier.combat?.hp ?? 0) <= 0)
        return "Invalid commander health state";
      if (commander.location === "incapacitated" && soldier.combat?.hp !== 0)
        return "Incapacitated commander must have zero HP";
    }
  } else if (saved.soldiers.some(soldier => soldier.commanderId !== undefined)) {
    return "Commander soldier without commander state";
  }
  if (actors.some(actor => actor.phase === "horseMounted" && !mountIds.has(actor.uid)))
    return "Unclaimed military mount";
  if (actors.some((actor) => actor.job === "Soldier" && !soldierIds.has(actor.uid)))
    return "Untracked military soldier";
  for (const building of buildings) {
    if (hasInvalidOwnership(building)) return "Invalid military ownership";
    const assigned = saved.soldiers.filter((soldier) => soldier.building === building.uid).length;
    const capacity = building.bandit === undefined ? GARRISON_CAPACITIES[building.typeId] ?? 0
      : banditCampPlan(building.bandit).capacity;
    if (assigned > capacity) return "Military garrison exceeds capacity";
  }
  const compositionReason = validateCompositions(saved.compositions, byUid);
  if (compositionReason) return compositionReason;
  if (saved.trainingFocus !== undefined && !Array.isArray(saved.trainingFocus)) return "Invalid training focus";
  for (const [name, entries] of Object.entries({ trainingFocus: saved.trainingFocus ?? [], targets: saved.targets, coinsAllowed: saved.coinsAllowed,
    recruitTimers: saved.recruitTimers, trainTimers: saved.trainTimers })) {
    const ids = new Set<number>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || ids.has(entry[0]))
        return "Invalid military preferences or timers";
      const building = byUid.get(entry[0]);
      if (!building) return "Invalid military building reference";
      if (name !== "recruitTimers" && !GARRISON_CAPACITIES[building.typeId]) return "Invalid military building reference";
      if (name === "recruitTimers" && !STORAGE_IDS.has(building.typeId)) return "Invalid military recruit storage";
      if (name === "trainingFocus") {
        if (!["balanced", "elite"].includes(entry[1] as string)) return "Invalid training focus";
      } else if (name === "coinsAllowed") {
        if (typeof entry[1] !== "boolean") return "Invalid military coin preference";
      } else if (typeof entry[1] !== "number" || !Number.isFinite(entry[1]) || entry[1] < 0 ||
        (name === "targets" && (!Number.isInteger(entry[1]) || entry[1] > GARRISON_CAPACITIES[building.typeId]!)))
        return "Invalid military preferences or timers";
      ids.add(entry[0]);
    }
  }
  if (saved.combat) {
    const combat = saved.combat;
    const directProblem = militaryDirectSaveProblem(combat.directControl, new Set(saved.soldiers.map(soldier => soldier.actor)));
    if (directProblem) return directProblem;
    const manual = combat.directControl;
    if (manual?.lease) {
      const soldier = saved.soldiers.find(entry => entry.actor === manual.lease!.actor);
      if (soldier?.commanderId !== manual.lease.commanderId || soldier.combat?.faction !== 0 ||
        saved.commander?.id !== manual.lease.commanderId) return "Invalid controlled commander identity";
    }
    if (manual?.horse) {
      const soldier = saved.soldiers.find(entry => entry.actor === manual.horse!.actor);
      if (!soldier?.commanderId || soldier.combat?.mount !== manual.horse.horse || soldier.combat?.faction !== 0)
        return "Invalid controlled commander horse identity";
    }
    if (!Array.isArray(combat.arrows) || !Array.isArray(combat.doors) ||
      !Number.isSafeInteger(combat.nextArrow) || combat.nextArrow < 0)
      return "Invalid military combat state";
    const pointIsFinite = (point: { x: number; z: number } | undefined) =>
      Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.z));
    const aiError = militaryAiSaveError(combat.movement, combat.commander, new Set(saved.soldiers.map(soldier => soldier.actor)));
    if (aiError) return aiError;
    if (combat.aiMode !== undefined && !normalizeMilitaryAiMode(combat.aiMode))
      return "Invalid military AI mode";
    if (combat.pendingMarches !== undefined && (!Array.isArray(combat.pendingMarches) ||
      combat.pendingMarches.length > saved.soldiers.length)) return "Invalid pending military marches";
    const queuedIds = new Set<number>();
    for (const job of combat.pendingMarches ?? []) {
      if (!job || !soldierIds.has(job.uid) || queuedIds.has(job.uid) || !pointIsFinite(job.goal) ||
        !pointIsFinite(job.destination) || !Number.isSafeInteger(job.faction) || job.faction < 0 ||
        !["attackMove", "move", "retreat"].includes(job.mode) || typeof job.gathering !== "boolean")
        return "Invalid pending military march";
      queuedIds.add(job.uid);
    }
    if (civilianTargetError(combat, new Set(actors.filter(actor => !soldierIds.has(actor.uid))
      .map(actor => actor.uid)))) return "Invalid civilian wounds";
    const fieldError = militaryFieldSaveError(combat.field);
    if (fieldError) return fieldError;
    const knowledgeError = factionKnowledgeSaveError(combat.knowledge);
    if (knowledgeError) return knowledgeError;
    const moraleError = militaryMoraleSaveError(combat.morale);
    if (moraleError) return moraleError;
    const directorError = directorSaveError(combat.director, soldierIds);
    if (directorError) return directorError;
    const levelsError = commanderLevelsSaveError(combat.commanderLevels);
    if (levelsError) return levelsError;
    const arrowIds = new Set<number>();
    for (const arrow of combat.arrows) {
      if (!arrow || !Number.isSafeInteger(arrow.id) || arrow.id < 0 || arrow.id >= combat.nextArrow ||
        arrowIds.has(arrow.id) || !Number.isSafeInteger(arrow.shooter) || arrow.shooter < 0 ||
        !Number.isSafeInteger(arrow.faction) || arrow.faction < 0 ||
        !Number.isInteger(arrow.rank) || arrow.rank < 0 || arrow.rank > maximumRank ||
        ![arrow.x, arrow.y, arrow.z, arrow.vx, arrow.vy, arrow.vz, arrow.age].every(Number.isFinite) ||
        (arrow.damageMultiplier !== undefined && ![1, 1.5].includes(arrow.damageMultiplier)) ||
        manualArrowLifetimeInvalid(arrow) ||
        arrow.age < 0 || arrow.age > 3 || (arrow.wall !== undefined && !byUid.has(arrow.wall)))
        return "Invalid military arrow";
      if (arrow.boulder && (!Number.isSafeInteger(arrow.boulder.target) || arrow.boulder.target < 0 ||
        ![arrow.boulder.x, arrow.boulder.y, arrow.boulder.z].every(Number.isFinite) ||
        (arrow.boulder.kind !== undefined && (!isCatapultAmmoKind(arrow.boulder.kind) ||
          arrow.boulder.kind === DEFAULT_CATAPULT_AMMO)) ||
        arrow.age > catapultBoulderFlight(arrow.boulder.kind) ||
        (arrow.boulder.restAge !== undefined && (!Number.isFinite(arrow.boulder.restAge) ||
          arrow.boulder.restAge < 0 || arrow.boulder.restAge > 4.5)) ||
        (arrow.boulder.roll !== undefined && (arrow.boulder.kind !== "marble" ||
          catapultRollError(arrow.boulder.roll))) ||
        (arrow.boulder.diameter !== undefined && (!Number.isFinite(arrow.boulder.diameter) ||
          arrow.boulder.diameter <= 0 || arrow.boulder.diameter > 1)) ||
        arrow.wall !== undefined)) return "Invalid catapult boulder";
      arrowIds.add(arrow.id);
    }
    const exchangeBuildings = new Set<number>(), exchangeActors = new Set<number>();
    if (combat.exchanges !== undefined && !Array.isArray(combat.exchanges)) return "Invalid doorway exchanges";
    for (const exchange of combat.exchanges ?? []) {
      const site = byUid.get(exchange.building), attacker = saved.soldiers.find(entry => entry.actor === exchange.attacker);
      const defender = saved.soldiers.find(entry => entry.actor === exchange.defender);
      const defenderBody = actors.find(body => body.uid === exchange.defender);
      // An approach reserves the next guard; it stays hidden until the attacker reaches the entrance.
      const waitingDefender = exchange.stage === "approach" && defender?.stationed &&
        defenderBody?.phase === "garrison" && !defenderBody.visible;
      if (!site || site.militaryFaction === undefined || !["approach", "duel", "capture", "return"].includes(exchange.stage) ||
        exchangeBuildings.has(exchange.building) || exchangeActors.has(exchange.attacker) ||
        (exchange.stage !== "return" && (!attacker || attacker.building !== -3 || attacker.combat?.siege !== site.uid ||
          actors.find(body => body.uid === attacker.actor)?.phase !== "militarySiege")) ||
        (exchange.defender !== undefined && (!defender || defender.building !== site.uid ||
          (!waitingDefender && (defender.stationed || defenderBody?.phase !== "militarySiege")) ||
          exchangeActors.has(defender.actor))) ||
        (exchange.stage !== "capture" && exchange.defender === undefined) ||
        (exchange.stage === "capture" && exchange.defender !== undefined)) return "Invalid doorway exchange references";
      if ((attacker && attacker.combat?.faction === site.militaryFaction) ||
        (defender && defender.combat?.faction !== site.militaryFaction) ||
        (exchange.stage !== "return" && defender && attacker?.combat?.type === "archer"))
        return "Invalid doorway factions or attacker";
      if (defender?.combat?.doorMelee && saved.soldiers.some(other => other.building === site.uid &&
        other.actor !== defender.actor && other.combat?.type !== "archer")) return "Archer released before melee defenders";
      exchangeBuildings.add(exchange.building); exchangeActors.add(exchange.attacker);
      if (exchange.defender !== undefined) exchangeActors.add(exchange.defender);
    }
    if (actors.some(body => body.phase === "militarySiege" && !exchangeActors.has(body.uid)))
      return "Untracked doorway combatant";
    if (saved.soldiers.some(soldier => soldier.combat?.doorMelee &&
      !(combat.exchanges ?? []).some(exchange => exchange.defender === soldier.actor)))
      return "Invalid doorway archer weapon";
    const doorIds = new Set<number>();
    for (const door of combat.doors) {
      if (!door || !byUid.has(door.building) || doorIds.has(door.building) ||
        !Number.isSafeInteger(door.faction) || door.faction < 0 ||
        !Number.isFinite(door.maximum) || door.maximum <= 0 ||
        !Number.isFinite(door.hp) || door.hp < 0 || door.hp > door.maximum || militaryStructureError(door.structure))
        return "Invalid military siege door";
      if (byUid.get(door.building)!.militaryFaction !== undefined && byUid.get(door.building)!.militaryFaction !== door.faction)
        return "Military ownership and door disagree";
      doorIds.add(door.building);
    }
    if (buildings.some(site => needsOwnedDoor(site, economyFaction) && !doorIds.has(site.uid)))
      return "Missing owned military door";
  } else if (buildings.some(site => needsOwnedDoor(site, economyFaction))) return "Missing owned military combat state";
  return null;
};

const validateCompositions = (
  entries: unknown, byUid: ReadonlyMap<number, SettlementContext["buildings"][number]>
) => {
  if (entries === undefined) return null;
  if (!Array.isArray(entries)) return "Invalid military garrison counts";
  const ids = new Set<number>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || ids.has(entry[0]))
      return "Invalid military garrison counts";
    const building = byUid.get(entry[0]);
    if (!building || !GARRISON_CAPACITIES[building.typeId] || !isValidComposition(building.typeId, entry[1]))
      return "Invalid military garrison counts";
    ids.add(entry[0]);
  }
  return null;
};
