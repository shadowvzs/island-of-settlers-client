import type { Camera } from "three";

import type { MountFrame } from "../../render-common/mounts/mount-frame";
import { createFrameFocus } from "./animation-budget-core";
import {
  advanceWorkerTier,
  classifyWorkerTier,
  WORKER_ANIMATION_TELEPORT_DISTANCE,
  workerAnimationCadence,
  workerAnimationPhase,
  type WorkerAnimationTier,
  type WorkerCadenceBias,
  workerScreenFraction
} from "./worker-animation-budget";

/**
 * C02 (e): mounted units use the worker screen cadence. Only the skeletal, weapon and turn layers
 * are gated; the root transform, selection and aura stay per frame (three-mounts.ts). The tier
 * policy, hysteresis and cadence constants are the workers' own (worker-animation-budget.ts).
 */

export interface MountAnimationStats {
  frame: number;
  poses: number;
  tiers: [number, number, number, number];
}

/** Per mount. Kept beside the instance so a replaced mount starts fresh. */
export interface MountAnimationState {
  tier: WorkerAnimationTier;
  since: number;
  onScreen: boolean;
  hadFrame: boolean;
  lastX: number;
  lastZ: number;
  lastClip: string | null;
  lastCommander: boolean;
  lastCommanderLoadout: string | null;
  lastContact: boolean;
  lastFall: boolean;
  lastFaction: number | null;
  lastNation: string | null;
  lastSelected: boolean;
}

export interface MountAnimationBudget {
  /** Starts one render frame with the final camera and presentation clock. */
  beginFrame(camera: Camera | undefined, time: number): void;
  newState(): MountAnimationState;
  /** Marks a mount as outside the frustum; its next entry is refreshed promptly. */
  offscreen(state: MountAnimationState, frame?: Pick<MountFrame, "x" | "z">): void;
  /** Whether this visible mount's skeletal, weapon and turn layers run this render frame. */
  due(state: MountAnimationState, frame: MountFrame): boolean;
  stats(): MountAnimationStats;
}

const newMountState = (): MountAnimationState => ({
  tier: 0,
  since: 0,
  onScreen: false,
  hadFrame: false,
  lastX: 0,
  lastZ: 0,
  lastClip: null,
  lastCommander: false,
  lastCommanderLoadout: null,
  lastContact: false,
  lastFall: false,
  lastFaction: null,
  lastNation: null,
  lastSelected: false
});

/** Mounted combat, possession and a fall stay full cadence near the view (as the workers). */
const isMountActiveContact = (frame: MountFrame) =>
  frame.fall !== undefined || frame.attackProgress != null || (frame.guard ?? 0) > 0 ||
  (frame.engage ?? 0) > 0 || frame.manualControl === true || Boolean(frame.commanderLoadout);

/** Mount pose inputs that are not continuous within a clip; a change forces a fresh pose. */
const mountPoseInputsChanged = (state: MountAnimationState, frame: MountFrame) => {
  const clip = frame.clip;
  const commander = frame.commander === true;
  const loadout = frame.commanderLoadout ?? null;
  const fall = frame.fall !== undefined;
  const faction = frame.faction ?? null;
  const nation = frame.nation ?? null;
  const changed = clip !== state.lastClip || commander !== state.lastCommander ||
    loadout !== state.lastCommanderLoadout || fall !== state.lastFall ||
    faction !== state.lastFaction || nation !== state.lastNation;
  state.lastClip = clip;
  state.lastCommander = commander;
  state.lastCommanderLoadout = loadout;
  state.lastFall = fall;
  state.lastFaction = faction;
  state.lastNation = nation;
  return changed;
};

export const createMountAnimationBudget = (
  cadenceBias: WorkerCadenceBias = { bias: 0, floor: 0 }
): MountAnimationBudget => {
  const focus = createFrameFocus();
  let poses = 0;
  let tiers: [number, number, number, number] = [0, 0, 0, 0];
  const beginFrame = (nextCamera: Camera | undefined, time: number) => {
    focus.beginFrame(nextCamera, time);
    poses = 0;
    tiers = [0, 0, 0, 0];
  };
  const offscreen = (state: MountAnimationState, current?: Pick<MountFrame, "x" | "z">) => {
    state.onScreen = false;
    if (current) { state.lastX = current.x; state.lastZ = current.z; }
  };
  const record = (state: MountAnimationState, posed: boolean) => {
    tiers[state.tier]++;
    if (posed) poses++;
    return posed;
  };
  const due = (state: MountAnimationState, frame: MountFrame) => {
    const firstFrame = !state.hadFrame;
    const entering = !state.onScreen;
    const selected = frame.selected === true;
    const selectedChanged = selected !== state.lastSelected;
    const contact = isMountActiveContact(frame);
    const contactChanged = contact !== state.lastContact;
    const poseChanged = mountPoseInputsChanged(state, frame);
    const dx = frame.x - state.lastX, dz = frame.z - state.lastZ;
    const teleport = state.hadFrame &&
      dx * dx + dz * dz > WORKER_ANIMATION_TELEPORT_DISTANCE * WORKER_ANIMATION_TELEPORT_DISTANCE;
    state.lastX = frame.x;
    state.lastZ = frame.z;
    state.lastSelected = selected;
    state.lastContact = contact;
    state.hadFrame = true;
    state.onScreen = true;

    if (!focus.camera) {
      state.tier = 0;
      state.since = focus.clock;
      return record(state, true);
    }
    // A preview mount without a simulation identity keeps full cadence, as the worker previews.
    if (frame.actorId === undefined) {
      state.tier = 0;
      state.since = focus.clock;
      return record(state, true);
    }
    const screenFraction = workerScreenFraction(focus.camera, frame.x, frame.y, frame.z);
    const focusDistance = Math.hypot(frame.x - focus.focusX, frame.z - focus.focusZ);
    const candidate = selected ? 0 : classifyWorkerTier(screenFraction, focusDistance, contact);
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
      const cadence = workerAnimationCadence(state.tier, cadenceBias.bias);
      if (candidate === 0) force = true;
      else if ((focus.frame + workerAnimationPhase(frame.actorId, cadence)) % cadence !== 0) {
        return record(state, false);
      }
    }
    const cadence = workerAnimationCadence(state.tier, cadenceBias.bias);
    if (force || cadence === 1 ||
      (focus.frame + workerAnimationPhase(frame.actorId, cadence)) % cadence === 0) {
      return record(state, true);
    }
    return record(state, false);
  };
  return {
    beginFrame,
    newState: newMountState,
    offscreen,
    due,
    stats: () => ({ frame: focus.frame, poses, tiers: [...tiers] })
  };
};
