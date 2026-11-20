import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { type BandCursor,createBandCursor } from "../../shared/settlement/event-core/band-cursor";
import {
  auditEventCoreCoverage, type CoverageSystems, EVENT_CORE_LANE_PHASES, type EventCoreCoverage,
  eventCoreLaneOfPhase
} from "../../shared/settlement/event-core/coverage";
import {
  createEventQueue, EVENT_BANDS, type EventQueue
} from "../../shared/settlement/event-core/event-queue";
import { runEventQueue } from "../../shared/settlement/event-core/runner";
import { tickOfTime } from "../../shared/settlement/event-core/time-base";
import { scheduleCountdown } from "../../shared/settlement/event-core/timer-kernel";
import {
  advanceFieldProgress, advanceFieldUntilChange, MATURING_FIELD_STATES
} from "../../shared/settlement/field-growth-timer";
import { tickSeconds } from "../../shared/settlement/game-clock";
import type { FishingPhase } from "../../shared/settlement/outdoor-work-timing";
import { BUILDER_HAMMER } from "../../shared/settlement/settlement-construction";
import type { SettlementFieldFrame } from "../../shared/settlement/settlement-field-cycles";
import { HUNT_ARROW_RELEASE_SECONDS } from "../../shared/settlement/settlement-hunting";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { EventCoreActorLane } from "../../shared/settlement/settlement-types";
import type { createOfflineIslandRuntime } from "./offline-island-runtime";

type Runtime = ReturnType<typeof createOfflineIslandRuntime>;

interface FieldRecord {
  lastTick: number;
  progress: number;
  site: SettlementFieldFrame;
  state: SettlementFieldFrame["state"];
  version: number;
}

interface TimerRecord {
  baseTick: number;
  dueTick?: number;
  maskFromTick: number;
  residue?: number;
  startValue: number;
  version: number;
}

/** Fixed-lane state counts for the coverage report; none of these is skipped by the event core. */
const coverageSystems = (simulation: SettlementSimulation): CoverageSystems => {
  const trade = simulation.trade();
  const tavern = simulation.tavernOrders();
  return {
    adventure: !!simulation.adventure(),
    arrows: simulation.militaryArrows().length,
    authoredScenario: !!simulation.authoredScenarioStatus(),
    colony: !!simulation.colony(),
    militaryBuildings: simulation.militaryBuildings().length,
    npcTraders: trade?.npcTraders ?? false,
    ships: simulation.shipSites().length,
    soldiers: simulation.militarySoldiers().length,
    tavernBatches: tavern.reduce((sum, entry) => sum + (entry.current ? 1 : 0) + entry.queue.length, 0),
    tradeDeliveries: trade?.deliveries.length ?? 0,
    tradeEscrow: trade?.escrow.length ?? 0,
    tradeOffers: trade?.offers.length ?? 0
  };
};

/** Bring the event-owned hunter wait to the saved end tick without running fixed ticks. */
const settleHuntWaitLane = (
  huntWait: Map<number, TimerRecord>,
  actorOf: (uid: number) => { phase: string; timer: number } | undefined,
  complete: (uid: number) => void,
  currentTick: number,
  setApplying: (value: boolean) => void
) => {
  for (const uid of huntWait.keys()) {
    const actor = actorOf(uid);
    if (!actor || actor.phase !== "huntWait") { huntWait.delete(uid); continue; }
    let record = huntWait.get(uid)!;
    let guard = 0;
    while (record.dueTick !== undefined && record.dueTick <= currentTick) {
      if (++guard > 1000) break;
      if (record.residue !== undefined) actor.timer = record.residue;
      setApplying(true);
      try { complete(uid); } finally { setApplying(false); }
      if (actor.phase !== "huntWait") { huntWait.delete(uid); break; }
      const next = huntWait.get(uid);
      if (!next) break;
      record = next;
    }
    if (actor.phase !== "huntWait") continue;
    const active = huntWait.get(uid);
    if (!active) continue;
    const elapsed = Math.max(0, currentTick - active.baseTick);
    let value = active.startValue;
    for (let step = 0; step < elapsed; step++) value -= TICK_SECONDS;
    actor.timer = value;
  }
};

/** Field progress, boundary scheduling and reconciliation, kept out of the plan body. */
const createFieldLane = (simulation: SettlementSimulation, queue: EventQueue) => {
  const fields = new Map<number, FieldRecord>();
  const scheduledFields = new Set<number>();
  const cropRate = () => 1 + simulation.talentModifiers().fieldGrowthSpeed;
  const frames = () => simulation.fieldSites() as readonly SettlementFieldFrame[];
  const schedule = (site: SettlementFieldFrame, baseTick: number) => {
    const record = fields.get(site.id);
    scheduledFields.delete(site.id);
    if (!record) return;
    record.version++;
    if (!MATURING_FIELD_STATES.has(site.state)) return;
    const change = advanceFieldUntilChange(site, cropRate());
    if (!change) return;
    // `change.tick` updates from the current state; the first one runs on `baseTick`.
    const tick = baseTick + change.tick - 1;
    if (tick < baseTick) return;
    queue.push({ band: EVENT_BANDS.systems, entity: `field:${site.id}`, id: `field:${site.id}`,
      kind: "field-change", order: 0, tick, version: record.version });
    scheduledFields.add(site.id);
  };
  const sync = (site: SettlementFieldFrame, tick: number) => {
    let record = fields.get(site.id);
    if (!record) {
      record = { lastTick: tick, progress: site.progress, site, state: site.state, version: 0 };
      fields.set(site.id, record);
    } else {
      record.lastTick = tick;
      record.progress = site.progress;
      record.site = site;
      record.state = site.state;
    }
    schedule(site, tick);
  };
  const apply = (site: SettlementFieldFrame, record: FieldRecord, tick: number) => {
    const rate = cropRate();
    for (let step = record.lastTick; step <= tick; step++) {
      const next = advanceFieldProgress(site, TICK_SECONDS, rate);
      if (!next) return false;
      site.progress = next.progress;
      if (next.state !== site.state) {
        site.state = next.state;
        if (next.state === "ripe" || next.state === "uncovering") site.step = 0;
      }
    }
    record.lastTick = tick + 1;
    record.progress = site.progress;
    record.state = site.state;
    return true;
  };
  const reconcile = (tick: number) => {
    const seen = new Set<number>();
    for (const site of frames()) {
      seen.add(site.id);
      const record = fields.get(site.id);
      if (!record) { sync(site, tick); continue; }
      record.site = site;
      if (record.state === site.state && record.progress === site.progress) continue;
      record.lastTick = tick;
      record.progress = site.progress;
      record.state = site.state;
      schedule(site, tick);
    }
    for (const id of fields.keys()) if (!seen.has(id)) { fields.delete(id); scheduledFields.delete(id); }
  };
  return { apply, fields, frames, reconcile, scheduledFields, schedule, sync };
};

/**
 * Phase A timer lane: owns field growth, tree growth and the population/stone scheduler phases while
 * the fixed tick owns every actor, building, carrier, ship and trade system. Field progress is still
 * advanced with the same per-tick float operations, but only when a site reaches a boundary or the
 * replay is saved.
 *
 * Actor timer events are applied at the tick after the reference boundary (the existing event-core
 * convention): the fixed tick's masked phase would have completed during the previous tick and
 * returned, so the handler reproduces that end-of-tick state before the next actor update.
 */
export const createEventCorePlan = (simulation: SettlementSimulation, runtime: Runtime) => {
  const queue: EventQueue = createEventQueue();
  const fieldLane = createFieldLane(simulation, queue);
  const { fields, scheduledFields } = fieldLane;
  const fishing = new Map<number, TimerRecord>();
  const work = new Map<number, TimerRecord>();
  const foresterPlant = new Map<number, TimerRecord>();
  const huntFlight = new Map<number, TimerRecord>();
  const huntAim = new Map<number, TimerRecord>();
  const huntWait = new Map<number, TimerRecord>();
  const builderContact = new Map<number, TimerRecord>();
  const laneMaps: Record<EventCoreActorLane, Map<number, TimerRecord>> = {
    builderContact, fishing, foresterPlant, huntAim, huntFlight, huntWait, work
  };
  let currentTick = simulation.gameTick();
  let runnerCursor: BandCursor = createBandCursor(currentTick, 0);
  let fieldRevision = simulation.fieldRevision();
  let treeRevision = runtime.treeGrowth.revision();
  let nextTreeTick: number | null = null;
  let updates = 0;
  let eventsProcessed = 0;
  /** True while a handler is applying a boundary; phases it starts are active on this tick. */
  let applyingBoundary = false;
  const fieldFrames = fieldLane.frames;
  const liveActors = () => simulation.frames();
  /** Accelerated in-place workers stay on the fixed lane; timers advance by dt × cycleRate. */
  const eventOwned = (uid: number) => simulation.eventWorkerCycleRate(uid) === 1;
  const actorOf = (uid: number) => liveActors().find(actor => actor.uid === uid);

  const clearActor = (uid: number) => {
    for (const map of Object.values(laneMaps)) map.delete(uid);
  };

  const scheduleTree = (baseTick: number) => {
    const boundary = runtime.treeGrowth.nextBoundary(tickSeconds(baseTick));
    nextTreeTick = boundary === null ? null : Math.max(baseTick, tickOfTime(boundary));
  };

  const reconcileTree = (tick: number) => {
    if (runtime.treeGrowth.revision() === treeRevision) return;
    treeRevision = runtime.treeGrowth.revision();
    scheduleTree(tick);
  };

  const runTree = (tick: number) => {
    runtime.treeGrowth.setNow(tickSeconds(tick));
    reconcileTree(tick);
    let guard = 0;
    while (nextTreeTick !== null && nextTreeTick <= tick) {
      if (++guard > 1000) throw new Error(`tree growth did not advance at tick ${tick}, next ${nextTreeTick}`);
      runtime.treeGrowth.update(tickSeconds(tick));
      treeRevision = runtime.treeGrowth.revision();
      scheduleTree(tick);
      // A boundary can be the same float second as the tick but just below the age subtraction;
      // the reference then advances on the next tick, not this one.
      if (nextTreeTick !== null && nextTreeTick <= tick) nextTreeTick = tick + 1;
    }
  };

  const scheduleActorTimer = (
    map: Map<number, TimerRecord>, lane: EventCoreActorLane, uid: number, kind: string, idPrefix: string,
    timer: number, baseTick: number, maskFromTick: number
  ) => {
    if (lane !== "builderContact" && !eventOwned(uid)) { map.delete(uid); return false; }
    const record = map.get(uid) ?? { baseTick, maskFromTick, startValue: timer, version: 0 };
    record.version++;
    record.baseTick = baseTick;
    record.maskFromTick = maskFromTick;
    record.startValue = timer;
    record.dueTick = undefined;
    record.residue = undefined;
    map.set(uid, record);
    const advance = scheduleCountdown(queue, {
      band: EVENT_BANDS.actors, entity: `${idPrefix}:${uid}`, id: `${idPrefix}:${uid}`, kind,
      order: 0, startTick: baseTick, startValue: timer, version: record.version
    }, 100_000, TICK_SECONDS);
    if (advance.fireTick !== null) {
      record.dueTick = baseTick + advance.fireTick;
      record.residue = advance.residue;
    }
    return advance.fireTick !== null;
  };

  const scheduleFishing = (uid: number, _phase: FishingPhase, timer: number, baseTick: number,
    maskFromTick: number) =>
    scheduleActorTimer(fishing, "fishing", uid, "fish-phase", "fish", timer, baseTick, maskFromTick);
  const scheduleWork = (uid: number, timer: number, baseTick: number, maskFromTick: number) =>
    scheduleActorTimer(work, "work", uid, "work-phase", "work", timer, baseTick, maskFromTick);
  const scheduleForesterPlant = (uid: number, timer: number, baseTick: number, maskFromTick: number) =>
    scheduleActorTimer(foresterPlant, "foresterPlant", uid, "forester-plant", "forester", timer, baseTick, maskFromTick);
  const scheduleHuntFlight = (uid: number, timer: number, baseTick: number, maskFromTick: number) =>
    scheduleActorTimer(huntFlight, "huntFlight", uid, "hunt-flight", "hunt", timer, baseTick, maskFromTick);
  const scheduleHuntAim = (uid: number, baseTick: number, maskFromTick: number) =>
    scheduleActorTimer(huntAim, "huntAim", uid, "hunt-aim", "aim", HUNT_ARROW_RELEASE_SECONDS, baseTick, maskFromTick);
  const scheduleHuntWait = (uid: number, timer: number, baseTick: number, maskFromTick: number) =>
    scheduleActorTimer(huntWait, "huntWait", uid, "hunt-wait", "wait", timer, baseTick, maskFromTick);
  const scheduleBuilderContact = (uid: number, timer: number, baseTick: number, maskFromTick: number) =>
    scheduleActorTimer(builderContact, "builderContact", uid, "builder-contact", "builder", timer, baseTick, maskFromTick);

  /**
   * The fixed tick calls this when a masked phase starts, so the boundary is scheduled for the next
   * tick. A boundary handler calls it while `applyingBoundary` is true: the phase it starts is the
   * one the reference had already started on this tick, so the fixed tick must process its first
   * step now and the event core masks it from the following tick.
   */
  const onWorkerPhase = (actor: { uid: number; phase: string; timer: number }) => {
    clearActor(actor.uid);
    const baseTick = applyingBoundary ? currentTick : currentTick + 1;
    const maskFromTick = applyingBoundary ? currentTick + 1 : baseTick;
    if (["fishCast", "fishWait", "fishReel"].includes(actor.phase))
      scheduleFishing(actor.uid, actor.phase as FishingPhase, actor.timer, baseTick, maskFromTick);
    else if (actor.phase === "work")
      scheduleWork(actor.uid, actor.timer, baseTick, maskFromTick);
    else if (actor.phase === "foresterPlant")
      scheduleForesterPlant(actor.uid, actor.timer, baseTick, maskFromTick);
    else if (actor.phase === "huntFlight")
      scheduleHuntFlight(actor.uid, actor.timer, baseTick, maskFromTick);
    else if (actor.phase === "huntAim")
      scheduleHuntAim(actor.uid, baseTick, maskFromTick);
    else if (actor.phase === "huntWait")
      scheduleHuntWait(actor.uid, actor.timer, baseTick, maskFromTick);
    else if (actor.phase === "construct")
      scheduleBuilderContact(actor.uid, BUILDER_HAMMER.contact, baseTick, maskFromTick);
  };

  const laneRecord = (actor: { uid: number; phase: string }, lane: EventCoreActorLane) => {
    const record = laneMaps[lane].get(actor.uid);
    if (!record || record.maskFromTick > currentTick) return undefined;
    return EVENT_CORE_LANE_PHASES[lane].includes(actor.phase) ? record : undefined;
  };

  const owns = (actor: { uid: number; phase: string }, lane: EventCoreActorLane) =>
    laneRecord(actor, lane) !== undefined;

  const audit = (): EventCoreCoverage => {
    const actors = liveActors();
    const ownedLanes: Partial<Record<EventCoreActorLane, Set<number>>> = {};
    const eligibleLanes: Partial<Record<EventCoreActorLane, Set<number>>> = {};
    for (const actor of actors) {
      const lane = eventCoreLaneOfPhase(actor.phase);
      if (!lane) continue;
      if (lane === "builderContact" || eventOwned(actor.uid))
        (eligibleLanes[lane] ??= new Set()).add(actor.uid);
    }
    for (const [lane, map] of Object.entries(laneMaps) as [EventCoreActorLane, Map<number, TimerRecord>][]) {
      ownedLanes[lane] = new Set([...map.keys()].filter(uid => {
        const actor = actors.find(entry => entry.uid === uid);
        return actor !== undefined && EVENT_CORE_LANE_PHASES[lane].includes(actor.phase);
      }));
    }
    return auditEventCoreCoverage({
      actors,
      eligible: eligibleLanes,
      fields: fieldFrames(),
      maskedLanes: new Set(Object.keys(EVENT_CORE_LANE_PHASES) as EventCoreActorLane[]),
      owned: { fields: scheduledFields, lanes: ownedLanes, population: true, stone: true, tree: true },
      systems: coverageSystems(simulation)
    });
  };

  const beforeTick = () => {
    const tick = currentTick;
    runTree(tick);
    if (!queue.size || queue.peek()!.tick > tick) return;
    let result;
    applyingBoundary = true;
    try {
      result = runEventQueue(queue, {
        endTick: tick,
        cursor: runnerCursor,
        handler: (event, cursor) => {
          if (event.kind === "builder-contact") {
            const uid = Number(event.id.slice("builder:".length));
            const record = builderContact.get(uid);
            if (!record || event.version !== record.version) return;
            if (simulation.eventBuilderContactTick(uid))
              scheduleBuilderContact(uid, BUILDER_HAMMER.duration, cursor.tick + 1, cursor.tick + 1);
            else builderContact.delete(uid);
            return;
          }
          if (event.kind === "hunt-aim") {
            const uid = Number(event.id.slice("aim:".length));
            const record = huntAim.get(uid);
            if (!record || event.version !== record.version) return;
            if (!eventOwned(uid)) { huntAim.delete(uid); return; }
            simulation.eventHuntAimTick(uid);
            huntAim.delete(uid);
            return;
          }
          if (event.kind === "hunt-flight") {
            const uid = Number(event.id.slice("hunt:".length));
            const record = huntFlight.get(uid);
            if (!record || event.version !== record.version) return;
            if (!eventOwned(uid)) { huntFlight.delete(uid); return; }
            simulation.eventHuntFlightTick(uid);
            huntFlight.delete(uid);
            return;
          }
          if (event.kind === "hunt-wait") {
            const uid = Number(event.id.slice("wait:".length));
            const record = huntWait.get(uid);
            if (!record || event.version !== record.version) return;
            if (!eventOwned(uid)) { huntWait.delete(uid); return; }
            const actor = actorOf(uid);
            if (!actor || actor.phase !== "huntWait") { huntWait.delete(uid); return; }
            if (record.residue !== undefined) actor.timer = record.residue;
            simulation.eventHuntWaitTick(uid);
            if (huntWait.get(uid) === record) huntWait.delete(uid);
            return;
          }
          if (event.kind === "forester-plant") {
            const uid = Number(event.id.slice("forester:".length));
            const record = foresterPlant.get(uid);
            if (!record || event.version !== record.version) return;
            if (!eventOwned(uid)) { foresterPlant.delete(uid); return; }
            simulation.eventForesterPlantTick(uid);
            foresterPlant.delete(uid);
            return;
          }
          if (event.kind === "work-phase") {
            const uid = Number(event.id.slice("work:".length));
            const record = work.get(uid);
            if (!record || event.version !== record.version) return;
            if (!eventOwned(uid)) { work.delete(uid); return; }
            simulation.eventWorkTick(uid);
            work.delete(uid);
            return;
          }
          if (event.kind === "fish-phase") {
            const uid = Number(event.id.slice("fish:".length));
            const record = fishing.get(uid);
            if (!record || event.version !== record.version) return;
            if (!eventOwned(uid)) { fishing.delete(uid); return; }
            const next = simulation.eventFishingTick(uid);
            if (!next || next.done) { fishing.delete(uid); return; }
            scheduleFishing(uid, next.phase as FishingPhase, next.timer, cursor.tick, cursor.tick + 1);
            return;
          }
          const id = Number(event.id.slice("field:".length)), record = fields.get(id);
          if (!record || event.kind !== "field-change" || event.version !== record.version) return;
          scheduledFields.delete(id);
          if (!fieldLane.apply(record.site, record, cursor.tick)) return;
          fieldLane.schedule(record.site, cursor.tick + 1);
        }
      });
    } finally {
      applyingBoundary = false;
    }
    runnerCursor = result.cursor;
    eventsProcessed += result.events;
  };

  const afterTick = () => {
    currentTick++;
    updates++;
    const revision = simulation.fieldRevision();
    if (revision === fieldRevision) return;
    fieldRevision = revision;
    fieldLane.reconcile(currentTick);
  };

  const onScheduler = (phase: "population" | "stone", dt: number) => {
    if (phase === "population") simulation.eventPopulationTick(dt);
    else simulation.eventStoneTick(dt);
  };

  /** Bring the event-owned hunter wait to the saved end tick without running fixed ticks. */
  const settle = () => {
    for (const record of fields.values()) {
      if (!MATURING_FIELD_STATES.has(record.site.state)) continue;
      fieldLane.apply(record.site, record, currentTick - 1);
      scheduledFields.delete(record.site.id);
    }
    settleHuntWaitLane(huntWait, actorOf, uid => simulation.eventHuntWaitTick(uid), currentTick,
      value => { applyingBoundary = value; });
    if (updates > 0) {
      runtime.treeGrowth.setNow(tickSeconds(currentTick - 1));
      runtime.treeGrowth.update(tickSeconds(currentTick - 1));
    }
  };

  // The saved state is the base: schedule every maturing field and start the growth clock.
  for (const site of fieldFrames()) fieldLane.sync(site, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (["fishCast", "fishWait", "fishReel"].includes(actor.phase))
      scheduleFishing(actor.uid, actor.phase as FishingPhase, actor.timer, currentTick, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (actor.phase === "work") scheduleWork(actor.uid, actor.timer, currentTick, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (actor.phase === "foresterPlant") scheduleForesterPlant(actor.uid, actor.timer, currentTick, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (actor.phase === "huntFlight") scheduleHuntFlight(actor.uid, actor.timer, currentTick, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (actor.phase === "huntAim") scheduleHuntAim(actor.uid, currentTick, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (actor.phase === "huntWait") scheduleHuntWait(actor.uid, actor.timer, currentTick, currentTick);
  for (const actor of simulation.snapshot().actors)
    if (actor.phase === "construct") scheduleBuilderContact(actor.uid, BUILDER_HAMMER.contact, currentTick, currentTick);
  runtime.treeGrowth.update(tickSeconds(currentTick));
  treeRevision = runtime.treeGrowth.revision();
  scheduleTree(currentTick);

  return {
    afterTick, audit, beforeTick, currentTick: () => currentTick, fields: () => fields.size, onScheduler,
    onWorkerPhase, owns, settle,
    metrics: () => ({ events: eventsProcessed, fields: fields.size, queue: queue.size,
      scheduledFields: scheduledFields.size })
  };
};
