import { fisheryYardSkiffAnchor } from "../../render-common/ships/fishing-skiff-yard";
import { isDrinkWorkAction } from "../../render-common/workers/drink-work-actions";
import { ownerOf } from "../../shared/settlement/settlement-ownership";
import { catapultPorterFor, updateCatapultBuildingFrame, updateCatapultWorkerFrame } from "./catapult-render-frame";
import { sampleMountGait } from "./mount-gait";
const EMPTY_MINE_INPUT_STOCK = Object.freeze({});
import { MOUNT_CLIPS } from "@workers/mount-clips";
import { WALK_GAIT } from "@workers/worker-locomotion";

import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import type { BuildingFrame } from "../../render-common/buildings/building-catalog";
import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../../render-common/buildings/building-world-sizing";
import { fortSiegeFrame } from "../../render-common/buildings/fort-siege-visual";
import { upgradedBuildingLevel } from "../../render-common/buildings/levels/building-level";
import { advanceMountEngagement, advanceMountGuard, type MountEngagement } from "../../render-common/mounts/mount-engage";
import type { MountFrame } from "../../render-common/mounts/mount-frame";
import { NATION_RIDERS } from "../../render-common/mounts/nation-riders";
import { DEATH_FALL_SECONDS, type MilitaryDeathFrame } from "../../render-common/settlement/death-smoke";
import { playerColorFromHex } from "../../render-common/settlement/player-color";
import type { DeckPassengerPose } from "../../render-common/ships/ship-deck-passengers";
import { cargoCarryWare } from "../../render-common/wares/ware-catalog";
import { adventureBanditStyle } from "../../render-common/workers/adventure-bandit-style";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import { fallenSoldierFrame } from "../../render-common/workers/worker-fall";
import {
  advanceGaitPhase, LOADED_RUN_BLEND, loadedCarryTimeIncrement, locomotionClipTime, runBlend
} from "../../render-common/workers/worker-gait";
import { createHitReactions } from "../../render-common/workers/worker-hit-reaction";
import { getJobAction, isFarmerJob } from "../../render-common/workers/worker-job-actions";
import { isBuildingFirstNation } from "../../render-common/workers/worker-nation";
import type { WorkerAppearance, WorkerFrame, WorkerNation } from "../../render-common/workers/worker-unit";
import type { AdventureTheme } from "../../shared/settlement/adventure-themes";
import { FISHER_BOAT_BEACH_SECONDS, FISHER_BOAT_LAUNCH_SECONDS, FISHER_BOAT_LIFT_SECONDS } from "../../shared/settlement/constants";
import type { MilitaryDeathEffect, MilitaryDoor } from "../../shared/settlement/military-combat-rules";
import { militaryWeaponType } from "../../shared/settlement/military-combat-rules";
import { getPalmGrowerPhase } from "../../shared/settlement/plantation-harvest";
import { storageDoorLeafOpenings } from "../../shared/settlement/settlement-door-activity";
import { HUNT_DRAW_SECONDS } from "../../shared/settlement/settlement-hunting";
import { militaryArmourRank } from "../../shared/settlement/settlement-military-ranks";
import { movementOutcome } from "../../shared/settlement/settlement-navigation-recovery";
import type { SettlementActor, SettlementBuilding, SettlementOptions } from "../../shared/settlement/settlement-types";
import { productionCycleRate } from "../../shared/settlement/workshop-upgrades";
import { createMotionSmoother } from "./actor-motion-smoothing";
import { DECK_TROOP_ACTOR_PHASE } from "./deck-troops-view";
import { fisherBasketVisible, fisherBoatLandAction } from "./fisher-boat-animation";
import { createPassThroughNudge } from "./pass-through-nudge";
import { blockedWalkAction, nextBlockedSeconds } from "./settlement-blocked-pose";

/** A building's drawn nation: one for every building, or each building's economy nation (EAI1a B6). */
type BuildingNationSource = WorkerNation | ((building: SettlementBuilding) => WorkerNation);

const ENEMY_FLAG_COLOR = playerColorFromHex("#c62828");
const noProductionBonus = () => 0;
const DRINK_WORK_SCALE = getRomanBuildingWorldSizing(getBuildingDefinition(6)).scale;

/** The renderer's building frame id of a settlement building (also its burn-down shell). */
export const settlementBuildingFrameId = (uid: number) => `settlement-${uid}`;

/** The bow draw follows the authoritative shot timer, including its release. */
const huntingDraw = (actor: SettlementActor): WorkerFrame["combat"] => {
  if (actor.job !== "Hunter") return undefined;
  if (actor.phase === "huntAim") return { attackProgress: 1 - actor.timer / HUNT_DRAW_SECONDS,
    faction: 0, type: "archer" };
  if (actor.phase === "huntFlight") return { attackProgress: .85, faction: 0, type: "archer" };
  return undefined;
};

/** Work actions whose simulation facing is aimed at the actor's target (cast point, tree, field). */
/** A ware hand-over plays its pickup/putdown clip; otherwise the job decides the clip. */
const actorAnimationAction = (actor: SettlementActor): WorkerFrame["action"] => {
  const boatAction = fisherBoatLandAction(actor);
  if (boatAction) return boatAction;
  if (!actor.wareTransfer) {
    return getJobAction(actor.job, actor.action, actor.ware, actor.fieldWork, getPalmGrowerPhase(actor));
  }
  return actor.wareTransfer.direction === "pickup" ? "pickup_material" : "putdown_material";
};
/**
 * Actions the simulation aims at their target when they start (a stock contact for ware pickups and
 * set-downs, a tree, field, cast, site or workstation), often in the same tick as the last step. The
 * standing figure turns (body and head) to that facing instead of keeping the way it walked.
 */
const TARGET_FACING_ACTIONS: ReadonlySet<SettlementActor["action"]> =
  new Set(["carry", "chop", "fish_cast", "fish_reel", "fish_wait", "plant", "work"]);

const updateBuildingStockFrame = (frame: BuildingFrame, building: SettlementBuilding) => {
  frame.wellBucketTaken = building.wellBucketTaken;
  frame.outputStock = [20, 41].includes(building.typeId)
    ? { ...building.output, seedling: building.nurserySeedlingTaken ? 5 : 6 } : building.output;
  frame.inputStock = building.construction === 1 && building.typeId >= 10 && building.typeId <= 13
    ? EMPTY_MINE_INPUT_STOCK : building.input;
};
type RenderSoldier = { actor: number; rank: number; commanderId?: string;
  combat?: import("../../shared/settlement/military-combat-rules").MilitaryCombatant };
type ManualGuard = { actor: number; guard: number; pitch?: number };
const manualBowPitchOf = (actor: number, combat: RenderSoldier["combat"], manual?: ManualGuard | null) => {
  if (manual?.actor !== actor || combat?.commanderLoadout !== "bow") return undefined;
  if (combat.pendingAim) return combat.pendingAim.pitch / 32768 * Math.PI;
  return manual.pitch ?? 0;
};
const guardThreats = (soldiers: readonly RenderSoldier[], commanders: ReadonlySet<number>,
  manual?: ManualGuard | null) => {
  const threatened = new Set(soldiers.flatMap(soldier =>
    soldier.combat?.pendingTarget !== undefined && (soldier.combat.attackTime ?? 0) > 0 ? [soldier.combat.pendingTarget] : []));
  const guarding = manual && manual.guard > 0 && commanders.has(manual.actor) ? manual.actor : undefined;
  if (guarding !== undefined) threatened.add(guarding);
  return { guarding, threatened };
};
/** Enemies the player's soldiers chase while they see them (targetMilitary): drawn with a red ground ring. */
const chasedUnits = (soldiers: readonly RenderSoldier[]) => {
  const chased = new Set<number>();
  for (const { combat } of soldiers) {
    const chase = combat?.chase;
    if (chase && !chase.lost && combat.faction === 0) chased.add(chase.uid);
  }
  return chased;
};
/**
 * `templates`: the player's worker appearances; `enemyAppearances`: the bodies of the enemy army
 * against a player of that nation (its own nation's soldiers, enemy-nation.ts), none = the player's.
 */
export const createSettlementRenderFrames = (
  templates: readonly WorkerFrame[],
  enemyAppearances: (playerNation: WorkerNation) => readonly WorkerAppearance[] = () => [],
  stockContact?: SettlementOptions["stockContact"],
  groundHeight?: (x: number, z: number) => number
) => {
  if (!templates.length) throw new Error("Settlement rendering needs worker appearances");
  let enemies = enemyAppearances(templates[0]!.nation);
  /** A soldier's body: enemies (faction > 0) wear their own nation's bodies and gear. */
  const appearanceOf = (uid: number, faction = 0): WorkerAppearance => {
    const list = faction > 0 && enemies.length ? enemies : templates;
    const { nation, variant } = list[uid % list.length]!;
    return { nation, variant };
  };
  const workers: WorkerFrame[] = [];
  const groundWorkers: WorkerFrame[] = [];
  const cavalryMounts: MountFrame[] = [];
  const mountedCache = new Map<number, MountFrame>();
  /** Smoothed cavalry ground speed, so gait clips do not flicker between ticks. */
  const mountedSpeed = new Map<number, number>();
  /** Per rider: how far its horse has turned to the target it fights. */
  const mountEngagement = new Map<number, MountEngagement>();
  const motion = createMotionSmoother();
  const nudge = createPassThroughNudge();
  const hits = createHitReactions();
  /** Last drawn figure of soldiers that just disappeared; a death shows them falling. */
  const departed = new Map<number, WorkerFrame>();
  /** Last drawn rider and horse of cavalry that just disappeared. */
  const departedMounts = new Map<number, MountFrame>();
  const forgetDeparted = (deaths: readonly MilitaryDeathEffect[]) => {
    const dying = new Set(deaths.map(death => death.id));
    for (const uid of departed.keys()) if (!dying.has(uid)) departed.delete(uid);
    for (const uid of departedMounts.keys()) if (!dying.has(uid)) departedMounts.delete(uid);
  };
  /** A fallen foot soldier tips over forwards from his feet, weapon dropped. */
  const fallOnFoot = (body: WorkerFrame, t: number) => {
    const fallen = fallenSoldierFrame(body, t * DEATH_FALL_SECONDS);
    if (fallen) workers.push(fallen);
  };
  /** A slain rider goes down with his horse onto its side, standing still. */
  const fallMounted = (mount: MountFrame, t: number) =>
    cavalryMounts.push({ ...mount, attackProgress: null, clip: "idle", clipTime: 0, fall: t,
      selected: false, turnRate: 0 });
  /**
   * Falling figures for the deaths of this frame, and each death as drawn: its smoke follows the
   * fallen figure's heading and covers a horse as well.
   */
  const addFallen = (deaths: readonly MilitaryDeathEffect[]): MilitaryDeathFrame[] => {
    forgetDeparted(deaths);
    return deaths.map(death => {
      const mount = departedMounts.get(death.id), body = departed.get(death.id);
      const t = death.age / DEATH_FALL_SECONDS, falling = death.age < DEATH_FALL_SECONDS;
      if (mount && falling) fallMounted(mount, t);
      else if (body && falling) fallOnFoot(body, t);
      const heading = mount?.heading ?? body?.heading;
      return { ...death, mounted: Boolean(mount), ...(heading === undefined ? {} : { yaw: heading }) };
    });
  };
  /** Per soldier: swings started so far, and whether one is under way. */
  const swings = new Map<number, { count: number; attacking: boolean }>();
  /** Every new swing picks the next move, offset per soldier so a line does not move in unison. */
  const swingVariant = (uid: number, attackProgress: number | null) => {
    const state = swings.get(uid) ?? { attacking: false, count: 0 };
    if (attackProgress !== null && !state.attacking) state.count++;
    state.attacking = attackProgress !== null;
    swings.set(uid, state);
    return (uid + state.count) % 6;
  };
  const workerCache = new Map<number, WorkerFrame>();
  /** Seconds each drawn worker has stood still in a blocked or queued movement outcome. */
  const blockedSeconds = new Map<number, number>();
  const buildings: BuildingFrame[] = [];
  const buildingCache = new Map<number, BuildingFrame>();
  const groundBoats = new Map<number, { x: number; z: number }>();
  const yardBoats = new Map<number, NonNullable<WorkerFrame["fisherBoatYard"]>>();
  const setAppearances = (appearances: readonly WorkerAppearance[]) => {
    if (!appearances.length) return;
    templates.forEach((template, index) => Object.assign(template, appearances[index % appearances.length]));
    enemies = enemyAppearances(appearances[0]!.nation);
    for (const [uid, frame] of workerCache) Object.assign(frame, appearanceOf(uid, frame.combat?.faction ?? frame.civilianFaction));
  };
  /**
   * `doors`: military doors; a colony fort's walls under assault show fires, collapse and a hit point bar.
   * `productionBonus`: a type's production talent share, so work clips play at the simulated rate.
   */
  const updateBuildings = (entries: readonly SettlementBuilding[], nation: BuildingNationSource = "roman",
    doors: readonly MilitaryDoor[] = [], productionBonus: (typeId: number) => number = noProductionBonus) => {
    yardBoats.clear(); groundBoats.clear();
    const nationFor = typeof nation === "function" ? nation : () => nation;
    const walls = new Map(doors.flatMap(door => door.structure ? [[door.building, door.structure] as const] : []));
    for (let index = buildings.length - 1; index >= 0; index--)
      if (buildings[index]!.demolitionAge !== undefined) buildings.splice(index, 1);
    const active=new Set(entries.map(building=>building.uid));
    for(const [uid,frame] of buildingCache)if(!active.has(uid)){
      buildingCache.delete(uid);const index=buildings.indexOf(frame);if(index>=0)buildings.splice(index,1);
    }
    for (const building of entries) {
      if (building.typeId === 18 && building.fisherBoat?.place === "dropped")
        groundBoats.set(building.uid, building.fisherBoat);
      if (building.typeId === 18 && !building.fisherBoat && (building.input.boat ?? 0) > 0)
        yardBoats.set(building.uid, { ...fisheryYardSkiffAnchor(nationFor(building), building), y: building.y });
      let frame = buildingCache.get(building.uid);
      if (!frame) {
        frame = { id: settlementBuildingFrameId(building.uid), type: building.typeId, x: building.x,
          y: building.y, z: building.z, rotation: 0, construction: 0, working: false, door: 0,
          playerColor: [0.13, 0.32, 0.7], windStrength: 0.7, windDirection: 0.35 };
        buildingCache.set(building.uid, frame); buildings.push(frame);
      }
      frame.x = building.x; frame.z = building.z; frame.y = building.y;
      frame.nation = nationFor(building);
      frame.owner = ownerOf(building);
      frame.bandit = building.bandit;
      frame.enemyCatapultVariant = building.enemyCatapultVariant;
      frame.enemyCampEnclosure = building.enemyCampEnclosure;
      frame.eventCourtyardWalls = building.eventCourtyard?.walls.map(wall => wall.hp / wall.maximum);
      if (frame.owner > 0) frame.playerColor = ENEMY_FLAG_COLOR;
      frame.rotation = building.rotation * Math.PI / 2;
      frame.construction = building.construction; frame.working = building.working;
      frame.windowLit = building.construction >= 1 &&
        (building.working || building.worker !== undefined);
      frame.productionPaused = building.productionPaused === true;
      frame.level = upgradedBuildingLevel(building.workshopUpgrade?.level);
      frame.workRate = productionCycleRate(building, productionBonus(building.typeId), building.selectedOutput);
      frame.workTime = building.workTime;
      updateCatapultBuildingFrame(frame, building, stockContact);
      frame.pigFeedPhase = building.pigFeedPhase ?? null;
      updateBuildingStockFrame(frame, building);
      if (building.workshopUpgrade?.requested) {
        frame.upgradeProgress = building.workshopUpgrade.progress ?? 0;
        const delivered = building.workshopUpgrade.reserved;
        if (delivered && Object.values(delivered).some(count => count > 0))
          frame.upgradeStock = { ...delivered };
      } else {
        frame.upgradeProgress = undefined;
        frame.upgradeStock = undefined;
      }
      frame.door = building.door; frame.balconyDoor = building.typeId === 14 ? building.door : 0;
      frame.doorLeaves = storageDoorLeafOpenings(building);
      frame.fortSiege = fortSiegeFrame(walls.get(building.uid), isOpenArcherTower(building));
    }
  };
  const mountFrame = (
    actor: SettlementActor, pose: { x: number; y: number; yaw: number; z: number },
    combat: import("../../shared/settlement/military-combat-rules").MilitaryCombatant, dt: number,
    threatened: boolean, isCommander: boolean, manualGuard = false, manualBowPitch?: number, manualControl = false
  ): MountFrame => {
    const previous = mountedCache.get(actor.uid);
    const distance = previous ? Math.hypot(pose.x - previous.x, pose.z - previous.z) : 0;
    const clip = sampleMountGait(mountedSpeed, actor.uid, distance, dt, previous);
    const { nation } = appearanceOf(actor.uid, combat.faction);
    const angle = previous ? Math.atan2(Math.sin(pose.yaw - previous.heading), Math.cos(pose.yaw - previous.heading)) : 0;
    const phase = previous ? previous.clipTime / MOUNT_CLIPS[previous.clip].duration : 0;
    const strides = clip === "idle" ? 0 : distance / (MOUNT_CLIPS[clip].speed * WORKER_SCALE);
    const attackProgress = (combat.attackTime ?? 0) > 0 ? 1 - combat.attackTime! / .6 : null;
    const engagement = advanceMountEngagement(mountEngagement.get(actor.uid), attackProgress !== null && combat.commanderLoadout !== "bow",
      clip === "trot" || clip === "gallop", dt);
    mountEngagement.set(actor.uid, engagement);
    // A rider an enemy winds up a blow at parries with its sword (riders carry no shield).
    const guard = advanceMountGuard(previous?.guard, threatened && attackProgress === null, dt);
    const commander = isCommander;
    const frame: MountFrame = {
      actorId: actor.uid, coat: ["bay", "chestnut", "dark-bay"][actor.uid % 3]!,
      rider: NATION_RIDERS[nation], nation, faction: combat.faction, selected: combat.selected,
      attackProgress, engage: engagement.engage, guard, x: pose.x, y: pose.y, z: pose.z, heading: pose.yaw, clip,
      clipTime: clip === "idle" ? actor.animationTime % MOUNT_CLIPS.idle.duration
        : (phase * MOUNT_CLIPS[clip].duration + strides) % MOUNT_CLIPS[clip].duration,
      turnRate: dt > 0 ? angle / dt : 0,
      commander, commanderLoadout: combat.commanderLoadout, manualGuard: manualGuard || Boolean(previous?.manualGuard && guard > .01),
      manualBowPitch,
      manualControl,
      auraActive: commander && combat.hp > 0 && actor.phase !== DECK_TROOP_ACTOR_PHASE &&
        actor.phase !== "navalAboard"
    };
    mountedCache.set(actor.uid, frame);
    return frame;
  };
  const updateWorkers = (
    actors: readonly SettlementActor[], dt: number,
    soldiers: readonly RenderSoldier[] = [],
    tickFraction = 1, adventureTheme?: AdventureTheme, manualGuard?: ManualGuard | null,
    deckPoses?: ReadonlyMap<number, DeckPassengerPose>
  ) => {
    const drawn = new Set<number>();
    const ranks = new Map(soldiers.map(soldier => [soldier.actor, soldier.rank]));
    const combatants = new Map(soldiers.map(soldier => [soldier.actor, soldier.combat]));
    const commanders = new Set(soldiers.filter(soldier => soldier.commanderId).map(soldier => soldier.actor));
    // Soldiers an enemy is winding up a blow at: they raise their shield or shaft.
    const { guarding, threatened } = guardThreats(soldiers, commanders, manualGuard);
    const chased = chasedUnits(soldiers);
    // Directional shield reaction: the bearing from the defender to the attacker winding up.
    const actorById = new Map(actors.map(actor => [actor.uid, actor]));
    const threatYaw = new Map<number, number>();
    for (const soldier of soldiers) {
      const target = soldier.combat?.pendingTarget;
      if (target === undefined || (soldier.combat?.attackTime ?? 0) <= 0) continue;
      const attacker = actorById.get(soldier.actor), victim = actorById.get(target);
      if (attacker && victim) threatYaw.set(target, Math.atan2(attacker.x - victim.x, attacker.z - victim.z));
    }
    const visible = new Set<number>();
    workers.length = 0;
    groundWorkers.length = 0;
    cavalryMounts.length = 0;
    if (guarding !== undefined) threatYaw.delete(guarding);
    for (const actor of actors) {
      if (!actor.visible || actor.uid < 0 || actor.job === "Mount") continue;
      const mounted = (actor as SettlementActor & { mounted?: boolean }).mounted === true;
      // Deck troops and passengers are posed with the drawn hull, never walked; passengers use the
      // exact drawn deck pose so a moving, bobbing ship cannot leave them behind.
      const porter = catapultPorterFor(actor, buildingCache);
      const onDeck = actor.phase === "navalAboard" ? deckPoses?.get(actor.uid) : undefined;
      let pose: Pick<SettlementActor, "x" | "y" | "yaw" | "z">;
      if (onDeck) pose = onDeck;
      else if (actor.catapultOperator || actor.catapultEvacuation ||
        (porter && actor.phase === "catapultResupply") || actor.phase === DECK_TROOP_ACTOR_PHASE) pose = actor;
      else pose = motion.smooth(actor.uid, actor, tickFraction, dt, TARGET_FACING_ACTIONS.has(actor.action),
        mounted || commanders.has(actor.uid));
      drawn.add(actor.uid);
      if (combatants.get(actor.uid)?.type === "cavalry" && mounted) {
        const mount = mountFrame(actor, pose, combatants.get(actor.uid)!, dt, threatened.has(actor.uid),
          commanders.has(actor.uid), guarding === actor.uid,
          manualBowPitchOf(actor.uid, combatants.get(actor.uid), manualGuard), manualGuard?.actor === actor.uid);
        mount.targeted = chased.has(actor.uid);
        cavalryMounts.push(mount);
        continue;
      }
      visible.add(actor.uid);
      let frame = workerCache.get(actor.uid);
      const wasVisible = Boolean(frame);
      if (!frame) {
        frame = { ...templates[actor.uid % templates.length]!,
          ...appearanceOf(actor.uid, combatants.get(actor.uid)?.faction ?? actor.hostileCivilianFaction),
          actorId: actor.uid,
          visible: true, carryingWare: null, selected: false, action: "idle_breathe",
          gaitPhase: 0, runBlend: 0, animationTime: 0, target: null };
        workerCache.set(actor.uid, frame);
      }
      if (commanders.has(actor.uid)) frame.variant = NATION_RIDERS[frame.nation];
      workers.push(frame);
      if (actor.phase !== "navalAboard" && actor.phase !== "catapultResupply" && !actor.catapultOperator && !actor.catapultEvacuation) groundWorkers.push(frame);
      const aside = nudge.offset(actor.uid);
      const moved = actor.visible && wasVisible
        ? Math.hypot(pose.x - frame.x + aside.x, pose.z - frame.z + aside.z) : 0;
      let action = onDeck?.observing && actor.job === "Scout" ? "spyglass_scan" : actorAnimationAction(actor);
      const outcome = movementOutcome(actor);
      const blocked = nextBlockedSeconds(blockedSeconds.get(actor.uid) ?? 0, outcome, moved, dt);
      blockedSeconds.set(actor.uid, blocked);
      action = blockedWalkAction(action, blocked);
      const actionChanged = frame.action !== action;
      frame.visible = actor.visible;
      frame.x = pose.x; frame.y = pose.y; frame.z = pose.z;
      frame.heading = onDeck?.observing && action === "spyglass_scan" ? onDeck.observingYaw : pose.yaw;
      frame.lean = actor.lean; frame.windowSillRise = actor.windowSillRise;
      frame.action = action; frame.workerJob = actor.job;
      frame.civilianFaction = actor.hostileCivilianFaction;
      frame.propNation = buildingCache.get(actor.building)?.nation ?? frame.nation;
      const rank = ranks.get(actor.uid) ?? 0;
      frame.armourRank = undefined;
      if (actor.job === "Soldier") {
        frame.armourRank = militaryArmourRank(rank);
        if (commanders.has(actor.uid)) frame.armourRank = "centurion";
      }
      // A trade box shows as a closed crate, not as its goods (owner, 2026-10-21).
      const yardDelivery = actor.wareTransfer?.ware === "boat" && actor.wareTransfer.direction === "putdown" &&
        buildingCache.get(actor.stockBuilding ?? -1)?.type === 18 ? actor.wareTransfer : undefined;
      frame.fisherBoatYard = yardDelivery ? { ...yardDelivery.target, yaw: yardDelivery.yaw ?? 0 }
        : actor.phase === "fisherBoatLift" ? yardBoats.get(actor.building ?? -1) : undefined;
      const groundBoat = actor.phase === "fisherBoatLift" ? groundBoats.get(actor.building ?? -1) : undefined;
      frame.fisherBoatTransferBaseY = groundBoat ? groundHeight?.(groundBoat.x, groundBoat.z) : undefined;
      frame.fisherBasket = fisherBasketVisible(actor);
      frame.carryingWare = frame.fisherBasket ? "fish" :
        actor.phase === "fisherBoatLift" ? "boat" :
          actor.ware && actor.wareUnits !== undefined ? cargoCarryWare(actor.ware) : actor.ware;
      frame.workerTool = isFarmerJob(actor.job) &&
        (actor.fieldWork !== "harvest" || !["outbound", "work"].includes(actor.phase)) ? undefined : actor.tool; frame.selected = false;
      frame.standingCarry = !actor.catapultOperator?.walking && Boolean(actor.ware && !actor.wareTransfer &&
        (actor.action === "idle" || (outcome !== "moving" && moved <= 0)));
      frame.horseLead = undefined;
      frame.wareTransfer = actor.wareTransfer;
      updateCatapultWorkerFrame(frame, actor, porter);
      frame.wellWork = actor.wellWork;
      frame.drinkWork = undefined;
      if (actor.phase === "work" && isDrinkWorkAction(action)) {
        const workplace = buildingCache.get(actor.building);
        if (workplace?.type === 6 && workplace.nation && isBuildingFirstNation(workplace.nation)) {
          const elapsed = Math.max(0, (actor.productionSeconds ?? 16) - actor.timer);
          workplace.workTime = elapsed;
          frame.drinkWork = { elapsed, nation: workplace.nation,
            origin: [workplace.x, workplace.y, workplace.z], rotation: workplace.rotation, scale: DRINK_WORK_SCALE };
        }
      }
      frame.shipHullWork = actor.job === "Shipwright" && actor.phase === "shipWork";
      frame.fieldWork = actor.action === "work" ? actor.fieldWork : undefined;
      frame.plantationSiteId = (action === "lift_honeycomb" || action === "pick_grapes" || isDrinkWorkAction(action)) &&
        actor.target?.kind === "field" ? actor.target.id : undefined;
      frame.foresterSeedling = actor.foresterSeedling;
      frame.fishingTarget = actor.target?.kind === "fish" && action.startsWith("fish_")
        ? { x: actor.target.x, y: actor.target.y ?? 0, z: actor.target.z } : undefined;
      const combat = combatants.get(actor.uid);
      frame.fall=combat?.towerFall?Math.sin(Math.PI*(1-combat.towerFall.remaining/.8))*.22:undefined;
      const attackProgress = combat && (combat.attackTime ?? 0) > 0 ? 1 - combat.attackTime! / .6 : null;
      frame.combat = combat ? { attackProgress, manualGuard: guarding === actor.uid, defending: attackProgress === null && threatened.has(actor.uid),
        manualBowPitch: manualBowPitchOf(actor.uid, combat, manualGuard),
        threatYaw: attackProgress === null ? threatYaw.get(actor.uid) : undefined,
        // Archers always fight with the bow (owner 2026-10-13), even at a door or when cornered.
        doorMelee: combat.type !== "archer" && (combat.doorMelee || combat.closeQuarters), faction: combat.faction,
        type: militaryWeaponType(combat),
        bandit: combat.faction > 0 ? adventureBanditStyle(actor.uid, adventureTheme) : undefined,
        flinch: hits.update(actor.uid, combat.hp, dt),
        variant: swingVariant(actor.uid, attackProgress) } : huntingDraw(actor);
      if (actor.catapultOperator || porter || actor.catapultEvacuation) { frame.combat = undefined; frame.workerTool = undefined; }
      frame.selected = combat?.selected ?? false;
      frame.targeted = chased.has(actor.uid);
      frame.carriedWareScale = actor.wareScale;
      frame.target = actor.path[actor.pathIndex] ?? null;
      if (actionChanged) frame.animationTime = 0;
      const moving = action === "walk" || action === "carry_shoulder" || action === "carry_back";
      if (moving && moved > 0 && dt > 0) {
        const speed = actor.locomotionSpeed ?? moved / dt;
        const loaded = action === "carry_shoulder" || action === "carry_back";
        // Carriers always walk (owner BAL-01), loaded or not: a brisk stride, never a run.
        const walksOnly = loaded || actor.job === "Carrier";
        const blend = walksOnly ? Math.min(LOADED_RUN_BLEND, runBlend(speed)) : runBlend(speed);
        frame.runBlend = blend;
      }
      else if (!moving) frame.runBlend = 0;
      frame.gaitPhase = action === "carry_overhead_boat"
        ? (frame.gaitPhase + moved / (WALK_GAIT.sweep * .75 / WALK_GAIT.stance * WORKER_SCALE)) % 1
        : advanceGaitPhase(frame.gaitPhase, moved, frame.runBlend);
      if (action === "walk") frame.animationTime = locomotionClipTime("walk", frame.gaitPhase);
      else if (action === "carry_shoulder" || action === "carry_back") frame.animationTime += loadedCarryTimeIncrement(action, moved);
      else frame.animationTime = actor.animationTime;
      if (actor.phase === "fisherBoatLift") frame.animationTime = Math.max(0, FISHER_BOAT_LIFT_SECONDS - actor.timer);
      if (actor.phase === "fisherBoatLaunch") frame.animationTime = Math.max(0, FISHER_BOAT_LAUNCH_SECONDS - actor.timer);
      if (actor.phase === "fisherBoatBeach") frame.animationTime = action === "fish_basket_pickup"
        ? Math.max(0, 1 - actor.timer) : Math.max(0, FISHER_BOAT_BEACH_SECONDS - actor.timer);
      if (onDeck && action === "spyglass_scan") frame.animationTime = onDeck.observationSeconds;
      if (action === "idle_breathe" && !Number.isFinite(frame.animationTime)) frame.animationTime += dt;
    }
    nudge.apply(groundWorkers, dt); nudge.retain(visible);
    for (const [uid, frame] of workerCache) if (!visible.has(uid)) {
      departed.set(uid, frame); workerCache.delete(uid); blockedSeconds.delete(uid);
    }
    const mountedIds = new Set(cavalryMounts.map(frame => frame.actorId));
    for (const [uid, frame] of mountedCache) if (!mountedIds.has(uid)) {
      departedMounts.set(uid, frame); mountedCache.delete(uid); mountedSpeed.delete(uid); mountEngagement.delete(uid);
    }
    motion.retain(drawn);
    hits.retain(drawn);
    for (const uid of swings.keys()) if (!drawn.has(uid)) swings.delete(uid);
  };
  return { addFallen, buildings, cavalryMounts, workers, updateBuildings, updateWorkers, setAppearances };
};
