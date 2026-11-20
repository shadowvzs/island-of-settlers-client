import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashNumbers, hashText } from "../src/shared/settlement/settlement-state-hash";
import { FOG, type WorldData } from "../src/shared/world/world-data";
import {
  createBalanceSimulation, forceTroops, spawnAround, typicalForce
} from "../tools/bench/garrison-balance-harness";

/**
 * A13: the vision layer follows simulation state only; phase 2 writes the player's fog from it in the tick,
 * so the fog is the same for every frame rate and a loaded save rebuilds it.
 */
const SIZE = 64;
const TICKS = 400;
const CAMP_A = { x: 18, z: 32 };
const CAMP_B = { x: 46, z: 32 };

interface Battle { simulation: SettlementSimulation; world: WorldData }

/** A balance world with a hidden fog layer (it has none of its own), so the player's fog is observable. */
const foggedSimulation = (size: number) => {
  let world: WorldData | undefined;
  const simulation = createBalanceSimulation(size, 5, { x: 6.5, z: 6.5 }, shaped => {
    shaped.fog = new Uint8Array(size * size).fill(FOG.hidden);
    world = shaped;
  });
  return { simulation, world: world! };
};

const battle = (): Battle => {
  const { simulation, world } = foggedSimulation(SIZE);
  const raise = (camp: { x: number; z: number }, faction: number) =>
    (["shield", "heavy", "archer", "shield", "archer", "heavy"] as const)
      .map(type => spawnAround(simulation, camp, type, 0, faction));
  const first = raise(CAMP_A, 1), second = raise(CAMP_B, 2);
  simulation.commandMilitaryOpponent(first, CAMP_B, 1, "attackMove");
  simulation.commandMilitaryOpponent(second, CAMP_A, 2, "attackMove");
  return { simulation, world };
};

/** Player troops march out of the headquarters' territory (radius 48) into hidden land, exploring a trail. */
const PATROL_TICKS = 1000;
const patrol = (): Battle => {
  const fogged = foggedSimulation(96);
  fogged.simulation.receiveTroops(forceTroops(typicalForce(2)));
  fogged.simulation.callOutMilitary(["shield", "heavy", "archer"], { x: 88, z: 88 });
  return fogged;
};

/** Fixed-step frames of `seconds` (exact multiples of the tick) until `ticks` ran. */
const run = ({ simulation }: Battle, frames: readonly number[], ticks = TICKS) => {
  for (let frame = 0; simulation.tickCount() < ticks; frame++) {
    const dt = frames[frame % frames.length]!;
    simulation.update(Math.min(dt, (ticks - simulation.tickCount()) * .05));
  }
  expect(simulation.tickCount()).toBe(ticks);
};

/**
 * The settlement part of the state hash (the flat balance world has no ore layer to mix), without the
 * frame remainder (`accumulator`), the one field a frame rate may change.
 */
const stateHash = ({ simulation }: Battle) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

const visionDigest = ({ simulation }: Battle) => {
  const vision = simulation.factionVision();
  return vision.factions().map(faction => `${faction}:${hashNumbers(Array.from(vision.layer(faction)!))}`);
};

const fogDigest = ({ world }: Battle) => hashNumbers(Array.from(world.fog));
const fogCount = ({ world }: Battle, value: number) => world.fog.reduce((sum, cell) => sum + Number(cell === value), 0);

afterEach(() => { setVisionProbe(null); });

describe("faction vision in the simulation", () => {
  it("gives the same layer and state for every frame rate", () => {
    const steady = battle(), uneven = battle(), sixty = battle();
    run(steady, [.05]);
    run(uneven, [.1, .05, .2, .05]);
    run(sixty, [1 / 60]);
    expect(visionDigest(uneven)).toEqual(visionDigest(steady));
    expect(visionDigest(sixty)).toEqual(visionDigest(steady));
    expect(visionDigest(steady).length).toBeGreaterThanOrEqual(3);
    expect(stateHash(uneven)).toBe(stateHash(steady));
    expect(stateHash(sixty)).toBe(stateHash(steady));
  });

  it("explores the same fog for every frame rate", () => {
    const steady = patrol(), uneven = patrol(), sixty = patrol();
    run(steady, [.05], PATROL_TICKS);
    run(uneven, [.1, .05, .2, .05], PATROL_TICKS);
    run(sixty, [1 / 60], PATROL_TICKS);
    expect(fogDigest(uneven)).toBe(fogDigest(steady));
    expect(fogDigest(sixty)).toBe(fogDigest(steady));
    expect(stateHash(uneven)).toBe(stateHash(steady));
    expect(stateHash(sixty)).toBe(stateHash(steady));
    // The patrol explored a trail beyond its live sight; the far corner stays hidden.
    expect(fogCount(steady, FOG.discovered)).toBeGreaterThan(0);
    expect(fogCount(steady, FOG.visible)).toBeGreaterThan(0);
    expect(fogCount(steady, FOG.hidden)).toBeGreaterThan(0);
  });

  it("rebuilds the same fog from a loaded save and keeps it equal afterwards", () => {
    const live = patrol();
    run(live, [.05], 700);
    const restored = patrol();
    // A load reads the saved fog back with live sight as discovered (game-save.ts applySavedProgress).
    restored.world.fog.set(live.world.fog.map(value => Math.min(value, FOG.discovered)));
    expect(restored.simulation.loadState(structuredClone(live.simulation.saveState())).ok).toBe(true);
    expect(visionDigest(restored)).toEqual(visionDigest(live));
    expect(fogDigest(restored)).toBe(fogDigest(live));
    run(live, [.05], 900);
    run(restored, [.05], 200);
    expect(visionDigest(restored)).toEqual(visionDigest(live));
    expect(fogDigest(restored)).toBe(fogDigest(live));
  });

  it("rebuilds the same layer from a loaded save", () => {
    const live = patrol();
    run(live, [.05], 700);
    const restored = patrol();
    expect(restored.simulation.loadState(structuredClone(live.simulation.saveState())).ok).toBe(true);
    expect(visionDigest(restored)).toEqual(visionDigest(live));
    run(live, [.05], 900);
    run(restored, [.05], 200);
    expect(visionDigest(restored)).toEqual(visionDigest(live));
  });

  it("probes AI reads without changing the outcome", () => {
    const plain = battle(), probed = battle();
    run(plain, [.05]);
    setVisionProbe((faction, x, z) => probed.simulation.factionVision().sees(faction, x, z));
    run(probed, [.05]);
    const report = visionProbeReport();
    expect(stateHash(probed)).toBe(stateHash(plain));
    expect(report.length).toBeGreaterThan(0);
    expect(report.every(site => site.location.includes(".ts:"))).toBe(true);
  });

  it("reads no renderer, camera or quality state", () => {
    for (const file of ["faction-vision.ts", "faction-vision-sight.ts", "faction-vision-probe.ts", "player-fog.ts",
      "settlement-vision.ts"]) {
      const source = readFileSync(resolve(__dirname, "../src/shared/settlement", file), "utf8");
      expect(source).not.toMatch(/from "[^"]*(renderers|render-common\/workers|app)\//);
      expect(source).not.toMatch(/performance\.now|Date\.now|Math\.random/);
    }
  });
});
