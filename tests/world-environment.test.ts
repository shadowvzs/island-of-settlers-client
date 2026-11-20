import { describe, expect, it } from "vitest";

import type { MapScript } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { createEnvironmentController } from "../src/app/environment-controller";
import { followWorldEnvironment } from "../src/app/world-environment-follow";
import { CYCLE_SECONDS } from "../src/shared/environment/constants";
import { clockHourOf, clockSecondsOf } from "../src/shared/environment/world-clock";
import { createWorldEnvironment, worldClimate } from "../src/shared/script-world/world-environment";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

/**
 * ENV0 (trigger design §6.11): the world environment is a deterministic function of the script clock, the seed
 * and script actions; reads, catch-up and reloads cannot change it, `clockHour`/`hour`/`weatherIs` read it, and the
 * presentation follows it without writing back.
 */

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.97 };
const TICKS_PER_SECOND = 20;

const worldAt = (hour: number, extra: { cycling?: boolean; rain?: boolean; snow?: boolean } = {}) => {
  const world = huntingWorld();
  world.environmentDefaults = { cycling: true, hour, rain: false, snow: false, ...extra };
  return world;
};

describe("world clock", () => {
  it("round-trips hours and repeats after one cycle (72 min day, 16.5 min night)", () => {
    for (const hour of [0, 3.25, 6.5, 12, 19.5, 23.9]) {
      const reading = clockHourOf(clockSecondsOf({ day: 2, hour }));
      expect(reading.day).toBe(2);
      expect(reading.hour).toBeCloseTo(hour, 9);
      expect(clockHourOf(clockSecondsOf({ day: 0, hour }) + CYCLE_SECONDS).hour).toBeCloseTo(hour, 9);
    }
    expect(CYCLE_SECONDS).toBe(4320);
    const night = clockSecondsOf({ day: 1, hour: 6.5 }) - clockSecondsOf({ day: 0, hour: 19.5 });
    expect(night).toBeCloseTo(990, 9);
  });

  it("matches the presentation controller's cycling clock", () => {
    const controller = createEnvironmentController(SUN, { cycling: true, hour: 17, rain: false, snow: false });
    for (let tick = 0; tick < 600 * TICKS_PER_SECOND; tick++) controller.update(0.05);
    const closed = clockHourOf(clockSecondsOf({ day: 0, hour: 17 }) + 600);
    expect(controller.getControls().day).toBe(closed.day);
    expect(controller.getControls().hour).toBeCloseTo(closed.hour, 3);
  });
});

describe("world environment state machine", () => {
  it("gives the same state whether stepped every tick or once (catch-up shape), and after a reload", () => {
    const world = worldAt(18);
    const everyTick = createWorldEnvironment(world), once = createWorldEnvironment(world);
    let reloaded = createWorldEnvironment(world);
    const end = 3 * CYCLE_SECONDS * TICKS_PER_SECOND;
    for (let tick = 1; tick <= end; tick++) {
      everyTick.step(tick);
      reloaded.step(tick);
      if (tick % 50_000 === 0) reloaded = createWorldEnvironment(world, structuredClone(reloaded.save()));
    }
    once.step(end);
    expect(once.read(end)).toEqual(everyTick.read(end));
    expect(once.save()).toEqual(everyTick.save());
    expect(reloaded.save()).toEqual(everyTick.save());
    expect(everyTick.read(end).day).toBe(3);
  });

  it("reports each whole hour once, runs timeOfDay forward and applies the winter climate", () => {
    const environment = createWorldEnvironment(worldAt(11.9, { cycling: false }));
    expect(environment.step(1)).toEqual([]);
    environment.timeOfDay(1, 15);
    const reached: number[] = [];
    for (let tick = 2; tick < 200; tick++) reached.push(...environment.step(tick));
    expect(reached).toEqual([12, 13, 14, 15]);
    expect(environment.read(200).hour).toBeCloseTo(15, 9);
    environment.timeOfDay(200, 3);
    for (let tick = 201; tick < 400; tick++) reached.push(...environment.step(tick));
    expect(reached.slice(4)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3]);
    expect(environment.read(400).day).toBe(1);
    expect(environment.read(400).hour).toBeCloseTo(3, 9);

    const winter = worldAt(12);
    winter.expeditionTheme = "winter";
    expect(worldClimate(winter)).toBe("winter");
    const snowy = createWorldEnvironment(winter);
    snowy.setWeather(5, "rain", null);
    expect(snowy.read(5)).toMatchObject({ weather: "cloudy", weatherFade: { seconds: null, tick: 5 } });
    expect(snowy.season()).toBe("winter");
  });
});

const ENVIRONMENT_SCRIPT = (): MapScript => emptyScript({
  triggers: [
    trigger("t-start", { actions: [
      doStep("s1", "timeOfDay", { hour: num(15) }),
      doStep("s2", "setWeather", { state: str("snow"), transitionSeconds: num(2) })
    ] }),
    trigger("t-hour", {
      actions: [
        doStep("h1", "setVariable", { value: num(1), variable: ref("variable", "reached") }),
        doStep("h2", "setVariable", { value: { args: {}, fn: "hour", k: "fn" }, variable: ref("variable", "hourSeen") })
      ],
      conditions: { args: { weather: str("snow") }, k: "is", pred: "weatherIs" },
      events: [{ kind: "clockHour", player: { kind: "any" }, slots: { hour: num(15) } }]
    })
  ],
  variables: [numberVariable("reached", "reached"), numberVariable("hourSeen", "hour seen")]
});

const islandWith = (script?: MapScript) => {
  const world = worldAt(12);
  world.script = script;
  return createSettlementSimulation({ clockStart: 0, initialSettlers: 0, roads: createRoadNetwork(world), world });
};

const advanceSeconds = (simulation: SettlementSimulation, seconds: number) => {
  for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick++) simulation.update(0.05);
};

const valueOf = (simulation: SettlementSimulation, id: string) =>
  simulation.script()!.engine.state.values[id]?.value;

describe("world environment on a script island", () => {
  it("runs timeOfDay/setWeather actions, fires clockHour with weatherIs and reads hour, replay-identically", () => {
    const live = islandWith(ENVIRONMENT_SCRIPT());
    advanceSeconds(live, 2);
    const saved = live.saveState();
    expect(saved.scriptRun?.environment?.weather).toBe("snow");
    const reloaded = islandWith(ENVIRONMENT_SCRIPT());
    expect(reloaded.loadState(structuredClone(saved)).ok).toBe(true);
    advanceSeconds(live, 8);
    advanceSeconds(reloaded, 8);
    expect(valueOf(live, "reached")).toBe(1);
    expect(Math.floor(valueOf(live, "hourSeen") as number)).toBe(15);
    expect(reloaded.script()!.engine.hash()).toBe(live.script()!.engine.hash());
    expect(reloaded.saveState().scriptRun).toEqual(live.saveState().scriptRun);
  });

  it("freezes the world clock in catch-up and leaves islands without environment reads untouched", () => {
    const offline = islandWith(ENVIRONMENT_SCRIPT());
    advanceSeconds(offline, 1);
    const before = offline.script()!.environmentReading();
    offline.setScriptMode("catchUp");
    advanceSeconds(offline, 30);
    expect(offline.script()!.environmentReading()).toEqual(before);
    offline.endScriptCatchUp();
    advanceSeconds(offline, 1);
    expect(offline.script()!.environmentReading()!.hour).toBeGreaterThan(before!.hour);

    const plain = islandWith(emptyScript({ triggers: [trigger("t-none")] }));
    advanceSeconds(plain, 1);
    expect(plain.script()!.environment).toBeUndefined();
    expect(plain.saveState().scriptRun).not.toHaveProperty("environment");
  });

  it("drives the presentation controller, which never writes back", () => {
    const island = islandWith(ENVIRONMENT_SCRIPT());
    advanceSeconds(island, 10);
    const saved = JSON.stringify(island.saveState());
    const controller = createEnvironmentController(SUN, { hour: 6, mode: "sun", rain: true, snow: false });
    followWorldEnvironment(controller, island);
    controller.update(0.05);
    const reading = island.script()!.environmentReading(island.tickFraction())!;
    expect(controller.getControls()).toMatchObject({ hour: reading.hour, raining: false, snowing: true });
    controller.toggleRain();
    controller.setTime("night");
    followWorldEnvironment(controller, island);
    expect(controller.getControls().hour).toBe(reading.hour);
    expect(JSON.stringify(island.saveState())).toBe(saved);
  });
});
