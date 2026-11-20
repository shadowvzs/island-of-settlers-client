import { describe, expect, it, vi } from "vitest";

import { explorationThunderPosition } from "../src/app/audio/exploration-weather";
import {
  createExplorationLightningModel,
  type ExplorationLightningFrame
} from "../src/renderers/three/exploration-weather";

const camera = { cameraX: 20, cameraY: 3, cameraZ: 8, rain: 1, yaw: 0.4 };

const step = (model: ReturnType<typeof createExplorationLightningModel>, time: number,
  delta = 0.1): ExplorationLightningFrame =>
  model.update({ ...camera, deltaSeconds: delta, timeSeconds: time });

describe("exploration lightning presentation", () => {
  it("schedules bounded strikes and keeps one event per flash", () => {
    const model = createExplorationLightningModel({
      maxIntervalSeconds: 22, minIntervalSeconds: 8, seed: 5
    });
    const strikeTimes: number[] = [];
    let event: ExplorationLightningFrame | null = null;
    for (let time = 0; time <= 120; time += 0.1) {
      const frame = step(model, time);
      if (frame.strike) {
        strikeTimes.push(time);
        event = { ...frame, strike: { ...frame.strike } };
      }
    }
    expect(strikeTimes.length).toBeGreaterThanOrEqual(3);
    expect(strikeTimes[0]).toBeGreaterThanOrEqual(3);
    expect(strikeTimes[0]).toBeLessThanOrEqual(22.2);
    for (let index = 1; index < strikeTimes.length; index++) {
      const interval = strikeTimes[index]! - strikeTimes[index - 1]!;
      expect(interval).toBeGreaterThanOrEqual(7.9);
      expect(interval).toBeLessThanOrEqual(22.2);
    }
    expect(event?.strike).not.toBeNull();
    expect(event!.strike!.distance).toBeGreaterThanOrEqual(16);
    expect(event!.strike!.distance).toBeLessThanOrEqual(36);
    expect(event!.strike!.y).toBeGreaterThanOrEqual(camera.cameraY + 22);
    expect(event!.strike!.y).toBeLessThanOrEqual(camera.cameraY + 34);
    expect(event!.flash).toBeGreaterThan(0.9);
    expect(event!.cloudFlash).toBeGreaterThan(0);
    expect(event!.worldLight).toBeGreaterThan(0);
  });

  it("decays the flash and exposes the event only on its strike update", () => {
    const model = createExplorationLightningModel({ seed: 7 });
    let strikeTime = -1;
    for (let time = 0; time <= 30; time += 0.1) {
      const frame = step(model, time);
      if (frame.strike) {
        strikeTime = time;
        break;
      }
    }
    expect(strikeTime).toBeGreaterThanOrEqual(0);
    const after = step(model, strikeTime + 0.2);
    expect(after.strike).toBeNull();
    expect(after.flash).toBeGreaterThan(0);
    const gone = step(model, strikeTime + 1, 1);
    expect(gone.flash).toBe(0);
    expect(gone.cloudFlash).toBe(0);
    expect(gone.worldLight).toBe(0);
  });

  it("reduces flash, cloud and world light without dropping the paired strike", () => {
    const normal = createExplorationLightningModel({ seed: 13 });
    const reduced = createExplorationLightningModel({ reducedFlash: true, seed: 13 });
    let normalStrike: ExplorationLightningFrame | null = null;
    let reducedStrike: ExplorationLightningFrame | null = null;
    for (let time = 0; time <= 30 && (!normalStrike || !reducedStrike); time += 0.1) {
      const a = step(normal, time);
      const b = step(reduced, time);
      if (a.strike) normalStrike = { ...a, strike: { ...a.strike } };
      if (b.strike) reducedStrike = { ...b, strike: { ...b.strike } };
    }
    expect(normalStrike?.strike).not.toBeNull();
    expect(reducedStrike?.strike).not.toBeNull();
    expect(normalStrike!.flash).toBeGreaterThan(0.9);
    expect(reducedStrike!.flash).toBeLessThanOrEqual(0.28);
    expect(reducedStrike!.cloudFlash).toBeLessThan(normalStrike!.cloudFlash);
    expect(reducedStrike!.worldLight).toBeLessThan(normalStrike!.worldLight);
    expect(reducedStrike!.strike!.intensity).toBeLessThan(1);
  });

  it("derives a positional thunder delay and pan from the strike", () => {
    const right = explorationThunderPosition(10, 0, 0);
    const left = explorationThunderPosition(-10, 0, 0);
    const distant = explorationThunderPosition(0, 100, 0);
    expect(right.pan).toBeCloseTo(1);
    expect(left.pan).toBeCloseTo(-1);
    expect(distant.delaySeconds).toBeGreaterThan(right.delaySeconds);
    expect(distant.delaySeconds).toBeLessThanOrEqual(0.45);
    expect(explorationThunderPosition(0, 0, 0).pan).toBe(0);
  });

  it("never calls Math.random and stays inert without rain", () => {
    const random = vi.spyOn(Math, "random");
    const model = createExplorationLightningModel({ seed: 3 });
    for (let time = 0; time <= 30; time += 0.1) {
      const frame = model.update({
        ...camera, deltaSeconds: 0.1, rain: 0.1, timeSeconds: time
      });
      expect(frame.strike).toBeNull();
      expect(frame.flash).toBe(0);
    }
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
