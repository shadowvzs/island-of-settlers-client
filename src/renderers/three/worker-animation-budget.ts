import { type Camera, Vector3 } from "three";

import { DRINK_WORK_ACTIONS } from "../../render-common/workers/drink-work-actions";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createFrameFocus } from "./animation-budget-core";

/**
 * ACTOR-ANIMATION-01: a visible worker's projected height decides how often its expensive
 * skeletal layers run. Root position, heading, visibility and selection stay per-frame; pose,
 * terrain feet, props, bandit accessories and plantation hand contacts are cadenced.
 *
 * The budget is renderer-local. It reads WorkerFrame presentation data and never writes it,
 * the simulation, cargo, AI, saves or RNG.
 */

/** Projected worker height (fraction of viewport height) that keeps full cadence. */
export const WORKER_ANIMATION_FULL_SCREEN_FRACTION = .036;
/** Half cadence below the full size threshold. */
export const WORKER_ANIMATION_HALF_SCREEN_FRACTION = .018;
/** Third cadence below the half size threshold. */
export const WORKER_ANIMATION_THIRD_SCREEN_FRACTION = .009;
/** Ground distance to the camera focus that keeps full cadence. */
export const WORKER_ANIMATION_FULL_FOCUS_DISTANCE = 6;
export const WORKER_ANIMATION_HALF_FOCUS_DISTANCE = 14;
export const WORKER_ANIMATION_THIRD_FOCUS_DISTANCE = 28;
/** Active contact stays full while it is at least this large or this close to the focus. */
export const WORKER_ANIMATION_CONTACT_SCREEN_FRACTION = .008;
export const WORKER_ANIMATION_CONTACT_FOCUS_DISTANCE = 25;
/** A tier must survive this long without a promotion before it may demote one step. */
export const WORKER_ANIMATION_DEMOTION_HOLD_SECONDS = .4;
/** Demote only below the current boundary with this margin, to stop threshold flapping. */
export const WORKER_ANIMATION_SCREEN_DEMOTION_BAND = .85;
export const WORKER_ANIMATION_FOCUS_DEMOTION_BAND = 1.2;
/** A single-frame jump this large forces a pose (respawn, teleport, handoff). */
export const WORKER_ANIMATION_TELEPORT_DISTANCE = 1.5;
/** Tier 0 updates every frame, tier 3 every fourth. Indexed by tier. */
export const WORKER_ANIMATION_TIER_CADENCE = [1, 2, 3, 4] as const;

/**
 * C13 CPU lever: under a CPU-bound budget every reduced tier (1-3) moves this many entries further
 * along. Full-cadence actors (near, selected, active contact) are never slowed.
 */
export const WORKER_ANIMATION_BIASED_CADENCE = [1, 2, 3, 4, 6, 8] as const;
export const WORKER_ANIMATION_MAX_CADENCE_BIAS = 2;

/**
 * Shared, live presentation levers: the budget controller's bias (0 keeps the authored cadence)
 * and the player's Character detail cadence floor, which the controller may never undercut.
 */
export interface WorkerCadenceBias {
  bias: number;
  floor: number;
}

/** The effective bias: the controller may only go coarser than the player's choice (C12). */
export const effectiveCadenceBias = (cadenceBias: WorkerCadenceBias) =>
  Math.max(cadenceBias.bias, cadenceBias.floor);

export type WorkerAnimationTier = 0 | 1 | 2 | 3;

/** Frames per pose of a tier under the controller's bias (presentation only). */
export const workerAnimationCadence = (tier: WorkerAnimationTier, bias: number) => {
  if (tier === 0 || bias <= 0) return WORKER_ANIMATION_TIER_CADENCE[tier];
  const index = Math.min(WORKER_ANIMATION_BIASED_CADENCE.length - 1, tier + Math.min(bias,
    WORKER_ANIMATION_MAX_CADENCE_BIAS));
  return WORKER_ANIMATION_BIASED_CADENCE[index]!;
};

/** Per body/display state. Kept beside the equipped member so replacements start fresh. */
export interface WorkerAnimationState {
  tier: WorkerAnimationTier;
  /** Presentation time of the last tier change (or of leaving the camera). */
  since: number;
  onScreen: boolean;
  hadFrame: boolean;
  lastX: number;
  lastZ: number;
  lastAction: WorkerFrame["action"] | undefined;
  lastCarry: string | null;
  lastStandingCarry: boolean;
  lastTool: string | null;
  lastRank: WorkerFrame["armourRank"] | null;
  lastJob: string | null;
  lastFieldWork: WorkerFrame["fieldWork"] | null;
  lastShipHullWork: boolean;
  lastHandcart: boolean;
  lastHorseLead: boolean;
  lastWellWork: boolean;
  lastSeedling: boolean;
  lastPlantation: number | null;
  lastFall: boolean;
  lastTransferWare: string | null;
  lastTransferDirection: "pickup" | "putdown" | null;
  lastCombatType: string | null;
  lastCombatVariant: number | null;
  lastDoorMelee: boolean;
  lastSelected: boolean;
  lastContact: boolean;
}

export interface WorkerAnimationStats {
  frame: number;
  poses: number;
  tiers: [number, number, number, number];
}

export interface WorkerAnimationBudget {
  /** Starts one render frame with the final camera and presentation clock. */
  beginFrame(camera: Camera | undefined, time: number): void;
  newState(): WorkerAnimationState;
  /** Marks an actor as outside the frustum; its next entry is refreshed promptly. */
  offscreen(state: WorkerAnimationState, frame?: Pick<WorkerFrame, "x" | "z">): void;
  /**
   * Reclassifies and poses every visible actor on the next frame, ignoring tier hysteresis (C11:
   * the camera jumps from the iso view onto the commander).
   */
  resetTiers(): void;
  /** Whether this visible actor's expensive layers run this render frame. */
  due(state: WorkerAnimationState, frame: WorkerFrame, stableKey?: number): boolean;
  stats(): WorkerAnimationStats;
}

const TOOL_CONTACT_ACTIONS = new Set<WorkerFrame["action"]>([
  ...DRINK_WORK_ACTIONS,
  "build_hammer", "chop_tree", "dig", "harvest_wheat", "lift_honeycomb", "pick_grapes",
  "pickup_material", "plant_seedling", "push_trunk", "putdown_material",
  "fish_cast", "fish_wait", "fish_reel", "spyglass_scan",
  "carry_overhead_boat", "boat_lift", "boat_putdown", "fish_basket_pickup"
]);

/** A frame that needs world-space hand, tool, cargo or IK continuity every frame. */
export const isWorkerActiveContact = (frame: WorkerFrame) => {
  if (frame.wareTransfer || frame.handcart || frame.horseLead || frame.wellWork ||
    frame.foresterSeedling || frame.plantationSiteId !== undefined ||
    frame.fieldWork !== undefined || frame.shipHullWork ||
    frame.fallenBandit || frame.fall !== undefined) return true;
  // A soldier in a battle keeps its combat-ready stance and shields; proximity decides cadence.
  if (frame.combat) return true;
  return TOOL_CONTACT_ACTIONS.has(frame.action);
};

/** Screen tiers in order: a selected actor is always full; contact pins full near the view. */
export const classifyWorkerTier = (
  screenFraction: number,
  focusDistance: number,
  activeContact: boolean
): WorkerAnimationTier => {
  if (activeContact && (screenFraction >= WORKER_ANIMATION_CONTACT_SCREEN_FRACTION ||
    focusDistance <= WORKER_ANIMATION_CONTACT_FOCUS_DISTANCE)) return 0;
  if (screenFraction >= WORKER_ANIMATION_FULL_SCREEN_FRACTION ||
    focusDistance <= WORKER_ANIMATION_FULL_FOCUS_DISTANCE) return 0;
  if (screenFraction >= WORKER_ANIMATION_HALF_SCREEN_FRACTION ||
    focusDistance <= WORKER_ANIMATION_HALF_FOCUS_DISTANCE) return 1;
  if (screenFraction >= WORKER_ANIMATION_THIRD_SCREEN_FRACTION ||
    focusDistance <= WORKER_ANIMATION_THIRD_FOCUS_DISTANCE) return 2;
  return 3;
};

/** Stable integer avalanche for actor IDs; never Math.random and not array order. */
export const mixStableId = (id: number) => {
  let value = (id | 0) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
};

/** A stable per-actor phase in [0, cadence): actors sharing a cadence do not pose together. */
export const workerAnimationPhase = (stableKey: number, cadence: number) =>
  mixStableId(stableKey) % cadence;

const feetPoint = new Vector3();
const headPoint = new Vector3();

/** Height of a worker from feet to head as a fraction of viewport height (NDC). */
export const workerScreenFraction = (camera: Camera, x: number, y: number, z: number) => {
  feetPoint.set(x, y + .05, z).project(camera);
  headPoint.set(x, y + WORKER_HEIGHT, z).project(camera);
  const fraction = Math.abs(headPoint.y - feetPoint.y) / 2;
  return Number.isFinite(fraction) ? fraction : 0;
};

const newState = (): WorkerAnimationState => ({
  tier: 0,
  since: 0,
  onScreen: false,
  hadFrame: false,
  lastX: 0,
  lastZ: 0,
  lastAction: undefined,
  lastCarry: null,
  lastStandingCarry: false,
  lastTool: null,
  lastRank: null,
  lastJob: null,
  lastFieldWork: null,
  lastShipHullWork: false,
  lastHandcart: false,
  lastHorseLead: false,
  lastWellWork: false,
  lastSeedling: false,
  lastPlantation: null,
  lastFall: false,
  lastTransferWare: null,
  lastTransferDirection: null,
  lastCombatType: null,
  lastCombatVariant: null,
  lastDoorMelee: false,
  lastSelected: false,
  lastContact: false
});

/** Pose inputs that are not continuous within a clip; a change forces a fresh pose. */
const poseInputsChanged = (state: WorkerAnimationState, frame: WorkerFrame) => {
  const carry = frame.carryingWare ?? null;
  const standingCarry = Boolean(frame.standingCarry);
  const tool = frame.workerTool ?? null;
  const rank = frame.armourRank ?? null;
  const job = frame.workerJob ?? null;
  const fieldWork = frame.fieldWork ?? null;
  const shipHullWork = Boolean(frame.shipHullWork);
  const handcart = Boolean(frame.handcart);
  const horseLead = Boolean(frame.horseLead);
  const wellWork = Boolean(frame.wellWork);
  const seedling = Boolean(frame.foresterSeedling);
  const plantation = frame.plantationSiteId ?? null;
  const fall = frame.fall !== undefined;
  const transferWare = frame.wareTransfer?.ware ?? null;
  const transferDirection = frame.wareTransfer?.direction ?? null;
  const combatType = frame.combat?.type ?? null;
  const combatVariant = frame.combat?.variant ?? null;
  const doorMelee = Boolean(frame.combat?.doorMelee);
  const changed = frame.action !== state.lastAction || carry !== state.lastCarry ||
    standingCarry !== state.lastStandingCarry ||
    tool !== state.lastTool || rank !== state.lastRank || job !== state.lastJob ||
    fieldWork !== state.lastFieldWork || shipHullWork !== state.lastShipHullWork ||
    handcart !== state.lastHandcart || horseLead !== state.lastHorseLead ||
    wellWork !== state.lastWellWork || seedling !== state.lastSeedling ||
    plantation !== state.lastPlantation || fall !== state.lastFall ||
    transferWare !== state.lastTransferWare || transferDirection !== state.lastTransferDirection ||
    combatType !== state.lastCombatType || combatVariant !== state.lastCombatVariant ||
    doorMelee !== state.lastDoorMelee;
  state.lastAction = frame.action;
  state.lastCarry = carry;
  state.lastStandingCarry = standingCarry;
  state.lastTool = tool;
  state.lastRank = rank;
  state.lastJob = job;
  state.lastFieldWork = fieldWork;
  state.lastShipHullWork = shipHullWork;
  state.lastHandcart = handcart;
  state.lastHorseLead = horseLead;
  state.lastWellWork = wellWork;
  state.lastSeedling = seedling;
  state.lastPlantation = plantation;
  state.lastFall = fall;
  state.lastTransferWare = transferWare;
  state.lastTransferDirection = transferDirection;
  state.lastCombatType = combatType;
  state.lastCombatVariant = combatVariant;
  state.lastDoorMelee = doorMelee;
  return changed;
};

const belowDemotionBand = (tier: WorkerAnimationTier, screenFraction: number, focusDistance: number) => {
  if (tier === 0) return screenFraction < WORKER_ANIMATION_FULL_SCREEN_FRACTION * WORKER_ANIMATION_SCREEN_DEMOTION_BAND &&
    focusDistance > WORKER_ANIMATION_FULL_FOCUS_DISTANCE * WORKER_ANIMATION_FOCUS_DEMOTION_BAND;
  if (tier === 1) return screenFraction < WORKER_ANIMATION_HALF_SCREEN_FRACTION * WORKER_ANIMATION_SCREEN_DEMOTION_BAND &&
    focusDistance > WORKER_ANIMATION_HALF_FOCUS_DISTANCE * WORKER_ANIMATION_FOCUS_DEMOTION_BAND;
  if (tier === 2) return screenFraction < WORKER_ANIMATION_THIRD_SCREEN_FRACTION * WORKER_ANIMATION_SCREEN_DEMOTION_BAND &&
    focusDistance > WORKER_ANIMATION_THIRD_FOCUS_DISTANCE * WORKER_ANIMATION_FOCUS_DEMOTION_BAND;
  return false;
};

/**
 * One tier step of the shared hysteresis: promotion is immediate (the caller refreshes the pose);
 * demotion needs the hold and the band and returns false, so a demoted actor keeps its last pose.
 */
export const advanceWorkerTier = (
  state: { since: number; tier: WorkerAnimationTier },
  candidate: WorkerAnimationTier,
  screenFraction: number,
  focusDistance: number,
  clock: number
) => {
  if (candidate < state.tier) {
    state.tier = candidate;
    state.since = clock;
    return true;
  }
  if (candidate > state.tier) {
    if (clock < state.since) state.since = clock;
    if (clock - state.since >= WORKER_ANIMATION_DEMOTION_HOLD_SECONDS &&
      belowDemotionBand(state.tier, screenFraction, focusDistance)) {
      state.tier = (state.tier + 1) as WorkerAnimationTier;
      state.since = clock;
    }
  }
  return false;
};

/**
 * One scheduler per crowd. `beginFrame` is called once before the members, so every actor sees
 * the same camera, focus point and presentation time.
 */
export const createWorkerAnimationBudget = (
  cadenceBias: WorkerCadenceBias = { bias: 0, floor: 0 }
): WorkerAnimationBudget => {
  const focus = createFrameFocus();
  /** C11: the next beginFrame pretends the camera just entered, forcing reclassification. */
  let tiersReset = false;
  let poses = 0;
  let tiers: [number, number, number, number] = [0, 0, 0, 0];

  const beginFrame = (nextCamera: Camera | undefined, time: number) => {
    focus.beginFrame(nextCamera, time);
    // C11: a reset behaves like the camera entering the view, so every visible actor re-poses.
    if (tiersReset) focus.cameraEntered = Boolean(nextCamera);
    tiersReset = false;
    poses = 0;
    tiers = [0, 0, 0, 0];
  };

  const offscreen = (state: WorkerAnimationState, current?: Pick<WorkerFrame, "x" | "z">) => {
    state.onScreen = false;
    if (current) {
      state.lastX = current.x;
      state.lastZ = current.z;
    }
  };

  /** Counts this actor's final tier (and due poses) without allocating per actor frame. */
  const record = (state: WorkerAnimationState, posed: boolean) => {
    tiers[state.tier]++;
    if (posed) poses++;
    return posed;
  };

  const due = (state: WorkerAnimationState, worker: WorkerFrame, stableKey = worker.actorId) => {
    const bias = effectiveCadenceBias(cadenceBias);
    const firstFrame = !state.hadFrame;
    const entering = !state.onScreen;
    const selectedChanged = worker.selected !== state.lastSelected;
    const contact = isWorkerActiveContact(worker);
    const contactChanged = contact !== state.lastContact;
    const poseChanged = poseInputsChanged(state, worker);
    const dx = worker.x - state.lastX;
    const dz = worker.z - state.lastZ;
    const teleport = state.hadFrame &&
      dx * dx + dz * dz > WORKER_ANIMATION_TELEPORT_DISTANCE * WORKER_ANIMATION_TELEPORT_DISTANCE;
    state.lastX = worker.x;
    state.lastZ = worker.z;
    state.lastSelected = worker.selected;
    state.lastContact = contact;
    state.hadFrame = true;
    state.onScreen = true;

    if (!focus.camera) {
      state.tier = 0;
      state.since = focus.clock;
      return record(state, true);
    }
    // Ship-preview frames (and any other frame without a stable ID) keep the old full cadence;
    // array position must never decide when an actor animates.
    if (stableKey === undefined) {
      state.tier = 0;
      state.since = focus.clock;
      return record(state, true);
    }

    const screenFraction = workerScreenFraction(focus.camera, worker.x, worker.y, worker.z);
    const focusDistance = Math.hypot(worker.x - focus.focusX, worker.z - focus.focusZ);
    const candidate = worker.selected ? 0 : classifyWorkerTier(screenFraction, focusDistance, contact);
    let force = firstFrame || focus.cameraEntered || selectedChanged || contactChanged || poseChanged ||
      (teleport && !entering);

    if (selectedChanged || contactChanged) {
      state.tier = 0;
      state.since = focus.clock;
      force = true;
    } else if (advanceWorkerTier(state, candidate, screenFraction, focusDistance, focus.clock)) {
      force = true;
    }

    if (entering && !force) {
      // Off-screen entry is refreshed promptly without one spike: near/selected actors now,
      // other entrants on their stable phase within cadence - 1 frames.
      const cadence = workerAnimationCadence(state.tier, bias);
      if (candidate === 0) force = true;
      else if ((focus.frame + workerAnimationPhase(stableKey, cadence)) % cadence !== 0) {
        return record(state, false);
      }
    }

    const cadence = workerAnimationCadence(state.tier, bias);
    if (force || cadence === 1 ||
      (focus.frame + workerAnimationPhase(stableKey, cadence)) % cadence === 0) return record(state, true);
    return record(state, false);
  };

  return {
    beginFrame,
    newState,
    offscreen,
    resetTiers: () => { tiersReset = true; },
    due,
    stats: () => ({ frame: focus.frame, poses, tiers: [...tiers] })
  };
};

/** Cheap per-frame work and the expensive skeletal work the budget gates. */
export interface WorkerAnimationWork {
  /** Transform, visibility, selection and cached team colour; every render frame. */
  present(frame: WorkerFrame): void;
  /** Pose, feet, props, accessories and hand contacts; only on a due frame. */
  animate(frame: WorkerFrame): void;
}

/** Production update seam: position stays per-frame, phase work only when the budget is due. */
export const updateWorkerAnimation = (
  budget: WorkerAnimationBudget,
  state: WorkerAnimationState,
  frame: WorkerFrame,
  work: WorkerAnimationWork,
  stableKey = frame.actorId
) => {
  work.present(frame);
  if (!budget.due(state, frame, stableKey)) return false;
  work.animate(frame);
  return true;
};
