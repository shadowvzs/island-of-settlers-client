import { describe, expect, it } from "vitest";

import { createEnvironmentController, type EnvironmentStart } from "../src/app/environment-controller";
import { HOUR_TRANSITION_MAX_SECONDS, HOUR_TRANSITION_MIN_SECONDS } from "../src/shared/environment/constants";
import { forwardHours, hourTransitionSeconds } from "../src/shared/environment/environment-transitions";

const SUN = { azimuthX: -0.94, azimuthZ: -0.34, elevation: 0.97 };
const DRY: EnvironmentStart = { hour: 12, rain: false, snow: false };
const FRAME = 0.1;

type Controller = ReturnType<typeof createEnvironmentController>;

const runFor = (controller: Controller, seconds: number) => {
  let state = controller.update(0);
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) state = controller.update(FRAME);
  return state;
};

describe("environment setWeather (CIN6)", () => {
  it("fades clear to rain over exactly the authored time, linearly", () => {
    const controller = createEnvironmentController(SUN, DRY);
    const startCloud = controller.update(0).cloudCover;
    controller.setWeather("rain", 4);
    expect(runFor(controller, 2).rain).toBeCloseTo(0.5, 5);
    const end = runFor(controller, 2);
    expect(end.rain).toBe(1);
    expect(end.cloudCover).toBeGreaterThan(startCloud);
    expect(controller.getControls().raining).toBe(true);
  });

  it("snaps with a zero fade (a skipped sequence's end state)", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.setWeather("storm", 3);
    runFor(controller, 1);
    controller.setWeather("storm", 0);
    expect(controller.update(0).rain).toBe(1);
  });

  it("fades rain back out to a clear sky", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, rain: true });
    controller.setWeather("clear", 2);
    expect(runFor(controller, 2).rain).toBe(0);
  });

  it("keeps the season rule: no rain states on a winter island, snow stays allowed", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.setSnowy(true);
    controller.setWeather("storm", 0);
    expect(controller.update(0).rain).toBe(0);
    expect(controller.saveState().weatherState).toBe("cloudy");
    controller.setWeather("snow", 0);
    expect(controller.update(0).snow).toBe(1);
  });

  it("is cancelled by a manual weather toggle (the natural fade takes over)", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.setWeather("rain", 100);
    runFor(controller, 1);
    controller.toggleRain();
    const rain = controller.update(FRAME).rain;
    expect(rain).toBeLessThan(0.01 + 1e-9);
  });
});

describe("environment hour transition (CIN6)", () => {
  it("runs forward only, 3 to 6 s by distance", () => {
    expect(forwardHours(18, 6)).toBe(12);
    expect(forwardHours(6, 18)).toBe(12);
    expect(forwardHours(10, 10)).toBe(0);
    expect(hourTransitionSeconds(0)).toBe(HOUR_TRANSITION_MIN_SECONDS);
    expect(hourTransitionSeconds(24)).toBe(HOUR_TRANSITION_MAX_SECONDS);
  });

  it("reaches the hour over the default time and never moves backwards", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.transitionToHour(18.5);
    const seconds = hourTransitionSeconds(6.5);
    let previous = controller.getControls().hour;
    for (let frame = 0; frame < Math.ceil(seconds / FRAME); frame++) {
      controller.update(FRAME);
      const { hour } = controller.getControls();
      expect(hour).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = hour;
    }
    expect(controller.getControls().hour).toBeCloseTo(18.5, 6);
    runFor(controller, 1);
    expect(controller.getControls().hour).toBeCloseTo(18.5, 6);
  });

  it("passes midnight forward and counts the day", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, hour: 20 });
    controller.transitionToHour(6, 0);
    expect(controller.getControls()).toMatchObject({ day: 1, hour: 6 });
  });

  it("jumps to the end when skipped mid-transition and saves the final hour", () => {
    const controller = createEnvironmentController(SUN, DRY);
    controller.transitionToHour(17, 5);
    runFor(controller, 1);
    expect(controller.saveState().hour).toBeCloseTo(17, 6);
    controller.transitionToHour(17, 0);
    expect(controller.getControls()).toMatchObject({ day: 0, hour: 17 });
  });

  it("lets a cycling clock carry on from the new hour", () => {
    const controller = createEnvironmentController(SUN, { ...DRY, cycling: true });
    controller.transitionToHour(16, 3);
    runFor(controller, 3);
    const reached = controller.getControls().hour;
    expect(reached).toBeCloseTo(16, 1);
    runFor(controller, 5);
    expect(controller.getControls().hour).toBeGreaterThan(reached);
    expect(controller.getControls().cycling).toBe(true);
  });
});
