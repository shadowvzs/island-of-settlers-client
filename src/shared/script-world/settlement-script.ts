import type { ScriptEventKind } from "../../../../island-of-settlers-shared/src/script/catalog/events";
import { scriptReadsEnvironment } from "../../../../island-of-settlers-shared/src/script/environment";
import { regionDependency } from "../../../../island-of-settlers-shared/src/script/engine/conditions";
import { ScriptEngine, type ScriptEngineMode } from "../../../../island-of-settlers-shared/src/script/engine/engine";
import type {
  ScriptEmission, ScriptEventActor
} from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { ScriptRunState } from "../../../../island-of-settlers-shared/src/script/types/run-state";
import type { ActorHandleValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import type { SettlementContext } from "../settlement/settlement-types";
import { deriveSeed } from "../world/rng";
import { createScriptActions, type ScriptActions } from "./actions/script-actions";
import { createCellWatch } from "./cell-watch";
import {
  createNatureGenerations, type NatureGenerations, type NatureSpace, saveNatureGenerations
} from "./nature/nature-actors";
import { createNatureAdapter, detachNature } from "./nature/nature-adapter";
import { createProximityWatch } from "./proximity-watch";
import { type ScriptGenerations, unitHandle } from "./script-actors";
import { bindAuthoredActors, releaseGoneHandle, type ScriptGoneReason } from "./script-bindings";
import { createActionCounters } from "./script-action-counters";
import { createUnitWatch } from "./script-unit-watch";
import { createScriptMembers } from "./script-world-members";
import { createSettlementWorldPort } from "./script-world-port";
import type { SavedSettlementScript } from "./settlement-script-save";
import { createWorldEnvironment, type WorldEnvironment, type WorldEnvironmentReading } from "./world-environment";

/**
 * The island's running map script (TRG3a): the shared engine over the settlement world port. The simulation ticks
 * it after every live fixed tick (`endTick`); offline catch-up switches it to `catchUp`, where emission sites see no
 * subscription, the script clock stays frozen and the run state is saved unchanged (design §7.4, rev B2).
 */
export interface SettlementScript {
  /** Presence and movement actions (TRG5a): story locks, fades, hidden/invulnerable units, presentation. */
  readonly actions: ScriptActions;
  /** Per-island action/production counters (`counterReached`, produce/action objectives); saved and hashed. */
  readonly counters: ReturnType<typeof createActionCounters>;
  readonly engine: ScriptEngine;
  emit: (emission: ScriptEmission) => void;
  endCatchUp: () => void;
  /** End of a live fixed tick: door watch, region watch, proximity watch, world environment, then the engine. */
  endTick: () => void;
  /**
   * The world environment (ENV0): the hour and weather as simulation state, present only when the script reads
   * or writes them (`scriptReadsEnvironment`); saved and hashed with the run state.
   */
  readonly environment?: WorldEnvironment;
  /**
   * The world environment at the script clock, `tickFraction` (0..1) into the next tick; absent without one.
   * `heldTicks` (CIN4): real time a held sequence has played, so an hour change it started plays during the pause.
   */
  environmentReading: (tickFraction?: number, heldTicks?: number) => WorldEnvironmentReading | undefined;
  readonly generations: ScriptGenerations;
  /**
   * A unit or building left the world: a unit leaves its watched regions (`described` is the subject), then the
   * binding/variable clean-up; the door and region watches forget it.
   */
  gone: (handle: ActorHandleValue, reason: ScriptGoneReason, described?: ScriptEventActor) => void;
  /**
   * A hunter's arrow at wildlife slot `slot` (TRG3b): a kill it causes is announced as `animalKilled` by `hunter`
   * before the animal is gone. Returns what `hit` returns.
   */
  huntWith: (slot: number, hunter: ScriptEventActor | undefined, hit: () => boolean) => boolean;
  /** The unit is a member of the playing sequence (CIN4, §6.6): invulnerable and skipped by the AI. */
  isCinematicMember: (uid: number) => boolean;
  /** A story action made the unit invulnerable (TRG5a `setInvulnerable`) or it plays in a sequence; no blow hurts. */
  isInvulnerable: (uid: number) => boolean;
  /** Bit test first: emission sites build payloads only for subscribed kinds (false in catch-up). */
  isSubscribed: (kind: ScriptEventKind) => boolean;
  /** Generations of reused nature slots (animal pool, respawned boulders, reappearing shells); saved. */
  readonly natureGenerations: NatureGenerations;
  /** A nature object left the world: `actorGone`, region leave, clean-up (live), then its slot's generation bump. */
  natureGone: (space: NatureSpace, id: number, reason: ScriptGoneReason, described?: ScriptEventActor) => void;
  /** A settler went back into the idle pool: its uid's next incarnation is another person. */
  retireUnit: (uid: number) => void;
  save: () => SavedSettlementScript;
  /**
   * Guaranteed mode (§6.6): actions never fail for lack of a path or room. It is on by itself while a cinematic
   * sequence plays (CIN4, derived from the saved run state); this switch forces it for tools and tests (not saved).
   */
  setGuaranteed: (on: boolean) => void;
  setMode: (mode: ScriptEngineMode) => void;
}

const SCRIPT_SEED_LABEL = "script";
const NO_MEMBERS: ReadonlySet<number> = new Set();

const generationsFrom = (pairs: readonly number[]): ScriptGenerations => {
  const generations: ScriptGenerations = new Map();
  for (let index = 0; index + 1 < pairs.length; index += 2) generations.set(pairs[index]!, pairs[index + 1]!);
  return generations;
};

/** Emissions still waiting for this tick's end are saved as deferred, so a reload delivers them identically. */
const savedRunState = (engine: ScriptEngine): SavedSettlementScript["state"] => {
  const { snapshot: _snapshot, ...state } = engine.saveState();
  const pending = engine.queue.map(entry => ({
    emission: structuredClone(entry.emission),
    triggerIds: entry.triggers.map(index => engine.script.triggers[index]!.id)
  }));
  return { ...state, deferred: [...state.deferred, ...pending] };
};

type SettlementWorldPort = ReturnType<typeof createSettlementWorldPort>;

/** Unit ids of the playing sequence's members, resolved at most once per script tick and applied step. */
const createCinematicMemberCache = (engine: ScriptEngine) => {
  let key = "";
  let ids = NO_MEMBERS;
  return () => {
    const active = engine.activeCinematic();
    if (!active) return NO_MEMBERS;
    const next = `${active.sequenceId}:${active.applied.length}:${engine.state.scriptTick}`;
    if (next === key) return ids;
    key = next;
    ids = new Set(engine.cinematicMembers().flatMap(handle => handle.space === "actor" ? [handle.id] : []));
    return ids;
  };
};

const createAdapter = (
  context: SettlementContext, generations: ScriptGenerations, open: (port: SettlementWorldPort) => ScriptEngine,
  saved: Pick<SavedSettlementScript, "actions" | "counters" | "environment" | "nature"> = {}
) => {
  let engine: ScriptEngine | undefined;
  let actions: ScriptActions | undefined;
  let guaranteed = false;
  const counters = createActionCounters(saved.counters);
  const natureGenerations = createNatureGenerations(saved.nature);
  const members = createScriptMembers(context, generations, () => engine!.script, () => engine!.port,
    natureGenerations, uid => actions!.isHidden(uid));
  engine = open(createSettlementWorldPort(context, members, request => actions!.perform(request)));
  const opened = engine;
  const environment = scriptReadsEnvironment(opened.script)
    ? createWorldEnvironment(context.options.world, saved.environment) : undefined;
  actions = createScriptActions({ context, engine: () => opened, environment: () => environment, generations,
    guaranteed: () => guaranteed || opened.activeCinematic() !== null, members }, saved.actions);
  const cinematicMembers = createCinematicMemberCache(opened);
  const isSubscribed = (kind: ScriptEventKind) => opened.isSubscribed(kind);
  let ticking = false;
  /** Mid-tick emissions may evaluate slot expressions over the world: they never see an older tick's scan. */
  const emit = (emission: ScriptEmission) => {
    if (!ticking) members.invalidate();
    opened.emit(emission);
  };
  const live = () => opened.mode === "live";
  const watch = createUnitWatch(context, { emit, generations, isSubscribed, live });
  const cells = createCellWatch(context, opened.script, {
    emit, generations, isSubscribed, live, markRegion: id => opened.markDependency(regionDependency(id)),
    natureGenerations
  });
  const proximity = createProximityWatch(context, { emit, engine: () => opened, generations, live, members });
  const nature = createNatureAdapter(context, { cells: () => cells, emit, engine: opened, generations:
    natureGenerations, isSubscribed });
  const resetWatches = () => {
    watch.reset();
    cells?.reset();
    proximity?.reset();
  };
  /** The tick's world environment step: whole hours the clock reached become `clockHour` events. */
  const stepEnvironment = () => {
    if (!environment) return;
    const hours = environment.step(opened.state.scriptTick + 1);
    if (!isSubscribed("clockHour")) return;
    for (const hour of hours) emit({ kind: "clockHour", values: { hour } });
  };
  const script: SettlementScript = {
    actions,
    counters,
    emit,
    endCatchUp: () => {
      members.invalidate();
      opened.endCatchUp();
      resetWatches();
      members.invalidate();
    },
    endTick: () => {
      if (opened.mode !== "live") return;
      members.invalidate();
      actions!.update();
      members.invalidate();
      watch.update();
      cells?.update();
      proximity?.update();
      stepEnvironment();
      ticking = true;
      try { opened.endTick(); } finally { ticking = false; }
      members.invalidate();
    },
    engine: opened,
    environment,
    environmentReading: (tickFraction = 0, heldTicks = 0) => {
      if (!environment) return undefined;
      const tick = opened.state.scriptTick;
      return heldTicks > 0 ? environment.readHeld(tick, heldTicks) : environment.read(tick + tickFraction);
    },
    generations,
    gone: (handle, reason, described) => {
      if (handle.space === "actor") {
        cells?.forget(handle.id, described);
        watch.forget(handle.id);
      }
      if (opened.mode === "live") releaseGoneHandle(opened, handle, reason);
    },
    huntWith: nature.huntWith,
    isCinematicMember: uid => cinematicMembers().has(uid),
    isInvulnerable: uid => actions!.isInvulnerable(uid) || cinematicMembers().has(uid),
    isSubscribed,
    natureGenerations,
    natureGone: nature.natureGone,
    retireUnit: uid => {
      const next = (generations.get(uid) ?? 0) + 1;
      generations.set(uid, next);
    },
    save: () => ({
      ...actions.save(),
      ...counters.save(),
      ...saveNatureGenerations(natureGenerations),
      doors: watch.save(),
      ...(environment ? { environment: environment.save() } : {}),
      generations: [...generations].sort(([a], [b]) => a - b).flat(),
      state: savedRunState(opened)
    }),
    setGuaranteed: on => { guaranteed = on; },
    setMode: mode => {
      const resumed = opened.mode === "catchUp" && mode === "live";
      opened.setMode(mode);
      if (resumed) resetWatches();
    }
  };
  nature.attach();
  return { script, watch };
};

/** Map start: a fresh run state, authored bindings from the spawn table, then `mapStarted` for the first tick. */
export const startSettlementScript = (context: SettlementContext) => {
  const snapshot = context.scriptSnapshot;
  if (!snapshot) {
    context.script = undefined;
    detachNature(context);
    return;
  }
  const generations: ScriptGenerations = new Map();
  const { script, watch } = createAdapter(context, generations, port => ScriptEngine.create(snapshot.script, {
    port, scriptHash: snapshot.scriptHash, seed: deriveSeed(context.options.world.seed, SCRIPT_SEED_LABEL)
  }));
  script.engine.state.actors = bindAuthoredActors(context, generations, snapshot.script);
  script.engine.rebuildInstanceIndex();
  context.script = script;
  script.actions.startMap();
  watch.reset();
  script.engine.start("mapStarted");
};

/** A loaded island: the saved run state over the restored snapshot (a save without one starts the map script). */
export const restoreSettlementScript = (context: SettlementContext, saved: SavedSettlementScript | undefined) => {
  const snapshot = context.scriptSnapshot;
  if (!snapshot) {
    context.script = undefined;
    detachNature(context);
    return;
  }
  if (!saved) {
    startSettlementScript(context);
    return;
  }
  const state: ScriptRunState = { ...structuredClone(saved.state), snapshot };
  const { script, watch } = createAdapter(context, generationsFrom(saved.generations),
    port => ScriptEngine.load(state, port), saved);
  watch.restore(saved.doors);
  context.script = script;
};

/** The save field; absent when the island runs no script (non-script saves stay byte-identical). */
export const saveSettlementScript = (context: SettlementContext): { scriptRun?: SavedSettlementScript } =>
  context.script ? { scriptRun: context.script.save() } : {};

/** The handle of a unit for gone/clean-up calls (generation before a retirement bump). */
export const scriptUnitHandle = (script: SettlementScript, uid: number) => unitHandle(script.generations, uid);
