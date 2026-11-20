import { describe, expect, it } from "vitest";

import { applyOfflineCivilianRaid, estimateOfflineRaid } from "../src/shared/settlement/offline-civilian-raid";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { fixture, loadedCart } from "./helpers/handcart-fixture";

/**
 * MIL-CREWS (owner 2026-11-09): a hand cart's crew is a raid target like any civilian outside. A threatened
 * puller parks and runs; killed or not, its cart stops where it stood, every claim is released, and a free
 * carrier later fetches the cart and unloads the bed into a storage. MIL-TWEAKS (owner 2026-11-09): a
 * killed puller's bed load is lost with it (the empty cart is still fetched); a runner that lives keeps it.
 */
const ENEMY = 1;
type Fixture = ReturnType<typeof fixture>;

const loaded = () => {
  const f = fixture();
  const { baseline, before } = f.dispatch();
  expect(f.advance(60, loadedCart(f.crews))).toBe(true);
  return { baseline, before, crew: f.crews()[0]!, f };
};
const spawnBeside = (f: Fixture, actor: SettlementActor, offsets: readonly number[]) =>
  offsets.map(offset => f.simulation.spawnMilitaryOpponent({ x: actor.x + offset, z: actor.z + .4 }, "heavy", 0,
    ENEMY)) as number[];
const deaths = (f: Fixture) => f.simulation.saveState().military?.combat?.civilianDeaths ?? 0;
const abandoned = (f: Fixture) => f.simulation.saveState().abandonedHandcarts ?? [];
const sendAway = (f: Fixture, raiders: number[]) =>
  expect(f.simulation.commandMilitaryOpponent(raiders, { x: 58, z: 58 }, ENEMY, "move")).toBe(true);
const cartsOwned = (f: Fixture) =>
  f.simulation.handcarts(f.headquarters.uid) + f.simulation.handcarts(f.storehouse.uid);

describe("MIL-CREWS: cart crews", () => {
  it("a killed puller's cart stands where it stopped, its load lost; the destination is released", () => {
    const { before, crew, f } = loaded();
    const raiders = spawnBeside(f, crew, [.5, -.5]);
    expect(raiders.every(id => id !== null)).toBe(true);
    expect(f.advance(5, () => deaths(f) > 0)).toBe(true);
    expect(f.simulation.frames().some(actor => actor.uid === crew.uid)).toBe(false);
    const [cart] = abandoned(f);
    expect(cart).toMatchObject({ id: crew.uid, owner: f.headquarters.uid });
    expect(cart).not.toHaveProperty("cargo");
    expect(cart).not.toHaveProperty("ware");
    expect(f.storehouse.incoming.stone ?? 0).toBe(0);
    // The three stones died with the puller; the empty cart still counts as the headquarters' own.
    expect(f.stoneTotal()).toBe(before - 3);
    expect(cartsOwned(f)).toBe(1);
    expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
  }, 120_000);

  it("a free carrier fetches the dead puller's empty cart once the raiders are gone", () => {
    const { baseline, before, crew, f } = loaded();
    const raiders = spawnBeside(f, crew, [.5, -.5]);
    expect(f.advance(5, () => deaths(f) > 0)).toBe(true);
    sendAway(f, raiders);
    expect(f.advance(300, () => abandoned(f).length === 0 && f.crews().length === 0)).toBe(true);
    expect(f.headquarters.handcarts! + (f.storehouse.handcarts ?? 0)).toBe(1);
    expect(cartsOwned(f)).toBe(1);
    // The lost load never comes back and nothing is promised for it any more.
    expect(f.stoneTotal()).toBe(before - 3);
    expect(f.available()).toBe(baseline);
    expect(f.storehouse.incoming.stone ?? 0).toBe(0);
  }, 300_000);

  it("a threatened puller parks and flees; its load stays on the bed and reaches a storage later", () => {
    const { baseline, before, crew, f } = loaded();
    const raiders = spawnBeside(f, crew, [5]);
    expect(raiders.every(id => id !== null)).toBe(true);
    expect(f.advance(3, () => abandoned(f).length > 0)).toBe(true);
    expect(abandoned(f)[0]).toMatchObject({ cargo: 3, id: crew.uid, ware: "stone" });
    const runner = f.simulation.frames().find(actor => actor.uid === crew.uid)!;
    expect(runner.handcart).toBeUndefined();
    expect(runner.demolitionReturning).toBe(true);
    expect(f.storehouse.incoming.stone ?? 0).toBe(0);
    expect(f.stoneTotal()).toBe(before - 3);
    sendAway(f, raiders);
    expect(f.advance(300, () => abandoned(f).length === 0 && f.crews().length === 0)).toBe(true);
    // Nothing was lost: the bed's stones were unloaded into a storage.
    expect(f.stoneTotal()).toBe(before);
    expect(f.available()).toBe(baseline + 3);
    expect(deaths(f)).toBe(0);
  }, 300_000);

  it("a save with an abandoned cart round-trips and two loads continue identically", () => {
    const { crew, f } = loaded();
    const raiders = spawnBeside(f, crew, [.5, -.5]);
    expect(f.advance(5, () => abandoned(f).length > 0)).toBe(true);
    sendAway(f, raiders);
    const saved = JSON.stringify(f.simulation.saveState());
    const runFrom = () => {
      expect(f.simulation.loadState(JSON.parse(saved))).toEqual({ ok: true });
      f.advance(30);
      return JSON.stringify(f.simulation.saveState());
    };
    expect(runFrom()).toBe(runFrom());
    const corrupt = JSON.parse(saved);
    corrupt.abandonedHandcarts[0].owner = 999;
    expect(f.simulation.loadState(corrupt).ok).toBe(false);
  }, 240_000);

  it("the fast offline estimate counts a cart crew as exposed and applies the same consequences", () => {
    const { crew, f } = loaded();
    expect(spawnBeside(f, crew, [3, 3.8, 4.6]).every(id => id !== null)).toBe(true);
    const save = f.simulation.saveState();
    const raid = estimateOfflineRaid(save, 3600);
    expect(raid.victims).toContain(crew.uid);
    applyOfflineCivilianRaid(save, 3600);
    expect(save.actors.some(actor => actor.uid === crew.uid)).toBe(false);
    expect(save.abandonedHandcarts).toEqual([expect.objectContaining({ id: crew.uid, owner: f.headquarters.uid })]);
    expect(save.abandonedHandcarts![0]).not.toHaveProperty("cargo");
    expect(f.simulation.loadState(save)).toEqual({ ok: true });
    const storehouse = f.simulation.buildings().find(building => building.uid === f.storehouse.uid)!;
    expect(storehouse.incoming.stone ?? 0).toBe(0);
  }, 120_000);
});
