/**
 * EXPLORE-01B runtime controller. The session owns transient presentation state only: a presentation
 * body/eye pose, bubble, smoke and UI countdowns. It never receives the simulation, SaveStore or
 * command dispatcher, and the canonical RTS camera remains untouched behind the frozen boundary.
 */
import {
  EMPTY_EXPLORATION_FRAME,
  type ExplorationAppearanceFrame,
  type ExplorationBubble,
  type ExplorationFrame
} from "../../render-common/exploration/exploration-frame";
import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import {
  createExplorationClock,
  deadlineReached,
  type ExplorationClock,
  explorationProgress,
  remainingMilliseconds
} from "./clock";
import {
  createIdleExplorationSnapshot,
  EXPLORATION_BUBBLE_RADIUS_CELLS,
  EXPLORATION_DISAPPEAR_SECONDS,
  EXPLORATION_ENTRY_SECONDS,
  EXPLORATION_POSSESSED_DWELL_SECONDS,
  EXPLORATION_RETURN_SECONDS,
  type ExplorationAppearanceLease,
  type ExplorationController,
  type ExplorationEligibility,
  type ExplorationHost,
  type ExplorationLeaveReason,
  type ExplorationPhase,
  explorationReadyAt,
  type ExplorationSessionIdentity,
  type ExplorationSpawnPoint,
  type ExplorationUiSnapshot,
  type HomeExplorationContext,
  homeExplorationEligibility
} from "./contracts";
import { advanceExplorationJump, beginExplorationJump, EXPLORATION_JUMP_HEAD_MARGIN,
  EXPLORATION_JUMP_HEIGHT, type ExplorationJump, explorationJumpPose } from "./jump";
import {
  createExplorationBody,
  createExplorationLookIntent,
  createExplorationMovementIntent,
  EXPLORATION_EYE_HEIGHT,
  EXPLORATION_SPYGLASS_ZOOM_DEFAULT,
  EXPLORATION_SPYGLASS_ZOOM_MAX,
  EXPLORATION_SPYGLASS_ZOOM_MIN,
  EXPLORATION_SPYGLASS_ZOOM_STEP,
  type ExplorationBody,
  type ExplorationLookIntent,
  type ExplorationMovementIntent,
  explorationPoseFromBody,
  isExplorationStandingValid,
  lookExplorationBody,
  moveExplorationBody
} from "./movement";
import {
  type ExplorationSpawnSearchOptions,
  findExplorationSpawn,
  isExplorationSpawnPointValid
} from "./spawn";

const ENTRY_MS = EXPLORATION_ENTRY_SECONDS * 1_000;
const DWELL_MS = EXPLORATION_POSSESSED_DWELL_SECONDS * 1_000;
const RETURN_MS = EXPLORATION_RETURN_SECONDS * 1_000;
const DISAPPEAR_MS = EXPLORATION_DISAPPEAR_SECONDS * 1_000;
const BUBBLE_MOVE_EPSILON = 0.05;

const NOTICE = {
  appearanceFailed: "The explorer appearance could not be prepared.",
  cooldown: "Exploration is still cooling down.",
  inputBusy: "Finish the current action before exploring.",
  leaveLocked: "Leave unlocks shortly.",
  noSafeSpawn: "No safe starting point was found.",
  notEligible: "Exploration is only available on the home island.",
  stale: "The exploration session changed before it was ready.",
  unsafeGround: "The explorer can no longer stand safely."
} as const;

const NOT_HOME_CONTEXT: HomeExplorationContext = {
  activeAdventure: null,
  activeColony: null,
  editor: false,
  homeIsland: false,
  playback: false,
  sandbox: false,
  settlement: false
};

type EntryResult = { ok: true } | { ok: false; reason: string };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  settled: boolean;
}

interface SessionState {
  body: ExplorationBody | null;
  bubble: ExplorationBubble | null;
  bubbleRevision: number;
  disappearStartedAt: number;
  disposed: boolean;
  effectsGoneAt: number;
  eligibility: ExplorationEligibility;
  entryDeferred: Deferred<EntryResult> | null;
  entryStartedAt: number;
  entryToken: number;
  identity: ExplorationSessionIdentity | null;
  leaveAt: number;
  leaveUnlockAt: number;
  lease: ExplorationAppearanceLease | null;
  lookIntent: ExplorationLookIntent;
  movementIntent: ExplorationMovementIntent;
  notice?: string;
  phase: ExplorationPhase;
  readyAt: number;
  returnEndsAt: number;
  returnStartedAt: number;
  snapshot: ExplorationUiSnapshot;
  spawn: ExplorationSpawnPoint | null;
  spyglass: boolean;
  spyglassZoom: number;
  /** CIN3: a campaign cinematic owns the screen; the body stays possessed, frozen and drawn in third person. */
  suspended: boolean;
}

export interface ExplorationSessionContext {
  /** Active session/input owner, re-read before entry commits and while the mode is active. */
  home: HomeExplorationContext;
  /** False while a placement/road/editor gesture or unresolved modal still owns input. */
  inputAvailable: boolean;
}

export interface ExplorationRuntimeOptions {
  /** Capability identity only; this does not add real-unit soldier/commander possession. */
  actorType?: () => unknown;
  /** Home eligibility and input ownership, supplied by the coordinating session owner. */
  context: () => ExplorationSessionContext;
  /** First spawn area; defaults to the retained RTS camera centre. */
  focus?: () => { x: number; z: number } | undefined;
  /** Safe HQ/harbour-area fallbacks, supplied without exposing settlement internals. */
  landmarks?: () => readonly { x: number; z: number }[];
  /** Called after entry is accepted; the coordinator closes ordinary windows before preparing. */
  onEntryStarting?: () => void;
  /** Presentation-only rain intensity copied from the environment; 0 when absent. */
  rain?: () => number;
  /** Candidate/time bounds for the read-only spawn search. */
  spawn?: Pick<ExplorationSpawnSearchOptions, "maxCandidates" | "timeBudgetMs">;
}

export interface ExplorationRuntimeController extends ExplorationController {
  jump: () => boolean;
  /** Pointer-lock/focus/touch loss: clear held movement/look without changing the phase. */
  clearInputs: () => void;
  /** Escape: put an active spyglass away first, otherwise clear held input. */
  escape: () => void;
  phase: () => ExplorationPhase;
  /**
   * CIN3: suspend (true) or resume the possessed view without leaving it: no lockout, no return, the spyglass is
   * put away (and stays down), held input is cleared and the body is drawn while the cinematic camera is on.
   */
  setSuspended: (suspended: boolean) => void;
  suspended: () => boolean;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve, settled: false };
};

const settleDeferred = <T>(deferred: Deferred<T> | null, value: T) => {
  if (!deferred || deferred.settled) return;
  deferred.settled = true;
  deferred.resolve(value);
};

const safeCall = (call: () => void) => {
  try { call(); } catch { /* presentation adapters must not break the session teardown */ }
};

const releaseLease = (lease: ExplorationAppearanceLease) => {
  safeCall(() => lease.update(null));
  safeCall(() => lease.dispose());
};

const identityMatches = (
  left: ExplorationSessionIdentity,
  right: ExplorationSessionIdentity
) =>
  left.accountId === right.accountId && left.generation === right.generation &&
  left.islandKey === right.islandKey && left.slotId === right.slotId;

const eligibilityMatches = (left: ExplorationEligibility, right: ExplorationEligibility) =>
  left.eligible === right.eligible && left.reason === right.reason;

const snapshotsEqual = (left: ExplorationUiSnapshot, right: ExplorationUiSnapshot) =>
  left.actorType === right.actorType &&
  left.canEnter === right.canEnter && left.cooldownInMs === right.cooldownInMs &&
  left.leaveUnlockInMs === right.leaveUnlockInMs && left.notice === right.notice &&
  left.phase === right.phase && left.progress === right.progress &&
  left.spyglass === right.spyglass && left.spyglassZoom === right.spyglassZoom &&
  eligibilityMatches(left.eligibility, right.eligibility);

const snapshotProgress = (state: SessionState, now: number) => {
  if (state.phase === "entering")
    return explorationProgress(now, state.entryStartedAt, ENTRY_MS);
  if (state.phase === "returning")
    return explorationProgress(now, state.returnStartedAt, RETURN_MS);
  if (state.phase === "dissipating")
    return explorationProgress(now, state.disappearStartedAt, DISAPPEAR_MS);
  return state.phase === "possessed" ? 1 : 0;
};

const readIdentity = (host: ExplorationHost): ExplorationSessionIdentity => ({ ...host.identity() });

const stateSnapshot = (
  state: SessionState,
  now: number,
  eligibility: ExplorationEligibility
): ExplorationUiSnapshot => {
  const canEnter = state.phase === "idle" && eligibility.eligible;
  const leaveUnlockInMs = state.phase === "entering" || state.phase === "possessed"
    ? remainingMilliseconds(now, state.leaveUnlockAt)
    : 0;
  return {
    canEnter,
    cooldownInMs: state.phase === "cooldown" ? remainingMilliseconds(now, state.readyAt) : 0,
    eligibility,
    leaveUnlockInMs,
    notice: state.notice,
    phase: state.phase,
    progress: snapshotProgress(state, now),
    spyglass: state.spyglass,
    spyglassZoom: state.spyglassZoom
  };
};

class ExplorationSessionController implements ExplorationRuntimeController {
  private hop: ExplorationJump | null = null;
  private readonly clock: ExplorationClock;
  private readonly host: ExplorationHost;
  private readonly options: ExplorationRuntimeOptions;
  private readonly state: SessionState;

  public constructor(host: ExplorationHost, options: ExplorationRuntimeOptions) {
    this.host = host;
    this.options = options;
    this.clock = createExplorationClock(host.now);
    const initialEligibility = this.readEligibility();
    this.state = {
      body: null,
      bubble: null,
      bubbleRevision: 0,
      disappearStartedAt: 0,
      disposed: false,
      effectsGoneAt: 0,
      eligibility: initialEligibility,
      entryDeferred: null,
      entryStartedAt: 0,
      entryToken: 0,
      identity: null,
      leaveAt: 0,
      leaveUnlockAt: 0,
      lease: null,
      lookIntent: { pitch: 0, yaw: 0 },
      movementIntent: { forward: 0, right: 0 },
      phase: "idle",
      readyAt: 0,
      returnEndsAt: 0,
      returnStartedAt: 0,
      snapshot: createIdleExplorationSnapshot(initialEligibility),
      spawn: null,
      spyglass: false,
      spyglassZoom: EXPLORATION_SPYGLASS_ZOOM_DEFAULT,
      suspended: false
    };
    this.publish(true);
  }

  private readonly readContext = (): ExplorationSessionContext => {
    try {
      const context = this.options.context();
      return { home: context.home, inputAvailable: context.inputAvailable };
    } catch {
      return { home: NOT_HOME_CONTEXT, inputAvailable: false };
    }
  };

  private readonly readEligibility = () =>
    homeExplorationEligibility(this.readContext().home);

  private readonly readFocus = () => {
    try {
      const focus = this.options.focus?.();
      if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.z)) return focus;
    } catch { /* fall through to the saved camera centre */ }
    const camera = this.host.camera.gameplayCamera();
    return { x: camera.centerX, z: camera.centerZ };
  };

  private readonly readLandmarks = () => {
    try { return this.options.landmarks?.() ?? []; } catch { return []; }
  };

  private readonly readRain = () => {
    try {
      const rain = this.options.rain?.();
      return typeof rain === "number" && Number.isFinite(rain)
        ? Math.min(1, Math.max(0, rain))
        : 0;
    } catch { return 0; }
  };

  private readonly publish = (force = false, now = this.clock.now()) => {
    const eligibility = this.state.disposed ? this.state.eligibility : this.readEligibility();
    const next = { ...stateSnapshot(this.state, now, eligibility), actorType: this.actorType() };
    if (!force && snapshotsEqual(this.state.snapshot, next)) return;
    this.state.snapshot = next;
    this.host.ui.publish(next);
  };

  private readonly actorType = () => {
    const value = this.options.actorType ? this.options.actorType() : "Scout";
    return typeof value === "string" ? value : "unknown";
  };
  private readonly actionAllowed = (action: string) => actorActionEnabled(this.actorType(), action);
  private readonly sanitizeActions = () => {
    const movement = this.state.movementIntent;
    if (!this.actionAllowed("move")) this.state.movementIntent = { forward: 0, right: 0 };
    else if ((movement.forward > 0 && !this.actionAllowed("forward")) ||
      (movement.forward < 0 && !this.actionAllowed("backward"))) this.state.movementIntent = { ...movement, forward: 0 };
    if (!this.actionAllowed("look")) this.state.lookIntent = { pitch: 0, yaw: 0 };
    if (!this.actionAllowed("spyglass")) this.state.spyglass = false;
    if (this.hop && !this.actionAllowed("jumping")) { this.forceExit("session-replacement"); return false; }
    return true;
  };

  private readonly resetMovementInputs = () => {
    this.state.lookIntent = { pitch: 0, yaw: 0 };
    this.state.movementIntent = { forward: 0, right: 0 };
  };

  private readonly resetInputs = () => {
    this.resetMovementInputs();
    this.state.spyglass = false;
  };

  private readonly releaseCurrentLease = () => {
    const lease = this.state.lease;
    this.state.lease = null;
    if (lease) releaseLease(lease);
  };

  private readonly clearSmoke = () => {
    this.host.camera.setSmoke(null);
    this.host.smoke.update(null);
  };

  private readonly clearBubble = () => {
    this.state.bubble = null;
    this.host.camera.setBubble(null);
    this.host.visibility.setBubble(null);
  };

  private readonly clearVisuals = () => {
    this.hop = null;
    this.clearBubble();
    this.clearSmoke();
    this.host.camera.clearTransient();
    this.host.weather.setActive(false);
    this.host.weather.update(null);
  };

  private readonly eyeHeight = () => {
    const measured = this.state.lease?.eyeHeight?.();
    return Number.isFinite(measured) && (measured ?? 0) > 0 ? measured! : EXPLORATION_EYE_HEIGHT;
  };

  private readonly poseFor = (
    body: ExplorationBody,
    mode: "transition" | "eye",
    spyglass = false
  ) => {
    const pose = explorationPoseFromBody(this.host.ground, body, mode, spyglass, this.eyeHeight(),
      this.state.spyglassZoom);
    if (this.hop) pose.y = this.hop.feetY + this.eyeHeight() - explorationJumpPose(this.hop).crouch * .06;
    // Rain reduces the useful sight line as well as the light; keep a floor so the near scene
    // never disappears and let the sky/haze cover the shorter cut.
    const rain = this.readRain();
    if (rain > 0 && pose.viewDistance !== undefined)
      pose.viewDistance = Math.max(80, pose.viewDistance * (1 - rain * 0.35));
    return pose;
  };

  private readonly updateWeather = (body: ExplorationBody) => {
    const frame = {
      active: true,
      cameraX: body.x,
      cameraY: this.poseFor(body, "eye", this.state.spyglass).y,
      cameraZ: body.z,
      rain: this.readRain()
    };
    this.host.camera.setWeather(frame);
    this.host.weather.update(frame);
  };

  private readonly applyAppearance = (appearance: ExplorationAppearanceFrame) => {
    if (this.hop) appearance = { ...appearance, feetY: this.hop.feetY, jump: explorationJumpPose(this.hop) };
    else appearance = { ...appearance, feetY: appearance.pose.y - appearance.pose.eyeHeight };
    this.host.camera.setAppearance(appearance);
    this.state.lease?.update(appearance);
  };

  private readonly renderEntry = (now: number) => {
    const body = this.state.body;
    if (!body) return;
    const progress = explorationProgress(now, this.state.entryStartedAt, ENTRY_MS);
    const pose = this.poseFor(body, "transition");
    this.host.camera.setPose(pose, progress);
    this.applyAppearance({ pose, spyglass: false, visible: true });
    const smoke = {
      kind: "arrival" as const, progress, x: this.state.spawn?.x ?? body.x,
      y: this.state.spawn?.y ?? 0, z: this.state.spawn?.z ?? body.z
    };
    this.host.camera.setSmoke(smoke);
    this.host.smoke.update(smoke);
    this.updateWeather(body);
  };

  private readonly renderPossessed = () => {
    const body = this.state.body;
    if (!body) return;
    const pose = this.poseFor(body, "eye", this.state.spyglass);
    this.host.camera.setPose(pose, 1);
    // A suspended body is seen from the cinematic camera, so it is drawn like a third-person figure.
    this.applyAppearance({ pose, spyglass: this.state.spyglass, visible: this.state.suspended });
    this.updateWeather(body);
    const bubble = this.state.bubble;
    const moved = !bubble ||
      Math.hypot(bubble.centerX - body.x, bubble.centerZ - body.z) >= BUBBLE_MOVE_EPSILON;
    if (!moved) return;
    this.state.bubbleRevision += 1;
    const next = {
      centerX: body.x,
      centerZ: body.z,
      radiusCells: EXPLORATION_BUBBLE_RADIUS_CELLS,
      revision: this.state.bubbleRevision
    };
    this.state.bubble = next;
    this.host.camera.setBubble(next);
    this.host.visibility.setBubble(next);
  };

  private readonly renderReturn = (now: number) => {
    const body = this.state.body;
    if (!body) return;
    const progress = explorationProgress(now, this.state.returnStartedAt, RETURN_MS);
    const pose = this.poseFor(body, "transition");
    this.host.camera.setPose(pose, 1 - progress);
    this.applyAppearance({ pose, spyglass: false, visible: true });
    this.updateWeather(body);
  };

  private readonly renderDissipating = (now: number) => {
    const body = this.state.body;
    if (!body) return;
    const progress = explorationProgress(now, this.state.disappearStartedAt, DISAPPEAR_MS);
    this.host.camera.setPose(null);
    this.applyAppearance({
      pose: this.poseFor(body, "transition"),
      spyglass: false,
      visible: true
    });
    const smoke = {
      kind: "departure" as const,
      progress,
      x: body.x,
      y: this.host.ground.groundHeight(body.x, body.z),
      z: body.z
    };
    this.host.camera.setSmoke(smoke);
    this.host.smoke.update(smoke);
    this.updateWeather(body);
  };

  private readonly settleEntry = (value: EntryResult) => {
    const deferred = this.state.entryDeferred;
    this.state.entryDeferred = null;
    settleDeferred(deferred, value);
  };

  private readonly failPreparation = (token: number, reason: string, notice: string) => {
    if (this.state.disposed || this.state.phase !== "preparing" || token !== this.state.entryToken) return;
    this.state.entryToken += 1;
    this.state.phase = "idle";
    this.state.body = null;
    this.state.identity = null;
    this.state.spawn = null;
    this.state.notice = notice;
    this.state.eligibility = this.readEligibility();
    this.settleEntry({ ok: false, reason });
    this.publish(true);
  };

  private readonly cancelPreparation = (reason: string) => {
    if (this.state.disposed || this.state.phase !== "preparing") return;
    this.state.entryToken += 1;
    this.state.phase = "idle";
    this.state.body = null;
    this.state.identity = null;
    this.state.spawn = null;
    this.state.notice = undefined;
    this.state.eligibility = this.readEligibility();
    this.settleEntry({ ok: false, reason });
    this.publish(true);
  };

  private readonly completePreparation = (
    token: number,
    identity: ExplorationSessionIdentity,
    lease: ExplorationAppearanceLease
  ) => {
    const stillPreparing = !this.state.disposed && this.state.phase === "preparing" &&
      token === this.state.entryToken && identityMatches(identity, readIdentity(this.host));
    if (!stillPreparing) {
      releaseLease(lease);
      if (!this.state.disposed && this.state.phase === "preparing" && token === this.state.entryToken) {
        this.failPreparation(token, "stale", NOTICE.stale);
      }
      return;
    }
    const context = this.readContext();
    const eligibility = homeExplorationEligibility(context.home);
    this.state.eligibility = eligibility;
    if (!eligibility.eligible || !context.inputAvailable) {
      releaseLease(lease);
      const reason = eligibility.eligible ? "input-busy" : eligibility.reason ?? "not-home";
      this.failPreparation(
        token, reason, eligibility.eligible ? NOTICE.inputBusy : NOTICE.notEligible
      );
      return;
    }
    if (!this.state.spawn || !isExplorationSpawnPointValid(this.host.ground, this.state.spawn)) {
      releaseLease(lease);
      this.failPreparation(token, "no-safe-spawn", NOTICE.noSafeSpawn);
      return;
    }
    this.state.lease = lease;
    this.state.phase = "entering";
    this.state.entryStartedAt = this.clock.now();
    this.state.leaveUnlockAt = this.state.entryStartedAt + ENTRY_MS + DWELL_MS;
    this.state.body = createExplorationBody(this.state.spawn, this.host.camera.savedRts().yaw);
    this.state.notice = undefined;
    this.host.weather.setActive(true);
    this.host.smoke.burst("arrival", {
      x: this.state.spawn.x, y: this.state.spawn.y, z: this.state.spawn.z
    });
    this.renderEntry(this.state.entryStartedAt);
    this.publish(true);
  };

  private readonly completePossession = (scheduledAt: number) => {
    this.state.phase = "possessed";
    this.state.leaveUnlockAt = scheduledAt + DWELL_MS;
    this.state.notice = undefined;
    this.clearSmoke();
    this.renderPossessed();
    this.settleEntry({ ok: true });
  };

  private readonly beginReturn = (now: number, notice?: string) => {
    if (!this.state.body || this.state.phase === "returning" || this.state.phase === "dissipating")
      return;
    this.settleEntry({ ok: false, reason: "cancelled" });
    this.resetInputs();
    this.clearBubble();
    this.clearSmoke();
    this.state.phase = "returning";
    this.state.leaveAt = now;
    this.state.returnStartedAt = now;
    this.state.returnEndsAt = now + RETURN_MS;
    this.state.effectsGoneAt = this.state.returnEndsAt + DISAPPEAR_MS;
    this.state.readyAt = explorationReadyAt(this.state.leaveAt, this.state.effectsGoneAt);
    this.state.notice = notice;
    this.renderReturn(now);
    this.publish(true);
  };

  private readonly beginDissipating = (startedAt: number) => {
    this.state.phase = "dissipating";
    this.state.disappearStartedAt = startedAt;
    this.clearSmoke();
    this.host.camera.setPose(null);
    const body = this.state.body;
    if (body) {
      this.host.smoke.burst("departure", {
        x: body.x, y: this.host.ground.groundHeight(body.x, body.z), z: body.z
      });
    }
    this.renderDissipating(startedAt);
  };

  private readonly beginCooldown = () => {
    this.state.phase = "cooldown";
    this.releaseCurrentLease();
    this.clearVisuals();
    this.state.body = null;
    this.state.spawn = null;
    this.state.identity = null;
    this.state.eligibility = this.readEligibility();
    this.state.notice = undefined;
    this.resetInputs();
  };

  private readonly advancePhase = (now: number) => {
    let advanced = true;
    while (advanced) {
      advanced = false;
      if (this.state.phase === "entering" &&
        deadlineReached(now, this.state.entryStartedAt + ENTRY_MS)) {
        this.completePossession(this.state.entryStartedAt + ENTRY_MS);
        advanced = true;
      } else if (this.state.phase === "returning" &&
        deadlineReached(now, this.state.returnEndsAt)) {
        this.beginDissipating(this.state.returnEndsAt);
        advanced = true;
      } else if (this.state.phase === "dissipating" &&
        deadlineReached(now, this.state.effectsGoneAt)) {
        this.beginCooldown();
        advanced = true;
      } else if (this.state.phase === "cooldown" && deadlineReached(now, this.state.readyAt)) {
        this.state.phase = "idle";
        this.state.eligibility = this.readEligibility();
        advanced = true;
      }
    }
  };

  private readonly noticeForReason = (reason: ExplorationLeaveReason) =>
    reason === "lease-lost" ? NOTICE.unsafeGround : undefined;

  /**
   * Abandons the current session immediately. The controller stays reusable; `dispose` releases
   * the injected adapter owners once the whole controller is discarded.
   */
  public readonly forceExit = (reason: ExplorationLeaveReason) => {
    if (this.state.disposed) return;
    const noActiveSession = this.state.phase === "idle" && !this.state.lease &&
      !this.state.body && !this.state.bubble;
    if (noActiveSession) return;
    this.state.entryToken += 1;
    this.settleEntry({ ok: false, reason: "cancelled" });
    this.releaseCurrentLease();
    this.state.phase = "idle";
    this.state.body = null;
    this.state.spawn = null;
    this.state.identity = null;
    this.resetInputs();
    this.clearVisuals();
    this.state.eligibility = this.readEligibility();
    this.state.notice = this.noticeForReason(reason);
    this.publish(true);
  };

  private readonly cancelForTechnicalReason = (reason: ExplorationLeaveReason) => {
    if (reason === "dispose") {
      this.dispose();
      return;
    }
    this.forceExit(reason);
  };

  public readonly requestLeave = (reason: ExplorationLeaveReason, force = false) => {
    if (this.state.disposed) return;
    const now = this.clock.now();
    this.advancePhase(now);
    if (this.state.phase === "preparing") {
      if (force || reason !== "leave") this.cancelPreparation("cancelled");
      return;
    }
    if (reason !== "leave") {
      this.cancelForTechnicalReason(reason);
      return;
    }
    if (this.state.phase === "entering" && force) {
      this.beginReturn(now);
      return;
    }
    if (this.state.phase === "possessed" && (force || now >= this.state.leaveUnlockAt)) {
      this.beginReturn(now);
      return;
    }
    if (this.state.phase === "entering" || this.state.phase === "possessed") {
      this.state.notice = NOTICE.leaveLocked;
      this.publish(true);
    }
  };

  public readonly enter = (): Promise<EntryResult> => {
    if (this.state.disposed) return Promise.resolve({ ok: false, reason: "disposed" });
    const now = this.clock.now();
    this.advancePhase(now);
    if (this.state.phase === "preparing" && this.state.entryDeferred)
      return this.state.entryDeferred.promise;
    if (this.state.phase !== "idle") {
      let reason = "busy";
      if (this.state.phase === "cooldown") reason = "cooldown";
      else if (this.state.phase === "possessed") reason = "already-active";
      this.state.notice = this.state.phase === "cooldown" ? NOTICE.cooldown : undefined;
      this.publish(true, now);
      return Promise.resolve({ ok: false, reason });
    }
    const context = this.readContext();
    const eligibility = homeExplorationEligibility(context.home);
    this.state.eligibility = eligibility;
    if (!eligibility.eligible) {
      this.state.notice = NOTICE.notEligible;
      this.publish(true, now);
      return Promise.resolve({ ok: false, reason: eligibility.reason ?? "not-home" });
    }
    if (!context.inputAvailable) {
      this.state.notice = NOTICE.inputBusy;
      this.publish(true, now);
      return Promise.resolve({ ok: false, reason: "input-busy" });
    }
    const spawn = findExplorationSpawn(this.host.ground, {
      ...this.options.spawn,
      focus: this.readFocus(),
      landmarks: this.readLandmarks(),
      now: this.clock.now
    });
    if (!spawn.ok) {
      this.state.notice = NOTICE.noSafeSpawn;
      this.publish(true, now);
      return Promise.resolve({ ok: false, reason: "no-safe-spawn" });
    }
    try { this.options.onEntryStarting?.(); } catch { /* UI cleanup must not refuse entry */ }
    const identity = readIdentity(this.host);
    this.state.entryToken += 1;
    const token = this.state.entryToken;
    this.state.phase = "preparing";
    this.state.identity = identity;
    this.state.spawn = spawn.point;
    this.state.body = createExplorationBody(spawn.point, this.host.camera.savedRts().yaw);
    this.state.notice = undefined;
    this.resetInputs();
    const deferred = createDeferred<EntryResult>();
    this.state.entryDeferred = deferred;
    this.publish(true, now);
    let preparation: Promise<ExplorationAppearanceLease>;
    try {
      preparation = this.host.appearance.acquire(identity);
    } catch (error) {
      console.warn("Exploration appearance could not be prepared", error);
      this.failPreparation(token, "appearance-failed", NOTICE.appearanceFailed);
      return deferred.promise;
    }
    Promise.resolve(preparation).then(
      lease => this.completePreparation(token, identity, lease),
      error => {
        // Keep the real cause visible; the player-facing notice stays the stable short message.
        console.warn("Exploration appearance could not be prepared", error);
        this.failPreparation(token, "appearance-failed", NOTICE.appearanceFailed);
      }
    );
    return deferred.promise;
  };

  private readonly updatePossessed = (deltaSeconds: number, now: number) => {
    if (this.state.suspended) {
      this.renderPossessed();
      return;
    }
    if (!this.sanitizeActions()) return;
    const body = this.state.body;
    if (!body) {
      this.forceExit("renderer-failure");
      return;
    }
    if (!isExplorationStandingValid(this.host.ground, body.x, body.z)) {
      this.beginReturn(now, NOTICE.unsafeGround);
      return;
    }
    const looked = lookExplorationBody(body, this.state.lookIntent, deltaSeconds);
    const moved = moveExplorationBody(
      looked, this.host.ground, this.state.movementIntent, deltaSeconds
    );
    if (moved.standingInvalid) {
      this.beginReturn(now, NOTICE.unsafeGround);
      return;
    }
    if (this.hop && (moved.body.x !== body.x || moved.body.z !== body.z) &&
      this.ceilingAt(moved.body) < this.hop.feetY + WORKER_HEIGHT + EXPLORATION_JUMP_HEAD_MARGIN)
      this.state.body = looked;
    else this.state.body = moved.body;
    this.advanceHop(deltaSeconds);
    this.renderPossessed();
  };

  private readonly ceilingAt = (body: ExplorationBody) => this.host.ground.ceilingHeight?.(
    body.x, body.z, this.host.ground.groundHeight(body.x, body.z), .16,
    WORKER_HEIGHT + EXPLORATION_JUMP_HEIGHT + .1) ?? Infinity;

  private readonly advanceHop = (seconds: number) => {
    if (!this.hop || !this.state.body || !(seconds > 0)) return;
    const body = this.state.body;
    this.hop = advanceExplorationJump(this.hop, this.host.ground.groundHeight(body.x, body.z),
      this.ceilingAt(body), WORKER_HEIGHT, seconds);
  };

  public readonly jump = () => {
    const body = this.state.body;
    if (this.state.disposed || this.state.phase !== "possessed" || this.state.suspended ||
      !this.actionAllowed("jumping") || !body || this.hop || !isExplorationStandingValid(this.host.ground, body.x, body.z)) return false;
    const ground = this.host.ground.groundHeight(body.x, body.z);
    if (this.ceilingAt(body) <= ground + WORKER_HEIGHT + EXPLORATION_JUMP_HEAD_MARGIN) return false;
    this.hop = beginExplorationJump(ground);
    this.renderPossessed();
    return true;
  };

  public readonly update = (deltaSeconds: number): Readonly<ExplorationFrame> => {
    if (this.state.disposed) return EMPTY_EXPLORATION_FRAME;
    const now = this.clock.now();
    const active = this.state.phase !== "idle" && this.state.phase !== "cooldown";
    if (active && this.state.identity &&
      !identityMatches(this.state.identity, readIdentity(this.host))) {
      this.forceExit("session-replacement");
      return this.frame();
    }
    if (active && !this.readEligibility().eligible) {
      this.forceExit("session-replacement");
      return this.frame();
    }
    this.advancePhase(now);
    if (this.state.phase === "possessed") this.updatePossessed(deltaSeconds, now);
    else if (this.state.phase === "entering") this.renderEntry(now);
    else if (this.state.phase === "returning") { this.advanceHop(deltaSeconds); this.renderReturn(now); }
    else if (this.state.phase === "dissipating") this.renderDissipating(now);
    if (this.state.notice === NOTICE.leaveLocked && now >= this.state.leaveUnlockAt)
      this.state.notice = undefined;
    if (this.state.phase === "idle" && this.state.notice === NOTICE.cooldown)
      this.state.notice = undefined;
    this.publish(false, now);
    return this.frame();
  };

  public readonly frame = (): Readonly<ExplorationFrame> =>
    this.state.disposed ? EMPTY_EXPLORATION_FRAME : this.host.camera.frame();

  public readonly snapshot = () => this.state.snapshot;

  public readonly toggleSpyglass = () => {
    if (this.state.disposed || this.state.phase !== "possessed" || this.state.suspended ||
      !this.actionAllowed("spyglass")) {
      this.state.spyglass = false;
      return;
    }
    this.state.spyglass = !this.state.spyglass;
    this.renderPossessed();
    this.publish(true);
  };

  public readonly adjustSpyglassZoom = (direction: 1 | -1) => {
    if (this.state.disposed || this.state.phase !== "possessed" || !this.state.spyglass ||
      !this.actionAllowed(direction > 0 ? "zoomIn" : "zoomOut")) return;
    const next = Math.min(EXPLORATION_SPYGLASS_ZOOM_MAX, Math.max(EXPLORATION_SPYGLASS_ZOOM_MIN,
      Math.round((this.state.spyglassZoom + direction * EXPLORATION_SPYGLASS_ZOOM_STEP) * 10) / 10));
    if (next === this.state.spyglassZoom) return;
    this.state.spyglassZoom = next;
    this.renderPossessed();
    this.publish(true);
  };

  public readonly setMovement = (forward: number, right: number) => {
    if (this.state.disposed || this.state.phase !== "possessed" || this.state.suspended ||
      !this.actionAllowed("move")) {
      this.state.movementIntent = { forward: 0, right: 0 };
      return;
    }
    this.state.movementIntent = createExplorationMovementIntent(forward, right);
    if ((forward > 0 && !this.actionAllowed("forward")) || (forward < 0 && !this.actionAllowed("backward")))
      this.state.movementIntent.forward = 0;
  };

  public readonly setLook = (yaw: number, pitch: number) => {
    if (this.state.disposed || this.state.phase !== "possessed" || this.state.suspended ||
      !this.actionAllowed("look")) {
      this.state.lookIntent = { pitch: 0, yaw: 0 };
      return;
    }
    this.state.lookIntent = createExplorationLookIntent(yaw, pitch);
  };

  public readonly clearInputs = () => this.resetMovementInputs();

  /** Escape is the possessed back key: put the spyglass away first, otherwise request leaving. */
  public readonly escape = () => {
    if (this.state.disposed || this.state.suspended) return;
    if (this.state.phase === "possessed" && this.state.spyglass) {
      this.state.spyglass = false;
      this.renderPossessed();
      this.publish(true);
      return;
    }
    this.clearInputs();
    if (this.state.phase === "possessed") this.requestLeave("leave");
  };

  public readonly phase = () => this.state.phase;

  public readonly setSuspended = (suspended: boolean) => {
    if (this.state.disposed || suspended === this.state.suspended) return;
    this.state.suspended = suspended;
    this.resetMovementInputs();
    // Owner answer Q6 (2026-11-11): the spyglass is lowered for the cinematic and left down afterwards.
    if (suspended) this.state.spyglass = false;
    if (this.state.phase === "possessed") this.renderPossessed();
    this.publish(true);
  };

  public readonly suspended = () => this.state.suspended;

  /** Terminal teardown: releases the lease and every injected adapter exactly once. */
  public readonly dispose = () => {
    if (this.state.disposed) return;
    this.state.disposed = true;
    this.state.entryToken += 1;
    this.settleEntry({ ok: false, reason: "cancelled" });
    this.releaseCurrentLease();
    this.clearVisuals();
    this.state.phase = "disposed";
    this.state.body = null;
    this.state.spawn = null;
    this.state.identity = null;
    this.resetInputs();
    this.state.eligibility = this.readEligibility();
    const finalSnapshot = stateSnapshot(this.state, this.clock.now(), this.state.eligibility);
    this.state.snapshot = finalSnapshot;
    safeCall(() => this.host.ui.publish(finalSnapshot));
    safeCall(() => this.host.visibility.dispose());
    safeCall(() => this.host.smoke.dispose());
    safeCall(() => this.host.weather.dispose());
    safeCall(() => this.host.ui.dispose());
  };
}

export const createExplorationController = (
  host: ExplorationHost,
  options: ExplorationRuntimeOptions
): ExplorationRuntimeController => new ExplorationSessionController(host, options);
