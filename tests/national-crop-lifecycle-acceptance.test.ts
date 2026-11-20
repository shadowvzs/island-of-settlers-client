import { expect, it } from "vitest";

import { getNationalDrinkPlantStage } from "../src/render-common/props/drink-crops/national-drink-plants";
import { NATION_DRINK_CHAINS } from "../src/shared/settlement/nation-drinks";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

const NATIONS = ["chinese", "persian", "maya", "indigenous"] as const;

it.each(NATIONS)("%s worker grows, harvests, carries and stores its actual crop across saves", nation => {
  const { simulation } = workshopUpgradeFixture(5, { shovel: 1, water: 8 });
  expect(simulation.setPlayerNation(nation)).toBe(true);
  const chain = NATION_DRINK_CHAINS[nation];
  const observed = new Set<string>();
  const restored = new Set<string>();

  for (let tick = 0; tick < 24_000; tick++) {
    simulation.update(.05);
    for (const site of simulation.fieldFrames()) {
      expect(site.kind).toBe(chain.plantation);
      observed.add(site.state);
      observed.add(`mesh:${getNationalDrinkPlantStage(site)}`);
    }
    let carrying = false;
    for (const actor of simulation.frames()) {
      if (actor.fieldWork === "harvest") observed.add("harvest-worker");
      if (actor.ware === chain.raw) {
        carrying = true;
        observed.add(`carry:${actor.phase}`);
      }
    }
    if (simulation.buildings().some(building => (building.output[chain.raw] ?? 0) > 0)) observed.add("output");
    if ((simulation.headquarters.inventory[chain.raw] ?? 0) > 0) observed.add("inventory");

    if (carrying) observed.add("carrying");
    const checkpoint = ["growing", "ripe", "stubble", "carrying"].find(state =>
      observed.has(state) && !restored.has(state));
    if (checkpoint) {
      const total = simulation.resourceTotal(chain.raw);
      const saved = structuredClone(simulation.saveState());
      expect(simulation.loadState(saved)).toEqual({ ok: true });
      expect(simulation.resourceTotal(chain.raw)).toBe(total);
      expect(simulation.fieldFrames().map(site => [site.kind, site.state, site.step]))
        .toEqual(saved.fields!.map(site => [site.kind, site.state, site.step]));
      restored.add(checkpoint);
    }
    if (observed.has("inventory") && restored.has("stubble")) break;
  }

  for (const state of ["growing", "ripe", "stubble", "harvest-worker", "output", "inventory"])
    expect(observed.has(state), `${nation}: missing ${state}; saw ${[...observed].join(", ")}`).toBe(true);
  expect([...observed].some(state => state.startsWith("carry:")), `${nation}: crop never carried`).toBe(true);
  expect(restored.has("growing")).toBe(true);
  expect(restored.has("stubble")).toBe(true);
  expect(restored.has("carrying")).toBe(true);
  for (const stage of ["young", "leafy", "fruiting", "ripe", "picked"])
    expect(observed.has(`mesh:${stage}`), `${nation}: missing mesh ${stage}`).toBe(true);
});

it("the flax worker restores actual drying stooks, gathers them and stores the fibre", () => {
  const { simulation } = workshopUpgradeFixture(60, { scythe: 1 });
  const observed = new Set<string>();
  let restoredDrying = false;
  for (let tick = 0; tick < 24_000; tick++) {
    simulation.update(.05);
    for (const site of simulation.fieldFrames()) observed.add(site.state);
    if (simulation.frames().some(actor => actor.ware === "flax")) observed.add("carrying");
    if ((simulation.headquarters.inventory.flax ?? 0) > 0) observed.add("inventory");
    if (observed.has("drying") && !restoredDrying) {
      const saved = structuredClone(simulation.saveState());
      expect(simulation.loadState(saved)).toEqual({ ok: true });
      expect(simulation.fieldFrames().some(site => site.state === "drying")).toBe(true);
      restoredDrying = true;
    }
    if (observed.has("inventory")) break;
  }
  for (const state of ["growing", "ripe", "drying", "stubble", "carrying", "inventory"])
    expect(observed.has(state), `flax: missing ${state}`).toBe(true);
  expect(restoredDrying).toBe(true);
});
