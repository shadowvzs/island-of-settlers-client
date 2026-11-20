import { describe, expect, it, vi } from "vitest";

import {
  connectIslandDisturbance,
  FELLING_SCARE_RADIUS,
  FLEE_SCARE_RADIUS,
  KILL_SCARE_RADIUS
} from "../src/app/island-disturbance";
import type { WorldData } from "../src/shared/world/world-data";

const createTargets = () => {
  let fleeListener: ((x: number, z: number) => void) | null = null;
  let killListener: ((x: number, z: number) => void) | null = null;
  let critterKillListener: ((x: number, z: number) => void) | null = null;
  const world = {
    blocking: new Uint8Array(64 * 64),
    cellsX: 64,
    cellsZ: 64,
    props: { x: new Float32Array([3, 40]), z: new Float32Array([5, 60]) }
  } as unknown as WorldData;
  return {
    animals: {
      onAnimalFled: (listener: (x: number, z: number) => void) => {
        fleeListener = listener;
      },
      onAnimalKilled: (listener: (x: number, z: number) => void) => {
        killListener = listener;
      },
      onTreeFelled: vi.fn()
    },
    birds: { scare: vi.fn() },
    critters: {
      onCritterKilled: (listener: (x: number, z: number) => void) => {
        critterKillListener = listener;
      },
      scare: vi.fn()
    },
    flee: (x: number, z: number) => fleeListener?.(x, z),
    kill: (x: number, z: number) => killListener?.(x, z),
    killCritter: (x: number, z: number) => critterKillListener?.(x, z),
    sound: { onTreeFelled: vi.fn() },
    world
  };
};

describe("island disturbance hooks", () => {
  it("scatters birds and critters around a felled tree, alarms animals, silences leaves", () => {
    const targets = createTargets();
    const onFelled = connectIslandDisturbance(targets);
    onFelled(1);
    expect(targets.birds.scare).toHaveBeenCalledWith(40, 60, FELLING_SCARE_RADIUS);
    expect(targets.critters.scare).toHaveBeenCalledWith(40, 60, FELLING_SCARE_RADIUS);
    expect(targets.animals.onTreeFelled).toHaveBeenCalledWith(1);
    expect(targets.sound.onTreeFelled).toHaveBeenCalledWith(1);
  });

  it("flushes the birds and critters near an animal breaking into flight", () => {
    const targets = createTargets();
    connectIslandDisturbance(targets);
    targets.flee(12, 8);
    expect(targets.birds.scare).toHaveBeenCalledWith(12, 8, FLEE_SCARE_RADIUS);
    expect(targets.critters.scare).toHaveBeenCalledWith(12, 8, FLEE_SCARE_RADIUS);
  });

  it("scatters the birds around a kill", () => {
    const targets = createTargets();
    connectIslandDisturbance(targets);
    targets.kill(20, 30);
    expect(targets.birds.scare).toHaveBeenCalledWith(20, 30, KILL_SCARE_RADIUS);
  });

  it("scatters the birds around a killed food critter (boar, chamois)", () => {
    const targets = createTargets();
    connectIslandDisturbance(targets);
    targets.killCritter(44, 12);
    expect(targets.birds.scare).toHaveBeenCalledWith(44, 12, KILL_SCARE_RADIUS);
    expect(targets.critters.scare).not.toHaveBeenCalled();
  });
});
