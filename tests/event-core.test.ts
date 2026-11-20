import { describe, expect, it } from "vitest";

import { nextTreeGrowthTime } from "../src/render-common/growth/tree-growth";
import { advanceStoneRestSeconds, stoneRestSchedulerFires } from "../src/shared/settlement/boulder-respawn";
import {
  beginTick, createBandCursor, enterBand, normalizeBandEvent
} from "../src/shared/settlement/event-core/band-cursor";
import { createEventQueue, EVENT_BANDS, type ScheduledEvent } from "../src/shared/settlement/event-core/event-queue";
import {
  advancePopulationTimers, type PopulationTimerState
} from "../src/shared/settlement/event-core/population-timer";
import { runEventQueue } from "../src/shared/settlement/event-core/runner";
import { tickOfTime } from "../src/shared/settlement/event-core/time-base";
import {
  advanceAccumulator, advanceCountdown, scheduleAccumulator, scheduleCountdown
} from "../src/shared/settlement/event-core/timer-kernel";
import {
  advanceFieldProgress, advanceFieldUntilChange, fieldGrowthSeconds
} from "../src/shared/settlement/field-growth-timer";

const event = (tick: number, band: number, order: number, id: string): ScheduledEvent => ({
  band: band as ScheduledEvent["band"], entity: "test", id, kind: "tick", order, tick, version: 1
});

describe("event-core queue", () => {
  it("pops by tick, band, order and id, with insertion order as the final tie-break", () => {
    const queue = createEventQueue();
    queue.push(event(3, EVENT_BANDS.runtime, 0, "b"));
    queue.push(event(1, EVENT_BANDS.actors, 0, "a"));
    queue.push(event(1, EVENT_BANDS.scheduler, 2, "b"));
    queue.push(event(1, EVENT_BANDS.scheduler, 1, "z"));
    queue.push(event(1, EVENT_BANDS.scheduler, 1, "a"));
    queue.push(event(1, EVENT_BANDS.scheduler, 1, "a"));
    expect([...Array(queue.size)].map(() => queue.pop()!.id)).toEqual(["a", "a", "z", "b", "a", "b"]);
    expect(queue.pop()).toBeUndefined();
  });

  it("clears without keeping the sequence", () => {
    const queue = createEventQueue();
    queue.push(event(1, EVENT_BANDS.scheduler, 0, "a"));
    queue.clear();
    expect(queue.size).toBe(0);
    queue.push(event(1, EVENT_BANDS.scheduler, 0, "a"));
    expect(queue.pop()?.id).toBe("a");
  });
});

describe("event-core runner", () => {
  it("never rewinds to an earlier band and defers the late event to the next tick", () => {
    const queue = createEventQueue(), handled: string[] = [];
    queue.push(event(1, EVENT_BANDS.scheduler, 0, "a"));
    queue.push(event(1, EVENT_BANDS.actors, 0, "b"));
    queue.push(event(2, EVENT_BANDS.runtime, 0, "c"));
    const result = runEventQueue(queue, {
      endTick: 2,
      handler: (current, cursor) => {
        handled.push(`${current.id}:${cursor.tick}/${cursor.band}`);
        if (current.id === "b") queue.push(event(1, EVENT_BANDS.scheduler, 0, "d"));
      }
    });
    expect(handled).toEqual(["a:1/2", "b:1/3", "c:2/0", "d:2/2"]);
    expect(result).toEqual({ cursor: { band: EVENT_BANDS.scheduler, tick: 2 }, events: 4 });
  });

  it("leaves events beyond the end tick queued", () => {
    const queue = createEventQueue(), handled: string[] = [];
    queue.push(event(3, EVENT_BANDS.scheduler, 0, "later"));
    const result = runEventQueue(queue, { endTick: 2, handler: current => handled.push(current.id) });
    expect(handled).toEqual([]);
    expect(queue.size).toBe(1);
    expect(result.events).toBe(0);
  });

  it("honors a supplied cursor when resuming a checkpoint", () => {
    const queue = createEventQueue(), handled: { id: string; tick: number }[] = [];
    queue.push(event(1, EVENT_BANDS.scheduler, 0, "late"));
    const cursor = enterBand(createBandCursor(1, EVENT_BANDS.scheduler), EVENT_BANDS.postActor);
    const result = runEventQueue(queue, {
      endTick: 2,
      cursor,
      handler: current => handled.push({ id: current.id, tick: current.tick })
    });
    expect(handled).toEqual([{ id: "late", tick: 2 }]);
    expect(result.cursor).toEqual({ band: EVENT_BANDS.scheduler, tick: 2 });
  });
});

describe("event-core band cursor", () => {
  it("defers a same-tick event for an earlier band and drops stale events", () => {
    const cursor = enterBand(createBandCursor(10, EVENT_BANDS.scheduler), EVENT_BANDS.actors);
    expect(normalizeBandEvent({ band: EVENT_BANDS.scheduler, tick: 10 }, cursor)).toEqual({
      band: EVENT_BANDS.scheduler, tick: 11
    });
    expect(normalizeBandEvent({ band: EVENT_BANDS.postActor, tick: 10 }, cursor)).toEqual({
      band: EVENT_BANDS.postActor, tick: 10
    });
    expect(normalizeBandEvent({ band: EVENT_BANDS.runtime, tick: 11 }, cursor)).toEqual({
      band: EVENT_BANDS.runtime, tick: 11
    });
    expect(normalizeBandEvent({ band: EVENT_BANDS.runtime, tick: 9 }, cursor)).toBeNull();
  });

  it("starts every tick in band zero", () => {
    expect(beginTick(createBandCursor(4, EVENT_BANDS.postActor), 5)).toEqual({ band: 0, tick: 5 });
  });
});

describe("event-core population timers", () => {
  const state = (overrides: Partial<PopulationTimerState> = {}): PopulationTimerState => ({
    baseSeconds: 60, baseTimer: 0, growthSpeed: 0, limit: 100, people: 0, residences: [], ...overrides
  });
  const advance = (initial: PopulationTimerState, calls: number) => {
    let current = initial, births: string[] = [];
    for (let call = 0; call < calls; call++) {
      const next = advancePopulationTimers(current, .5);
      current = next.state;
      births = [...births, ...next.births.map(birth => birth.source)];
    }
    return { births, state: current };
  };

  it("bears the base settler on the 120th half-second fire", () => {
    expect(advance(state(), 119).births).toEqual([]);
    expect(advance(state(), 120).births).toEqual(["base"]);
  });

  it("bears each residence in building order and stops at the people limit", () => {
    const residences = [{ id: "small", seconds: 30, timer: 0 }, { id: "big", seconds: 20, timer: 0 }];
    expect(advance(state({ residences }), 60).births).toEqual(["big", "small"]);
    const full = advancePopulationTimers(state({ baseTimer: 59.5, limit: 1, people: 0, residences }), .5);
    expect(full.births).toEqual([{ source: "base" }]);
    expect(full.state.residences).toEqual(residences);
  });

  it("applies the settler-growth talent before the timer threshold", () => {
    expect(advance(state({ baseSeconds: 60, growthSpeed: .5 }), 79).births).toEqual([]);
    expect(advance(state({ baseSeconds: 60, growthSpeed: .5 }), 80).births).toEqual(["base"]);
  });
});

describe("event-core field growth", () => {
  it("keeps grain at 120 s, charcoal at 60 s and uses the talent rate for crops", () => {
    expect(fieldGrowthSeconds({ kind: "grain", state: "growing" })).toBe(120);
    expect(fieldGrowthSeconds({ kind: "charcoal", state: "burning" })).toBe(60);
    expect(advanceFieldProgress({ kind: "grain", progress: .5, state: "growing" }, 30, 1))
      .toMatchObject({ progress: .75, state: "growing" });
    expect(advanceFieldProgress({ kind: "grain", progress: .5, state: "growing" }, 30, 1.5))
      .toMatchObject({ progress: .875, state: "growing" });
    expect(advanceFieldProgress({ kind: "charcoal", progress: .5, state: "burning" }, 30, 2))
      .toMatchObject({ progress: 1, state: "uncovering" });
  });

  it("rips only maturing sites and leaves stubble/coal to the worker", () => {
    expect(advanceFieldProgress({ kind: "grain", progress: 1, state: "growing" }, 1, 1))
      .toMatchObject({ progress: 1, state: "ripe" });
    expect(advanceFieldProgress({ kind: "grain", progress: .9, state: "ripe" }, 1, 1)).toBeNull();
    expect(advanceFieldProgress({ kind: "grain", progress: .9, state: "coal" }, 1, 1)).toBeNull();
    expect(advanceFieldProgress({ kind: "grain", progress: .9, state: "growing" }, 12, 1))
      .toMatchObject({ progress: 1, state: "ripe" });
  });

  it("schedules the next state change on the exact fixed tick", () => {
    expect(advanceFieldUntilChange({ kind: "grain", progress: .5, state: "growing" }, 1))
      .toMatchObject({ tick: 1200, site: { progress: 1, state: "ripe" } });
    expect(advanceFieldUntilChange({ kind: "charcoal", progress: 0, state: "burning" }, 2))
      .toMatchObject({ tick: 1200, site: { progress: 1, state: "uncovering" } });
    expect(advanceFieldUntilChange({ kind: "grain", progress: .5, state: "ripe" }, 1)).toBeNull();
  });
});

describe("event-core time base", () => {
  it("rounds a boundary up when it is a float hair past a tick time", () => {
    expect(tickOfTime(30)).toBe(600);
    expect(tickOfTime(30.000000000000004)).toBe(601);
    expect(tickOfTime(29.999999999999996)).toBe(600);
    expect(tickOfTime(2067.2)).toBe(41344);
    expect(tickOfTime(2067.2000000000003)).toBe(41345);
    expect(tickOfTime(0)).toBe(0);
  });
});

describe("event-core tree growth boundaries", () => {
  it("schedules four 30-second stage boundaries and stops at maturity", () => {
    expect(nextTreeGrowthTime(0, 0)).toBe(30);
    expect(nextTreeGrowthTime(0, 29.9)).toBe(30);
    expect(nextTreeGrowthTime(0, 30)).toBe(60);
    expect(nextTreeGrowthTime(0, 119)).toBe(120);
    expect(nextTreeGrowthTime(0, 120)).toBeNull();
    expect(nextTreeGrowthTime(10, 10, .5)).toBe(70);
  });
});

describe("event-core stone respawn timer", () => {
  it("counts half-second scheduler fires and clamps at the due point", () => {
    expect(advanceStoneRestSeconds(0, .5)).toBe(.5);
    expect(advanceStoneRestSeconds(299.75, .5)).toBe(300);
    expect(stoneRestSchedulerFires(0)).toEqual({ fires: 600, rest: 300 });
    expect(stoneRestSchedulerFires(299.5)).toEqual({ fires: 1, rest: 300 });
    expect(stoneRestSchedulerFires(300)).toEqual({ fires: 0, rest: 300 });
  });
});

describe("event-core timer parity", () => {
  it("keeps the scheduler's real float boundary: the first fire is tick 11", () => {
    expect(advanceAccumulator(0, 10).fireTicks).toEqual([]);
    expect(advanceAccumulator(0, 11).fireTicks).toEqual([11]);
    expect(advanceAccumulator(0, 11).residue).toBeCloseTo(0.05, 12);
    expect(advanceAccumulator(0, 21).fireTicks).toEqual([11, 21]);
  });

  it("keeps a half-second countdown on tick 11 because of float subtraction", () => {
    expect(advanceCountdown(0.5, 10).fireTick).toBeNull();
    expect(advanceCountdown(0.5, 11).fireTick).toBe(11);
    expect(advanceCountdown(0.49, 10).fireTick).toBe(10);
  });

  it("schedules the same fire ticks as the reference loop", () => {
    const accumulator = advanceAccumulator(0, 21);
    const queue = createEventQueue();
    const schedule = { band: EVENT_BANDS.scheduler, entity: "island", id: "scheduler", kind: "scheduler",
      order: 0, startTick: 100, startValue: 0, version: 1 } as const;
    expect(scheduleAccumulator(queue, schedule, 21).fireTicks).toEqual(accumulator.fireTicks);
    expect([queue.size, queue.pop()!.tick, queue.pop()!.tick]).toEqual([2, 111, 121]);

    const countdownQueue = createEventQueue();
    scheduleCountdown(countdownQueue, { ...schedule, id: "ship", kind: "arrive", startValue: .5 }, 12);
    expect(countdownQueue.pop()).toMatchObject({ id: "ship", tick: 111 });
  });
});
