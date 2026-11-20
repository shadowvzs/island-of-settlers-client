import {
  type ExplorationInputPolicy,
  explorationInputPolicy,
  type ExplorationPhase
} from "../contracts";

/** The press kinds the existing map gestures expose after normalization. */
export type NormalizedGesture = "none" | "tap" | "drag" | "long-press" | "pinch" | "slow";

/**
 * The narrow state the coordinator already derives from map input. It is deliberately not the
 * exploration input controller's own joystick/look ownership: a pointer on the exploration HUD must
 * never block its own entry action.
 */
export interface ExplorationNormalizedInputState {
  editorGesture: boolean;
  gesture: NormalizedGesture;
  /** A normal map press is being tracked (not a press on the exploration entry/control). */
  mapPointerActive: boolean;
  modalOpen: boolean;
  placementGesture: boolean;
  pointerType: "mouse" | "pen" | "touch" | null;
}

export const EMPTY_NORMALIZED_INPUT: Readonly<ExplorationNormalizedInputState> = Object.freeze({
  editorGesture: false,
  gesture: "none",
  mapPointerActive: false,
  modalOpen: false,
  placementGesture: false,
  pointerType: null
});

export interface ExplorationGateSnapshot extends ExplorationInputPolicy {
  entryReady: boolean;
  normalized: ExplorationNormalizedInputState;
}

/** Hooks for the coordinator-owned hover, picking, shortcut and click owners. */
export interface ExplorationGateHooks {
  /** True while a normal pointer press may be tracked and released as that same owner. */
  beginPointer: (pointerId: number, pointerType?: string) => boolean;
  /** False consumes the click that the matching release may still produce. */
  clickAllowed: (now?: number) => boolean;
  /** True only when the pointer began and ended as a normal press. */
  endPointer: (pointerId: number) => boolean;
  entryReady: () => boolean;
  hoverAllowed: () => boolean;
  pickingAllowed: () => boolean;
  pointerBlocked: (pointerId: number) => boolean;
  shortcutAllowed: () => boolean;
}

export interface ExplorationInputGate {
  readonly hooks: ExplorationGateHooks;
  dispose: () => void;
  /** The current composed policy; ordinary controllers may read it without subscribing. */
  policy: () => ExplorationInputPolicy;
  setNormalizedState: (state: Partial<ExplorationNormalizedInputState>) => void;
  setPhase: (phase: ExplorationPhase) => void;
  snapshot: () => ExplorationGateSnapshot;
  subscribe: (listener: () => void) => () => void;
}

/** A hold that began in FPS must not become a normal map click after the mode ends. */
const CLICK_BLOCK_MS = 750;

type PhaseInput = Pick<ExplorationGateSnapshot, "entryReady" | "leave" | "look" | "move" | "spyglass" | "suppressNormal">;

const phaseInput = (phase: ExplorationPhase, normalized: ExplorationNormalizedInputState): PhaseInput => {
  const policy = explorationInputPolicy(phase);
  return {
    ...policy,
    entryReady: phase === "idle" && !normalized.editorGesture && normalized.gesture === "none" &&
      !normalized.mapPointerActive && !normalized.modalOpen && !normalized.placementGesture
  };
};

const sameInput = (left: PhaseInput, right: PhaseInput) =>
  left.entryReady === right.entryReady && left.leave === right.leave && left.look === right.look &&
  left.move === right.move && left.spyglass === right.spyglass && left.suppressNormal === right.suppressNormal;

const sameNormalized = (left: ExplorationNormalizedInputState, right: ExplorationNormalizedInputState) =>
  left.editorGesture === right.editorGesture && left.gesture === right.gesture &&
  left.mapPointerActive === right.mapPointerActive && left.modalOpen === right.modalOpen &&
  left.placementGesture === right.placementGesture && left.pointerType === right.pointerType;

/**
 * Composes the frozen phase policy with the existing normalized pointer/gesture state. It is
 * controller-agnostic: the coordinator passes phase changes in and reads the narrow hooks from the
 * hover, picking, shortcut and click owners. Pointer ids are remembered until release, so a hold
 * that started in exploration cannot leak into an ordinary click on release.
 */
export const createExplorationInputGate = (
  initialPhase: ExplorationPhase = "idle",
  now: () => number = Date.now
): ExplorationInputGate => {
  let phase = initialPhase;
  let normalized: ExplorationNormalizedInputState = { ...EMPTY_NORMALIZED_INPUT };
  let lastInput = phaseInput(phase, normalized);
  let disposed = false;
  const listeners = new Set<() => void>();
  const blockedPointers = new Set<number>();
  let pendingBlockedClicks = 0;
  let blockedClicksUntil = 0;

  const notify = (next: PhaseInput) => {
    if (sameInput(lastInput, next)) return;
    lastInput = next;
    for (const listener of listeners) listener();
  };

  const policy = () => {
    const { entryReady: _entryReady, ...input } = lastInput;
    return input;
  };

  const entryReady = () => lastInput.entryReady;

  const endPointer = (pointerId: number) => {
    const beganBlocked = blockedPointers.delete(pointerId);
    if (!beganBlocked && !lastInput.suppressNormal) return true;
    pendingBlockedClicks++;
    blockedClicksUntil = now() + CLICK_BLOCK_MS;
    return false;
  };

  const hooks: ExplorationGateHooks = {
    beginPointer: (pointerId) => {
      if (lastInput.suppressNormal) {
        blockedPointers.add(pointerId);
        return false;
      }
      return true;
    },
    clickAllowed: (at = now()) => {
      if (at > blockedClicksUntil) pendingBlockedClicks = 0;
      if (pendingBlockedClicks <= 0) return true;
      pendingBlockedClicks--;
      return false;
    },
    endPointer,
    entryReady,
    hoverAllowed: () => !lastInput.suppressNormal,
    pickingAllowed: () => !lastInput.suppressNormal,
    pointerBlocked: pointerId => blockedPointers.has(pointerId),
    shortcutAllowed: () => !lastInput.suppressNormal
  };

  return {
    hooks,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      blockedPointers.clear();
      listeners.clear();
      phase = "disposed";
      lastInput = phaseInput(phase, normalized);
    },
    policy,
    setNormalizedState: (changes) => {
      if (disposed) return;
      const next = { ...normalized, ...changes };
      if (sameNormalized(normalized, next)) return;
      normalized = next;
      notify(phaseInput(phase, normalized));
    },
    setPhase: (nextPhase) => {
      if (disposed || nextPhase === phase) return;
      phase = nextPhase;
      notify(phaseInput(phase, normalized));
    },
    snapshot: () => ({ ...lastInput, normalized: { ...normalized } }),
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
};
