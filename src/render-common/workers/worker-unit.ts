import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { HandcartPose } from "../logistics/handcart-frame";
import { createPathFinder, MAX_PATH_POINTS } from "../wildlife/nav/nav-path";
import { isSegmentWalkable, isStandFree, type NavWorld } from "../wildlife/nav/nav-query";
import { SPECIES } from "../wildlife/wildlife-species";
import {
  advanceGaitPhase,
  easeGaitSpeed,
  isRunTrip,
  type LocomotionAction,
  locomotionAction,
  locomotionClipTime,
  routeDistance,
  runBlend,
  targetGaitSpeed,
  WALK_SPEED
} from "./worker-gait";
import type { WorkerNation } from "./worker-nation";
import { createWorkerVision, type SharedSight, WORKER_SIGHT_RADIUS } from "./worker-vision";

export type { BuildingFirstNation, SettlerNation, WorkerNation } from "./worker-nation";
export { isBuildingFirstNation, settlerNation } from "./worker-nation";

export interface WorkerAppearance {
  nation: WorkerNation;
  /** Body: the id of one of the nation's Tripo3D workers (`@workers/tripo-roster`). */
  variant: string;
}
/**
 * One body the possessed view will show up close: preloaded before the camera moves (C11). It
 * carries the armour rank because soldier bodies resolve a different authored level chain per rank.
 */
export interface ExplorationHeroBody extends WorkerAppearance {
  armourRank?: WorkerFrame["armourRank"];
}
/** What a standing worker does (debug: `__workers.setStandingAction`, worker screenshots). */
export type StandingAction = import("./drink-work-actions").DrinkWorkAction | "idle_breathe" | "chop_tree" | "carry_shoulder" | "carry_back"
  | "carry_overhead_boat" | "boat_lift" | "boat_putdown" | "boat_launch" | "boat_beach" | "fish_basket_pickup"
  | "row_single" | "net_cast" | "net_haul"
  | "build_hammer" | "harvest_wheat" | "harvest_flax" | "weave_loom" | "dig" | "plant_seedling"
  | "fish_cast" | "fish_wait" | "fish_reel" | "pickup_material" | "putdown_material" | "look_around"
  | "spyglass_scan" | "push_trunk" | "lift_honeycomb" | "pick_grapes";
export interface WorkerFrame extends WorkerAppearance {
  /** Render-only packaging for the fisher's four-fish catch. */
  fisherBasket?: boolean;
  fisherBoatTransferBaseY?: number;
  /** Stored hull at the Fishery wall; preserves its exact first lifting pose. */
  fisherBoatYard?: { x: number; y: number; z: number; yaw: number };
  /** World-space rim contacts supplied by the currently drawn launching/beaching skiff. */
  fisherBoatHands?: readonly [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
  fisherBoatBoarding?: { seat: { x: number; y: number; z: number }; facing: number; progress: number;
    grips: readonly [{ point: { x: number; y: number; z: number }; axis: { x: number; y: number; z: number } },
      { point: { x: number; y: number; z: number }; axis: { x: number; y: number; z: number } }] };
  /** Hostile civilian appearance only; never a combatant or military crew slot. */
  civilianFaction?: number;
  catapultStoneDiameter?: number;
  /** Stone kind currently carried by a catapult carrier/porter (CAT-3 tint). */
  catapultStoneKind?: import("../../shared/settlement/catapult-ammo-kinds").CatapultAmmoKind;
  catapultCarryPoint?: {x:number;y:number;z:number};
  catapultHandWeight?: number;
  catapultTuckedCarry?: boolean;
  catapultReverseWalk?: boolean;
  catapultHands?: readonly [readonly [number, number, number], readonly [number, number, number]];
  /** Building-first nations reuse a body while retaining the nation's own carried work props. */
  propNation?: WorkerNation;
  /** Stable simulation ID; active render frames are compact rather than indexed by this ID. */
  actorId?: number;
  /** Presentation opacity 0–1 while fading out or in (a cut-off carrier moved to storage); absent: 1. */
  fade?: number;
  combat?: { type: import("../../shared/settlement/military-combat-rules").MilitaryTroopType;
    doorMelee?: boolean; faction: number; attackProgress: number | null;
    /** Which attack move this swing uses (varies per swing). */
    variant?: number;
    /** New themed adventure enemies only; cosmetic, never a different combat unit type. */
    bandit?: import("./adventure-bandit-style").AdventureBanditStyle;
    /** An enemy is winding up a blow at this soldier: raise the shield or block with the shaft. */
    defending?: boolean;
    /** Authoritative player guard uses a forward, eye-clear hand placement. */
    manualGuard?: boolean;
    manualBowPitch?: number;
    /** World bearing of the incoming attacker while defending; the shield turns towards it. */
    threatYaw?: number;
    /** 0..1 through a flinch after taking a hit (worker-hit-reaction.ts); absent otherwise. */
    flinch?: number;
 };
  /** Fallen figures retain their headgear after combat gear is dropped. */
  fallenBandit?: import("./adventure-bandit-style").AdventureBanditStyle;
  /** Equipment tier; absent for civilians. Simulation ranks 0/1/2 map to the three tiers. */
  horseLead?: { horseId: number; target?: { x: number; y: number; z: number } };
  /** The hand cart this worker pulls: the hands grip its shafts. */
  handcart?: HandcartPose;
  armourRank?: "recruit" | "soldier" | "centurion";
  fieldWork?: "sow" | "harvest";
  /** Render-only field identity for hand-held plantation props; no cargo or save ownership. */
  plantationSiteId?: number;
  shipHullWork?: boolean;
  foresterSeedling?: { target: { x: number; y: number; z: number }; scale: number; progress?: number; planting?: number };
  fishingTarget?: { x: number; y: number; z: number };
  wellWork?: import("../buildings/well-work-cycle").WellWorkFrame;
  drinkWork?: import("../buildings/expansion-drink-motion").DrinkWorkFrame;
  /** Settlers resting inside storage buildings stay in the pool but are not drawn. */
  visible?: boolean;
  carryingWare?: string | null;
  /** Keep the cargo-support pose while the lower body stands naturally in a queue. */
  standingCarry?: boolean;
  carriedWareScale?: { x: number; y: number; z: number };
  wareTransfer?: {
    presentation?: "hanging";
    pour?: boolean;
    direction: "pickup" | "putdown";
    ware: string;
    progress: number;
    target: { x: number; y: number; z: number };
    yaw?: number;
    scale?: number;
    scale3?: { x: number; y: number; z: number };
  };
  workerJob?: string;
  workerTool?: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Forward tilt about the feet (radians), e.g. a soldier leaning out of a window. */
  lean?: number;
  /** Sill top above the feet (world units) of a window soldier resting his forearms on it; render only. */
  windowSillRise?: number;
  /** 0..1 through a fallen soldier's collapse (worker-fall.ts): knees give way, then it tips over. */
  fall?: number;
  selected: boolean;
  /** An enemy the player's soldiers chase (targetMilitary): a red ground ring; presentation only. */
  targeted?: boolean;
  action: StandingAction | LocomotionAction;
  /** Seconds into the current action's clip. */
  animationTime: number;
  /** Shared walk / run cycle phase (0..1, left touchdown at 0). */
  gaitPhase: number;
  /** Walk to run crossfade weight (0..1). */
  runBlend: number;
  target: { x: number; z: number } | null;
}
/** The deer mask has a conservative body footprint suitable for the workers. */
export const WORKER_NAV_SPECIES = SPECIES.deer;
const SPAWN_RINGS = 24;
const SPAWN_RING_STEP = 0.25;

/** The free standing spot nearest to (x, z) on rings around it, or null. */
export const findStandSpot = (nav: NavWorld, x: number, z: number) => {
  for (let ring = 0; ring <= SPAWN_RINGS; ring++) {
    const steps = Math.max(1, ring * 16);
    for (let step = 0; step < steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      const spotX = x + Math.cos(angle) * ring * SPAWN_RING_STEP;
      const spotZ = z + Math.sin(angle) * ring * SPAWN_RING_STEP;
      if (isStandFree(nav, WORKER_NAV_SPECIES, spotX, spotZ)) return { x: spotX, z: spotZ };
    }
  }
  return null;
};
/**
 * Where a worker sent to (x, z) goes: there when it may stand there, else the nearest spot it
 * may stand on (a command onto a tree, a river, rock); null when there is none near.
 */
export const resolveWorkerTarget = (nav: NavWorld, x: number, z: number) =>
  isStandFree(nav, WORKER_NAV_SPECIES, x, z) ? { x, z } : findStandSpot(nav, x, z);

/** One controllable worker. Reuse the existing conservative land navigation
 * clearance, so commands cannot walk through trees, rocks, water or cliffs. */
export const createWorkerUnit = (
  world: WorldData,
  nav: NavWorld,
  appearance: WorkerAppearance,
  origin: { x: number; z: number } = world.start,
  /** Shared sight of the group; null: the worker reveals no fog (a settlement's simulation owns it). */
  sight?: SharedSight | null
) => {
  const species = WORKER_NAV_SPECIES;
  const frame: WorkerFrame = {
    ...appearance,
    x: origin.x,
    y: 0,
    z: origin.z,
    heading: Math.PI,
    selected: false,
    action: "idle_breathe",
    animationTime: 0,
    gaitPhase: 0,
    runBlend: 0,
    target: null
  };
  const spawn = findStandSpot(nav, origin.x, origin.z);
  if (!spawn) throw new Error("No walkable worker spawn near the starting area");
  frame.x = spawn.x;
  frame.z = spawn.z;
  frame.y = sampleSmooth(world, world.heights, frame.x, frame.z);
  const vision = sight === null ? undefined : createWorkerVision(world, WORKER_SIGHT_RADIUS, sight);
  vision?.update(frame.x, frame.z);
  const finder = createPathFinder(nav),
    path = new Float32Array(MAX_PATH_POINTS * 2);
  let count = 0,
    index = 0,
    runTrip = false,
    speed = WALK_SPEED,
    standing: StandingAction = "idle_breathe";
  /** A worker left off its ground (the land changed under it) steps to the nearest spot. */
  const stepOntoGround = () => {
    if (isStandFree(nav, species, frame.x, frame.z)) return;
    const spot = findStandSpot(nav, frame.x, frame.z);
    if (!spot) return;
    frame.x = spot.x;
    frame.z = spot.z;
  };
  const plan = (x: number, z: number) => {
    const target = resolveWorkerTarget(nav, x, z);
    if (!target) return false;
    stepOntoGround();
    const next = finder.findPath(species, frame.x, frame.z, target.x, target.z, path);
    if (!next) return false;
    count = next;
    index = 0;
    frame.target = target;
    return true;
  };
  const remainingRoute = () =>
    frame.target ? routeDistance(frame.x, frame.z, path, index, count, frame.target) : 0;
  /** Sends the worker to (x, z) whether or not it is selected (the group's own moves). */
  const redirect = (x: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !plan(x, z)) return false;
    runTrip = isRunTrip(remainingRoute());
    return true;
  };
  const command = (x: number, z: number) => frame.selected && redirect(x, z);
  const stop = () => {
    count = 0;
    frame.target = null;
  };
  /** A sidestep left the route's straight line blocked: plan again from here, or give up. */
  const replanBlocked = () => {
    const target = frame.target;
    if (!target || !plan(target.x, target.z)) stop();
  };
  const followPath = (dt: number) => {
    let remaining = speed * dt,
      moved = 0;
    while (index < count && remaining > 0) {
      const dx = path[index * 2]! - frame.x,
        dz = path[index * 2 + 1]! - frame.z,
        distance = Math.hypot(dx, dz);
      if (distance < 0.015) {
        index++;
        continue;
      }
      const step = Math.min(distance, remaining),
        x = frame.x + (dx / distance) * step,
        z = frame.z + (dz / distance) * step;
      if (!isSegmentWalkable(nav, species, frame.x, frame.z, x, z)) {
        replanBlocked();
        break;
      }
      frame.x = x;
      frame.z = z;
      moved += step;
      remaining -= step;
      const angle = Math.atan2(dx, dz),
        difference = Math.atan2(Math.sin(angle - frame.heading), Math.cos(angle - frame.heading));
      frame.heading += Math.max(-dt * 8, Math.min(dt * 8, difference));
      if (step === distance) index++;
    }
    return moved;
  };
  const replanAtPathEnd = () => {
    if (index < count || !frame.target) return;
    const target = frame.target;
    if (Math.hypot(target.x - frame.x, target.z - frame.z) < 0.06) frame.target = null;
    else if (!plan(target.x, target.z)) frame.target = null;
  };
  const setAction = (action: WorkerFrame["action"]) => {
    if (action === frame.action) return;
    frame.action = action;
    frame.animationTime = 0;
  };
  const rest = (dt: number) => {
    speed = WALK_SPEED;
    frame.runBlend = 0;
    setAction(standing);
    frame.animationTime += dt;
  };
  /** Keeps the gait (no idle flicker) while a route is re-planned at its capped end. */
  const stride = (moved: number) => {
    frame.runBlend = runBlend(speed);
    frame.gaitPhase = advanceGaitPhase(frame.gaitPhase, moved, frame.runBlend);
    const action = locomotionAction(frame.runBlend);
    setAction(action);
    frame.animationTime = locomotionClipTime(action, frame.gaitPhase);
  };
  /** Walks the route for `delta` seconds (before the group's collision pass). */
  const move = (delta: number) => {
    const dt = Math.min(0.1, Math.max(0, delta));
    speed = easeGaitSpeed(speed, targetGaitSpeed(runTrip, remainingRoute()), dt);
    const moved = followPath(dt);
    replanAtPathEnd();
    if (moved > 0 || frame.target) stride(moved);
    else rest(dt);
  };
  /** Ground height and sight at the final position (after the collision pass). */
  const settle = () => {
    frame.y = sampleSmooth(world, world.heights, frame.x, frame.z);
    vision?.update(frame.x, frame.z);
  };
  /** Puts the worker at a spot at once (map editor: moved out of a new mountain or lake). */
  const place = (x: number, z: number) => {
    frame.x = x;
    frame.z = z;
    settle();
  };
  return {
    frame,
    command,
    move,
    place,
    redirect,
    remainingRoute,
    settle,
    stop,
    vision,
    select: (selected: boolean) => {
      frame.selected = selected;
    },
    /** The action shown while standing (idle by default). */
    setStandingAction: (action: StandingAction) => {
      standing = action;
    }
  };
};
