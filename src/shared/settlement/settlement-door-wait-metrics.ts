import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/**
 * Opt-in diagnostic wait accounting for the storage-door FIFO. It is disabled by default and only
 * observes values the queue already computes (the registration/request clock and actor phase), so
 * enabling it cannot change an admission, movement or save result. Benches enable it after
 * `loadState`; a load replaces the transient key and therefore clears the samples with the queue.
 */
export type DoorWaitKind = "arrival" | "departure";
export interface DoorWaitSample {
  building: number;
  completedAt: number;
  job: string;
  kind: DoorWaitKind;
  phase: string;
  seconds: number;
  startedAt: number;
  uid: number;
}
export interface DoorWaitActive {
  building: number;
  job: string;
  kind: DoorWaitKind;
  phase: string;
  seconds: number;
  uid: number;
}
interface ActiveWait {
  building: number;
  job: string;
  kind: DoorWaitKind;
  phase: string;
  startedAt: number;
  uid: number;
}
interface DoorWaitMetricsState {
  active: Map<SettlementActor, ActiveWait>;
  completed: DoorWaitSample[];
  departureActive: Map<SettlementActor, ActiveWait>;
  departureCompleted: DoorWaitSample[];
  enabled: boolean;
  maxDepartureObservedSeconds: number;
  maxObservedSeconds: number;
  now: number;
  totalCompleted: number;
  totalDepartures: number;
}
export interface DoorWaitSnapshot {
  active: DoorWaitActive[];
  activeCount: number;
  completed: DoorWaitSample[];
  completedCount: number;
  departureActive: DoorWaitActive[];
  departureActiveCount: number;
  departureCompleted: DoorWaitSample[];
  departureCount: number;
  enabled: boolean;
  maxCompletedSeconds: number;
  maxDepartureObservedSeconds: number;
  maxObservedSeconds: number;
  now: number;
  p95CompletedSeconds: number;
  p95DepartureSeconds: number;
}
const MAX_COMPLETED_SAMPLES = 20_000;
const states = createTransientMap<DoorWaitMetricsState>();
const stateFor = (context: SettlementContext) => states.get(context);
const percentile = (samples: DoorWaitSample[], fraction: number) => {
  if (!samples.length) return 0;
  const sorted = samples.map((sample) => sample.seconds).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
};
const emptySnapshot = (): DoorWaitSnapshot => ({
  active: [], activeCount: 0, completed: [], completedCount: 0, departureActive: [],
  departureActiveCount: 0, departureCompleted: [], departureCount: 0, enabled: false,
  maxCompletedSeconds: 0,
  maxDepartureObservedSeconds: 0, maxObservedSeconds: 0, now: 0, p95CompletedSeconds: 0,
  p95DepartureSeconds: 0
});
/** Starts a fresh, empty measurement set. Call after the save has been loaded. */
export const enableDoorWaitMetrics = (context: SettlementContext) => {
  states.set(context, {
    active: new Map(), completed: [], departureActive: new Map(), departureCompleted: [],
    enabled: true, maxDepartureObservedSeconds: 0, maxObservedSeconds: 0, now: 0,
    totalCompleted: 0, totalDepartures: 0
  });
};
const startWait = (
  map: Map<SettlementActor, ActiveWait>, actor: SettlementActor, building: number,
  kind: DoorWaitKind, now: number
) => {
  const current = map.get(actor);
  if (current?.building === building && current.kind === kind) return;
  // A changed destination is a new queue, not a completed wait at the previous door.
  map.set(actor, {
    building, job: actor.job, kind, phase: actor.phase, startedAt: now, uid: actor.uid
  });
};
const finishWait = (
  map: Map<SettlementActor, ActiveWait>, samples: DoorWaitSample[], actor: SettlementActor, now: number
) => {
  const wait = map.get(actor);
  if (!wait) return undefined;
  map.delete(actor);
  const sample = {
    building: wait.building, completedAt: now, job: wait.job, kind: wait.kind, phase: wait.phase,
    seconds: Math.max(0, now - wait.startedAt), startedAt: wait.startedAt, uid: wait.uid
  };
  if (samples.length < MAX_COMPLETED_SAMPLES) samples.push(sample);
  return sample;
};
/** A registration is the first moment this person is entitled to an arrival door turn. */
export const beginDoorWait = (
  context: SettlementContext, actor: SettlementActor, building: number, now: number
) => {
  const state = stateFor(context);
  if (state?.enabled) startWait(state.active, actor, building, "arrival", now);
};
/** A hidden crew requested permission to leave this storage door. */
export const beginDoorDeparture = (
  context: SettlementContext, actor: SettlementActor, building: number, now: number
) => {
  const state = stateFor(context);
  if (state?.enabled) startWait(state.departureActive, actor, building, "departure", now);
};
/** The queue owner is cleared to walk to the access: its wait is now a completed arrival. */
export const completeDoorWait = (context: SettlementContext, actor: SettlementActor, now: number) => {
  const state = stateFor(context);
  if (!state?.enabled) return;
  const sample = finishWait(state.active, state.completed, actor, now);
  if (!sample) return;
  state.maxObservedSeconds = Math.max(state.maxObservedSeconds, sample.seconds);
  state.totalCompleted++;
};
/** The door let a hidden crew out: its departure request wait is complete. */
export const completeDoorDeparture = (
  context: SettlementContext, actor: SettlementActor, now: number
) => {
  const state = stateFor(context);
  if (!state?.enabled) return;
  const sample = finishWait(state.departureActive, state.departureCompleted, actor, now);
  if (!sample) return;
  state.maxDepartureObservedSeconds = Math.max(state.maxDepartureObservedSeconds, sample.seconds);
  state.totalDepartures++;
};
/** The led animal continues the escort's door wait, so its age is not restarted. */
export const handoffDoorWait = (
  context: SettlementContext, escort: SettlementActor, animal: SettlementActor
) => {
  const state = stateFor(context), wait = state?.active.get(escort);
  if (!state?.enabled || !wait) return;
  state.active.delete(escort);
  state.active.set(animal, { ...wait, job: animal.job, phase: animal.phase, uid: animal.uid });
};
/** A recycled person or a departure that never became an arrival is not a completed wait. */
export const forgetDoorWait = (context: SettlementContext, actor: SettlementActor) => {
  stateFor(context)?.active.delete(actor);
};
/** A departure request whose person/phase changed is no longer waiting for this door. */
export const forgetDoorDeparture = (context: SettlementContext, actor: SettlementActor) => {
  stateFor(context)?.departureActive.delete(actor);
};
/** Called once per traffic tick: samples the maximum active wait and drops stale registrations. */
export const observeDoorWaits = (context: SettlementContext, now: number) => {
  const state = stateFor(context);
  if (!state?.enabled) return;
  state.now = now;
  for (const [actor, wait] of state.active) {
    const registered = actor.storageArrivalBuilding === wait.building &&
      actor.storageArrivalOrder !== undefined;
    const waitingPhase = ["home", "retire", "pickup", "deliver"].includes(actor.phase);
    if (!context.actors.includes(actor) || !registered || !waitingPhase) {
      state.active.delete(actor);
      continue;
    }
    state.maxObservedSeconds = Math.max(state.maxObservedSeconds, now - wait.startedAt);
  }
  for (const [actor, wait] of state.departureActive) {
    if (!context.actors.includes(actor) || actor.visible) {
      state.departureActive.delete(actor);
      continue;
    }
    state.maxDepartureObservedSeconds = Math.max(state.maxDepartureObservedSeconds, now - wait.startedAt);
  }
};
export const doorWaitSnapshot = (context: SettlementContext): DoorWaitSnapshot => {
  const state = stateFor(context);
  if (!state?.enabled) return emptySnapshot();
  const activeFor = (map: Map<SettlementActor, ActiveWait>) => [...map.values()].map((wait) => ({
    building: wait.building, job: wait.job, kind: wait.kind, phase: wait.phase,
    seconds: Math.max(0, state.now - wait.startedAt), uid: wait.uid
  }));
  const active = activeFor(state.active), departureActive = activeFor(state.departureActive);
  return {
    active, activeCount: active.length, completed: state.completed.map((sample) => ({ ...sample })),
    completedCount: state.totalCompleted, departureActive, departureActiveCount: departureActive.length,
    departureCompleted: state.departureCompleted.map((sample) => ({ ...sample })),
    departureCount: state.totalDepartures,
    enabled: true,
    maxCompletedSeconds: state.completed.reduce((max, sample) => Math.max(max, sample.seconds), 0),
    maxDepartureObservedSeconds: state.maxDepartureObservedSeconds,
    maxObservedSeconds: state.maxObservedSeconds, now: state.now,
    p95CompletedSeconds: percentile(state.completed, .95),
    p95DepartureSeconds: percentile(state.departureCompleted, .95)
  };
};
