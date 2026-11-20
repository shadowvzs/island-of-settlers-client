import { afterEach, describe, expect, it } from "vitest";

import { INVALID_FACTION_AI_SAVE } from "../src/shared/settlement/economy-ai/constants";
import { createFactionAi } from "../src/shared/settlement/economy-ai/faction-ai";
import { setFactionAiProbe } from "../src/shared/settlement/economy-ai/faction-ai-probe";
import { factionAiSaveError } from "../src/shared/settlement/economy-ai/faction-ai-save-validation";
import type { FactionAiLayer } from "../src/shared/settlement/economy-ai/faction-ai-types";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { computerEconomies, hasEconomy } from "../src/shared/settlement/settlement-ownership";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { createFactionAiFixture, type FactionAiFixtureMode } from "../tools/bench/faction-ai-fixture";

const MODULES = { createMapScenario, createRoadNetwork, createSettlementSimulation };
const FACTIONS = [1, 2, 3, 4];
const SAVE_FACTIONS = { allowed: FACTIONS, cells: 64 * 64, required: FACTIONS };
const TICKS = 800;
const STRATEGIC = 0;
const LAYER_PERIODS = [["strategic", 200], ["planner", 40], ["economy", 20], ["military", 60]] as const;

type Fixture = ReturnType<typeof createFactionAiFixture>;
interface Decision { faction: number; layer: FactionAiLayer; tick: number }

const fixture = (mode: FactionAiFixtureMode = "maintain") => createFactionAiFixture(MODULES, mode);

/** The settlement state without the frame remainder (`accumulator`), the one field a frame rate may change. */
const stateHash = ({ simulation }: Fixture) => hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

/** Frames of `frames` seconds (cycled, clipped at the end) until the island's game clock reached tick `ticks`. */
const run = ({ simulation }: Fixture, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
  expect(simulation.gameTick()).toBe(ticks);
};

/** Every decision taken while `body` runs. */
const recordDecisions = (body: () => void) => {
  const decisions: Decision[] = [];
  setFactionAiProbe({ decide: (faction, layer, tick) => decisions.push({ faction, layer, tick }) });
  body();
  setFactionAiProbe(null);
  return decisions;
};

afterEach(() => {
  setFactionAiProbe(null);
  setVisionProbe(null);
});

describe("faction AI skeleton (EAI2a)", () => {
  it("keeps a map without AI as it was: no state, no saved field, no decision", () => {
    const island = fixture("none");
    const decisions = recordDecisions(() => run(island, [.05], TICKS));
    expect(decisions).toEqual([]);
    expect(island.simulation.factionAiDiagnostics()).toEqual([]);
    expect("factionAi" in island.simulation.saveState()).toBe(false);
    expect(computerEconomies({ options: { world: island.world } })).toEqual([]);
  });

  it("gives every AI faction of the map an economy and one state, factions ascending", () => {
    const { simulation, world } = fixture();
    expect(computerEconomies({ options: { world } })).toEqual(FACTIONS);
    expect(hasEconomy({ options: { world } }, 2)).toBe(true);
    expect(hasEconomy({ options: { world } }, 5)).toBe(false);
    expect(simulation.factionAiDiagnostics().map(({ faction, mode }) => ({ faction, mode })))
      .toEqual(FACTIONS.map(faction => ({ faction, mode: "maintain" })));
    expect(simulation.saveState().factionAi?.map(entry => entry.faction)).toEqual(FACTIONS);
  });

  it("decides each layer on its own cadence, staggered so no two factions share a layer's tick", () => {
    const island = fixture();
    const decisions = recordDecisions(() => run(island, [.05], TICKS));
    const ticksOf = new Map<string, number[]>(), slots = new Set<string>();
    for (const { faction, layer, tick } of decisions) {
      const slot = `${layer}@${tick}`;
      expect(slots.has(slot), slot).toBe(false);
      slots.add(slot);
      const key = `${faction}:${layer}`;
      ticksOf.set(key, [...ticksOf.get(key) ?? [], tick]);
    }
    // Strategic every 200 ticks, planner 40, economy 20, military 60 (plan §3.3), from a slot in the first period.
    for (const faction of FACTIONS) for (const [layer, period] of LAYER_PERIODS) {
      const ticks = ticksOf.get(`${faction}:${layer}`)!;
      expect(ticks[0]).toBeLessThanOrEqual(period);
      expect(ticks.slice(1).every((tick, index) => tick - (ticks[index] ?? 0) === period)).toBe(true);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(TICKS - period);
    }
  });

  it("decides the same and ends on the same state at every frame rate", () => {
    const steady = fixture(), uneven = fixture(), sixty = fixture();
    const steadyLog = recordDecisions(() => run(steady, [.05], TICKS));
    const unevenLog = recordDecisions(() => run(uneven, [.1, .05, .2, .05], TICKS));
    const sixtyLog = recordDecisions(() => run(sixty, [1 / 60], TICKS));
    expect(unevenLog).toEqual(steadyLog);
    expect(sixtyLog).toEqual(steadyLog);
    expect(stateHash(uneven)).toBe(stateHash(steady));
    expect(stateHash(sixty)).toBe(stateHash(steady));
  });

  it("continues identically after a save and reload one tick before a decision", () => {
    const live = fixture();
    run(live, [.05], 300);
    const due = live.simulation.factionAiDiagnostics()[0]!.due[STRATEGIC]!;
    run(live, [.05], due - 1);
    const restored = fixture();
    expect(restored.simulation.loadState(structuredClone(live.simulation.saveState()))).toEqual({ ok: true });
    expect(stateHash(restored)).toBe(stateHash(live));
    const liveLog = recordDecisions(() => run(live, [.05], due + 400));
    const restoredLog = recordDecisions(() => run(restored, [.05], due + 400));
    expect(restoredLog).toEqual(liveLog);
    expect(liveLog.some(({ layer, tick }) => layer === "strategic" && tick === due)).toBe(true);
    expect(stateHash(restored)).toBe(stateHash(live));
  });

  it("reads enemies only through the faction's knowledge (A13 probe: no unseen read)", () => {
    setVisionProbe("latest");
    const island = fixture();
    run(island, [.05], 1200);
    const report = visionProbeReport();
    const economyAi = report.filter(site => site.site.startsWith("economyAi."));
    expect(economyAi.reduce((sum, site) => sum + site.reads, 0)).toBeGreaterThan(0);
    expect(report.reduce((sum, site) => sum + site.unseen, 0)).toBe(0);
    expect(island.simulation.factionAiDiagnostics().some(entry => entry.threat.soldiers > 0)).toBe(true);
  });

  it("lets scripts change mode, style, level and pause; refuses factions and values the map does not allow", () => {
    const island = fixture();
    // The controls of the island's map, on a context of its own (EAI2c reaches them through the script host).
    const controls = createFactionAi({ clock: { tick: () => 0 }, options: { world: island.world } } as
      unknown as SettlementContext);
    expect(controls.setMode(1, "develop")).toBe(true);
    expect(controls.setStyle(1, "turtle")).toBe(true);
    expect(controls.setLevel(1, "hard")).toBe(true);
    expect(controls.setPaused(2, true)).toBe(true);
    expect(controls.setMode(3, "none")).toBe(true);
    expect(controls.setMode(5, "maintain")).toBe(false);
    expect(controls.setMode(1, "conquer")).toBe(false);
    expect(controls.setStyle(1, "reckless")).toBe(false);
    expect(controls.setLevel(1, "impossible")).toBe(false);
    expect(controls.setPaused(2, "yes")).toBe(false);
    const changed = { ...island.simulation.saveState(), factionAi: controls.save() };
    expect(island.simulation.loadState(changed)).toEqual({ ok: true });
    const decisions = recordDecisions(() => run(island, [.05], TICKS));
    expect(decisions.some(({ faction }) => faction === 2 || faction === 3)).toBe(false);
    expect(decisions.some(({ faction }) => faction === 1)).toBe(true);
    const saved = island.simulation.saveState();
    expect(saved.factionAi?.slice(0, 3)).toEqual([
      {
        develop: expect.objectContaining({ discovered: expect.objectContaining({ length: 4096 }) }),
        // It knows the island's enemy soldiers, so its own strategy states intents (EAI4b).
        due: expect.any(Array), faction: 1, level: "hard", mode: "develop", strategy: { stated: true },
        style: "turtle"
      },
      { due: expect.any(Array), faction: 2, mode: "maintain", paused: true },
      { due: expect.any(Array), faction: 3, mode: "none" }
    ]);
    const restored = fixture();
    expect(restored.simulation.loadState(structuredClone(saved))).toEqual({ ok: true });
    expect(restored.simulation.saveState().factionAi).toEqual(saved.factionAi);
  });

  it("gives a faction that only owns authored objects a state when a script wakes it, and saves only that one", () => {
    const island = fixture("none");
    const controls = createFactionAi({ clock: { tick: () => 0 }, options: { world: island.world } } as
      unknown as SettlementContext);
    expect(controls.save()).toBeUndefined();
    expect(controls.setting(2)).toEqual({ level: undefined, mode: "none", paused: false, style: undefined });
    expect(controls.setMode(2, "maintain")).toBe(true);
    expect(controls.setMode(7, "maintain")).toBe(false);
    expect(controls.save()?.map(entry => entry.faction)).toEqual([2]);
    expect(island.simulation.loadState({ ...island.simulation.saveState(), factionAi: controls.save() }))
      .toEqual({ ok: true });
    const decisions = recordDecisions(() => run(island, [.05], TICKS));
    expect(new Set(decisions.map(({ faction }) => faction))).toEqual(new Set([2]));
    expect(island.simulation.saveState().factionAi?.map(({ faction, mode }) => ({ faction, mode })))
      .toEqual([{ faction: 2, mode: "maintain" }]);
  });

  it("validates the saved state and starts a save without it (format 16) from the map", () => {
    const island = fixture();
    run(island, [.05], 100);
    const saved = island.simulation.saveState();
    const entries = saved.factionAi!;
    expect(factionAiSaveError(entries, SAVE_FACTIONS)).toBeNull();
    expect(factionAiSaveError(undefined, SAVE_FACTIONS)).toBeNull();
    expect(factionAiSaveError(entries.slice(1), SAVE_FACTIONS)).toBe(INVALID_FACTION_AI_SAVE);
    expect(factionAiSaveError([...entries].reverse(), SAVE_FACTIONS)).toBe(INVALID_FACTION_AI_SAVE);
    expect(factionAiSaveError([{ ...entries[0]!, due: [1, 2] }, ...entries.slice(1)], SAVE_FACTIONS))
      .toBe(INVALID_FACTION_AI_SAVE);
    expect(factionAiSaveError([{ ...entries[0]!, mood: "calm" }, ...entries.slice(1)], SAVE_FACTIONS))
      .toBe(INVALID_FACTION_AI_SAVE);
    expect(factionAiSaveError([{ ...entries[0]!, paused: false }, ...entries.slice(1)], SAVE_FACTIONS))
      .toBe(INVALID_FACTION_AI_SAVE);
    const restored = fixture();
    expect(restored.simulation.loadState({ ...saved, factionAi: [{ ...entries[0]!, faction: 9 }] }))
      .toEqual({ ok: false, reason: INVALID_FACTION_AI_SAVE });
    const { factionAi: _absent, ...older } = saved;
    expect(restored.simulation.loadState(structuredClone(older))).toEqual({ ok: true });
    const fresh = restored.simulation.factionAiDiagnostics();
    expect(fresh.map(entry => entry.mode)).toEqual(FACTIONS.map(() => "maintain"));
    expect(fresh.every(entry => entry.due.every(tick => tick > 100))).toBe(true);
  });
});
