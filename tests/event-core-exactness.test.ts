import { describe, expect, it } from "vitest";

import { getGrowthState, nextTreeGrowthTime } from "../src/render-common/growth/tree-growth";
import { advanceStoneRestSeconds } from "../src/shared/settlement/boulder-respawn";
import { createEventQueue, EVENT_BANDS } from "../src/shared/settlement/event-core/event-queue";
import { advancePopulationTimers, type PopulationTimerState } from "../src/shared/settlement/event-core/population-timer";
import { runEventQueue } from "../src/shared/settlement/event-core/runner";
import { timeOfTick } from "../src/shared/settlement/event-core/time-base";
import { advanceAccumulator } from "../src/shared/settlement/event-core/timer-kernel";
import { scheduleBoundary } from "../src/shared/settlement/event-core/timer-plan";
import {
  advanceFieldProgress, advanceFieldUntilChange, type FieldGrowthTimer
} from "../src/shared/settlement/field-growth-timer";

const TICKS = 2400;

/** Fixed-tick reference for two extracted timers: a field at half growth and a tree from age zero. */
const referenceTrace = () => {
  let site: FieldGrowthTimer = { kind: "grain", progress: .5, state: "growing" };
  let stage = getGrowthState(0)?.stage ?? 6;
  const events: { id: string; tick: number }[] = [];
  for (let tick = 1; tick <= TICKS; tick++) {
    // Runtime (tree growth) is band 0; field cycles are band 1.
    const nextStage = getGrowthState(timeOfTick(tick))?.stage ?? 6;
    if (nextStage !== stage) { events.push({ id: "tree", tick }); stage = nextStage; }
    const next = advanceFieldProgress(site, .05, 1);
    if (next) {
      if (next.state !== site.state) events.push({ id: "field", tick });
      site = next;
    }
  }
  return events;
};

const LONG_TICKS = 3000;

describe("event-core value trace parity", () => {
  it("matches population, field, tree and stone boundaries in band order", () => {
    const fireTicks = advanceAccumulator(0, LONG_TICKS).fireTicks, fireSet = new Set(fireTicks);
    let population: PopulationTimerState = { baseSeconds: 60, baseTimer: 0, growthSpeed: 0, limit: 10,
      people: 0, residences: [] };
    let site: FieldGrowthTimer = { kind: "grain", progress: .5, state: "growing" };
    let stage = getGrowthState(0)?.stage ?? 6, stoneRest = 295, stoneDone = false;
    const reference: { id: string; tick: number }[] = [];
    for (let tick = 1; tick <= LONG_TICKS; tick++) {
      const nextStage = getGrowthState(timeOfTick(tick))?.stage ?? 6;
      if (nextStage !== stage) { reference.push({ id: "tree", tick }); stage = nextStage; }
      const nextSite = advanceFieldProgress(site, .05, 1);
      if (nextSite) {
        if (nextSite.state !== site.state) reference.push({ id: "field", tick });
        site = nextSite;
      }
      if (!fireSet.has(tick)) continue;
      const nextPopulation = advancePopulationTimers(population, .5);
      if (nextPopulation.births.length) reference.push({ id: "population", tick });
      population = nextPopulation.state;
      stoneRest = advanceStoneRestSeconds(stoneRest, .5);
      if (!stoneDone && stoneRest >= 300) { reference.push({ id: "stone", tick }); stoneDone = true; }
    }

    const queue = createEventQueue(), trace: { id: string; tick: number }[] = [];
    for (const tick of fireTicks) queue.push({ band: EVENT_BANDS.scheduler, entity: "island", id: "scheduler",
      kind: "scheduler", order: 0, tick, version: 1 });
    const field = advanceFieldUntilChange({ kind: "grain", progress: .5, state: "growing" }, 1)!;
    queue.push({ band: EVENT_BANDS.systems, entity: "field:1", id: "field", kind: "ripe", order: 0,
      tick: field.tick, version: 1 });
    scheduleBoundary(queue, { band: EVENT_BANDS.runtime, entity: "tree:1", id: "tree", kind: "stage",
      order: 0, version: 1 }, 0, 0, time => nextTreeGrowthTime(0, time));
    population = { baseSeconds: 60, baseTimer: 0, growthSpeed: 0, limit: 10, people: 0, residences: [] };
    stoneRest = 295;
    stoneDone = false;
    runEventQueue(queue, {
      endTick: LONG_TICKS,
      handler: (event, cursor) => {
        if (event.id === "scheduler") {
          const nextPopulation = advancePopulationTimers(population, .5);
          if (nextPopulation.births.length) trace.push({ id: "population", tick: event.tick });
          population = nextPopulation.state;
          stoneRest = advanceStoneRestSeconds(stoneRest, .5);
          if (!stoneDone && stoneRest >= 300) { trace.push({ id: "stone", tick: event.tick }); stoneDone = true; }
          return;
        }
        trace.push({ id: event.id, tick: event.tick });
        if (event.id === "tree") scheduleBoundary(queue, { band: EVENT_BANDS.runtime, entity: "tree:1",
          id: "tree", kind: "stage", order: 0, version: 1 }, cursor.tick, timeOfTick(cursor.tick),
        time => nextTreeGrowthTime(0, time));
      }
    });
    expect(trace).toEqual(reference);
    expect(trace).toEqual([
      { id: "stone", tick: 101 }, { id: "tree", tick: 600 }, { id: "tree", tick: 1200 },
      { id: "field", tick: 1200 }, { id: "population", tick: 1201 }, { id: "tree", tick: 1800 },
      { id: "tree", tick: 2400 }, { id: "population", tick: 2401 }
    ]);
    expect(population.people).toBe(2);
  });

  it("matches the fixed-tick field and tree boundaries without visiting every tick", () => {
    const queue = createEventQueue(), trace: { id: string; tick: number }[] = [];
    const field = advanceFieldUntilChange({ kind: "grain", progress: .5, state: "growing" }, 1);
    expect(field).not.toBeNull();
    queue.push({ band: EVENT_BANDS.systems, entity: "field:1", id: "field", kind: "ripe", order: 0,
      tick: field!.tick, version: 1 });
    scheduleBoundary(queue, { band: EVENT_BANDS.runtime, entity: "tree:1", id: "tree", kind: "stage",
      order: 0, version: 1 }, 0, 0, time => nextTreeGrowthTime(0, time));
    runEventQueue(queue, {
      endTick: TICKS,
      handler: (event, cursor) => {
        trace.push({ id: event.id, tick: event.tick });
        if (event.id !== "tree") return;
        scheduleBoundary(queue, { band: EVENT_BANDS.runtime, entity: "tree:1", id: "tree", kind: "stage",
          order: 0, version: 1 }, cursor.tick, timeOfTick(cursor.tick), time => nextTreeGrowthTime(0, time));
      }
    });
    expect(trace).toEqual(referenceTrace());
    expect(trace).toEqual([
      { id: "tree", tick: 600 }, { id: "tree", tick: 1200 }, { id: "field", tick: 1200 },
      { id: "tree", tick: 1800 }, { id: "tree", tick: 2400 }
    ]);
  });
});
