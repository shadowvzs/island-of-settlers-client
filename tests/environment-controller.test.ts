import { describe, expect, it } from "vitest";

import {
  createEnvironmentController,
  type EnvironmentStart
} from "../src/app/environment-controller";
import {
  computeEnvironment,
  LUNAR_CYCLE_DAYS,
  moonPhaseForDay
} from "../src/render-common/environment";

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.97 };
const DRY: EnvironmentStart = {
  hour: 12,
  rain: false,
  snow: false
};

/** The environment after `seconds` of 0.1 s frames. */
const runFor = (controller: ReturnType<typeof createEnvironmentController>, seconds: number) => {
  let state = controller.update(0);
  for (let frame = 0; frame < seconds * 10; frame += 1) state = controller.update(0.1);
  return state;
};

describe("environment controller", () => {
  it("stays dry when a frame reports a negative delta", () => {
    const controller = createEnvironmentController(SUN, DRY);
    expect(controller.update(-6).rain).toBe(0);
    expect(controller.update(0.016).rain).toBe(0);
  });

  it("fades rain in towards its target and never above 1", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.toggleRain();
    const rain = Array.from({ length: 600 }, () => controller.update(0.1).rain).at(-1)!;
    expect(rain).toBe(1);
  });

  it("fades snow in smoothly, never with a negative step", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.toggleSnow();
    expect(controller.update(-6).snow).toBe(0);
    const early = controller.update(0.1).snow;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.1);
    expect(runFor(controller, 60).snow).toBe(1);
    controller.toggleSnow();
    expect(runFor(controller, 60).snow).toBe(0);
  });

  it("runs the day cycle faster at a time-lapse speed and starts the cycle", () => {
    const normal = createEnvironmentController(SUN, { ...DRY, cycling: true, hour: 12 });
    const fast = createEnvironmentController(SUN, { ...DRY, hour: 12 });
    fast.setCycleSpeed(60);
    expect(fast.getControls()).toMatchObject({ cycleSpeed: 60, cycling: true });
    normal.update(0.05);
    fast.update(0.05);
    const advanced = (controller: typeof fast) => controller.getControls().hour - 12;
    expect(advanced(fast)).toBeCloseTo(advanced(normal) * 60, 6);
  });

  it("turns the cycle and random weather on for nature, and clears to noon for sun", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, hour: 22, rain: true, snow: false });
    controller.setDayMode("nature");
    expect(controller.getControls()).toMatchObject({ cycling: true, mode: "nature", hour: 22 });
    controller.setDayMode("sun");
    expect(controller.getControls()).toMatchObject({
      cycling: false, hour: 12, mode: "sun", raining: false, snowing: false
    });
  });

  it("clears clouds more slowly than rain after a shower", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, rain: true, snow: false });
    controller.toggleRain();
    const state = runFor(controller, 1);
    expect(state.rain).toBeGreaterThan(.9);
    expect(state.cloudCover).toBeGreaterThan(.9);
  });

  it("adds random rain in nature mode and stops it again", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, hour: 12, mode: "nature", seed: 1 });
    runFor(controller, 500);
    expect(controller.getControls().raining).toBe(true);
    runFor(controller, 300);
    expect(controller.getControls().raining).toBe(false);
  });

  it("does not add random rain on a snowy island", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, hour: 12, mode: "nature", seed: 1 });
    controller.setSnowy(true);
    let sawSnow = false;
    for (let frame = 0; frame < 6000; frame++) {
      const state = controller.update(.1);
      sawSnow ||= state.snow > .01;
      expect(controller.getControls().raining).toBe(false);
    }
    expect(sawSnow).toBe(true);
  });

  it("replays the same seeded weather sequence and continues it after save/load", () => {
    const start = { ...DRY, hour: 12, mode: "nature" as const, seed: 42 };
    const first = createEnvironmentController(SUN, start);
    const second = createEnvironmentController(SUN, start);
    const sequence = (controller: ReturnType<typeof createEnvironmentController>) =>
      Array.from({ length: 4000 }, () => controller.update(.1)).map(state =>
        [state.rain.toFixed(4), state.snow.toFixed(4), state.cloudCover.toFixed(4)].join(":"));
    expect(sequence(first)).toEqual(sequence(second));
    const live = createEnvironmentController(SUN, start);
    runFor(live, 500);
    const saved = live.saveState();
    const loaded = createEnvironmentController(SUN, start);
    loaded.loadState(saved);
    expect(Array.from({ length: 4000 }, () => loaded.update(.1))).toEqual(
      Array.from({ length: 4000 }, () => live.update(.1)));
  });

  it("keeps sun mode permanently clear", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, hour: 12, mode: "sun", seed: 9 });
    for (let frame = 0; frame < 20_000; frame++) {
      const state = controller.update(.1);
      expect(state.rain).toBe(0);
      expect(state.snow).toBe(0);
    }
  });

  it("runs a full day in 72 real minutes and lets night pass in half of its dark span", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, cycling: true, hour: 12 });
    runFor(controller, 72 * 60);
    expect(controller.getControls().hour).toBeCloseTo(12, 1);

    const night = createEnvironmentController(SUN, { ...DRY, cycling: true, hour: 19.5 });
    runFor(night, 16.5 * 60);
    expect(night.getControls().hour).toBeCloseTo(6.5, 1);
  });

  it("advances an in-game day counter and a realistic synodic moon phase", () => {
    expect(moonPhaseForDay(0)).toBeCloseTo(0.5, 6);
    expect(moonPhaseForDay(LUNAR_CYCLE_DAYS / 4)).toBeCloseTo(0.75, 6);
    expect(moonPhaseForDay(LUNAR_CYCLE_DAYS / 2)).toBeCloseTo(0, 6);
    const controller = createEnvironmentController(SUN, { ...DRY, cycling: true, hour: 23.99 });
    const state = runFor(controller, 60);
    expect(controller.getControls()).toMatchObject({ cycling: true, day: 1 });
    expect(controller.getControls().hour).toBeLessThan(1);
    expect(state.moonPhase).toBeCloseTo(moonPhaseForDay(1, controller.getControls().hour), 6);
  });

  it("moves sunset shadows no faster than the rest of the day allows", () => {
    const angle = (sun: { azimuthX: number; azimuthZ: number }) => Math.atan2(sun.azimuthZ, sun.azimuthX);
    let previous = computeEnvironment(SUN, 0, 0).sun;
    let fastest = 0;
    for (let hour = .05; hour <= 24; hour += .05) {
      const sun = computeEnvironment(SUN, hour, 0).sun;
      let delta = angle(sun) - angle(previous);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      fastest = Math.max(fastest, Math.abs(delta / .05) * 180 / Math.PI);
      previous = sun;
    }
    // The old fixed moon direction snapped roughly 150 degrees between 17.5 and 18.5.
    expect(fastest).toBeLessThan(25);
  });

  it("keeps rain and snow exclusive: one switches the other off", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.toggleRain();
    expect(runFor(controller, 60).rain).toBe(1);
    controller.toggleSnow();
    expect(controller.getControls()).toMatchObject({ raining: false, snowing: true });
    const state = runFor(controller, 60);
    expect(state.rain).toBe(0);
    expect(state.snow).toBe(1);
    controller.toggleRain();
    expect(controller.getControls()).toMatchObject({ raining: true, snowing: false });
    const start = createEnvironmentController(SUN, { ...DRY, rain: true, snow: true });
    expect(start.update(0)).toMatchObject({ rain: 0, snow: 1 });
  });
});
