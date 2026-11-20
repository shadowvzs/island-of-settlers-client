import { describe, expect, it } from "vitest";

import { type ColonyIsland,colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { normalizeColonyRound, replenishColonyOffer } from "../src/shared/settlement/colony-offer-replenishment";
import {
type ColonyExpedition, type ColonyExpeditionState,
  createColonyExpeditions} from "../src/shared/settlement/settlement-colony-expeditions";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { selectColonyResourceTier } from "../src/shared/world/colony-resource-tiers";

const calendar = { month: 7, timeZone: "UTC" };
const offers = () => colonyIslandOffers(42, undefined, calendar, 1);
const expedition = (island: ColonyIsland): ColonyExpedition => ({ id: 1, sourceUid: 0, island,
  status: "preparing", troops: { shield: 1, archer: 0, heavy: 0, cavalry: 0 }, cargo: {}, crew: [],
  passengers: [], loads: 2, departed: 0, arrived: 0, emigrants: [], landed: {}, elapsed: 0, estimate: 0 });
const fixture = (state?: ColonyExpeditionState) => {
  let level = 1;
  const context = { options: { world: { seed: 42 }, playerLevel: () => level,
    discoveryCalendar: () => calendar }, actors: [], buildings: [{ uid: 0, typeId: 39,
    construction: 1, inventory: {}, incoming: {} }] } as unknown as SettlementContext;
  const api = createColonyExpeditions(context, {
    fleet: { pending: () => [], snapshot: () => [] }, passengers: { release: () => {} }
  } as unknown as Parameters<typeof createColonyExpeditions>[1]);
  const initial = offers();
  api.restore(state ?? { nextExpedition: 2, discoveryVersion: 1, colonyOffers: initial,
    expeditions: [expedition(initial[0]!)] });
  return { api, level: (value: number) => { level = value; } };
};

describe("committed colony discovery progression", () => {
  it.each([[0, 1], [18, 1], [21, 1], [22, 2], [25, 2], [26, 3], [27, 3], [28, 4], [80, 4]])(
    "level %i draws equally from exactly the first %i advanced resource tiers", (level, unlocked) => {
      const count = 4000, totals = new Map<number, number>();
      for (let seed = 0; seed < count; seed++) {
        const tier = selectColonyResourceTier(seed, level);
        expect(tier).toBeGreaterThanOrEqual(1); expect(tier).toBeLessThanOrEqual(unlocked);
        totals.set(tier, (totals.get(tier) ?? 0) + 1);
      }
      expect(totals.size).toBe(unlocked);
      for (const total of totals.values()) expect(Math.abs(total - count / unlocked)).toBeLessThan(count / unlocked * .15);
    });
  it("replaces only a consumed offer, preserving the other five records and the departed island", () => {
    const initial = offers(), old = structuredClone(initial[2]!);
    const next = replenishColonyOffer(42, initial, old, 0, 46, calendar, [old]);
    expect(next.offers).toHaveLength(6); expect(next.round).toBeGreaterThan(0);
    expect(next.offers[2]!.id).toBeGreaterThan(5);
    expect(next.offers[2]!.seed).not.toBe(old.seed);
    expect(next.offers[2]!.resourceTier).toBe(selectColonyResourceTier(next.offers[2]!.seed, 46));
    for (const index of [0, 1, 3, 4, 5]) expect(next.offers[index]).toBe(initial[index]);
    expect(initial[2]).toEqual(old);
    const again = replenishColonyOffer(42, initial, old, 0, 46, calendar, [old]);
    expect(again).toEqual(next);
  });
  it("does not redraw on HUD reads, level changes, reload, or a preparation cancellation", () => {
    const { api, level } = fixture();
    const initial = api.saveState().colonyOffers;
    level(80);
    api.islands(); api.islands();
    expect(api.saveState().colonyOffers).toEqual(initial);
    expect(api.cancel(1)).toBe(true);
    expect(api.saveState().colonyOffers).toEqual(initial);
    expect(api.saveState().colonyRound).toBeUndefined();
    const restored = fixture(JSON.parse(JSON.stringify(api.saveState())));
    restored.level(80); restored.api.islands();
    expect(restored.api.saveState().colonyOffers).toEqual(initial);
  });
  it("draws once at first physical departure and preserves the frozen expedition through reload", () => {
    const { api, level } = fixture();
    const initial = api.saveState(), committed = initial.expeditions[0]!.island;
    initial.expeditions[0]!.status = "sailing";
    api.restore(initial);
    level(46);
    api.onVoyage(1, "depart", {}, []);
    const departed = api.saveState();
    expect(departed.expeditions[0]!.island).toEqual(committed);
    expect(departed.colonyOffers![0]!.id).not.toBe(committed.id);
    expect(departed.colonyOffers!.slice(1)).toEqual(initial.colonyOffers!.slice(1));
    expect(departed.colonyOffers![0]!.resourceTier)
      .toBe(selectColonyResourceTier(departed.colonyOffers![0]!.seed, 46));
    const restored = fixture(JSON.parse(JSON.stringify(departed))); restored.level(1);
    restored.api.islands(); restored.api.onVoyage(1, "depart", {}, []);
    expect(restored.api.saveState().colonyOffers).toEqual(departed.colonyOffers);
    expect(restored.api.saveState().colonyRound).toBe(departed.colonyRound);
    expect(restored.api.saveState().expeditions[0]!.departed).toBe(2);
  });
  it("keeps unique future identities after consumed records have been released", () => {
    let current = offers(), round = 0;
    const ids = new Set(current.map(island => island.id)), seeds = new Set(current.map(island => island.seed));
    for (let step = 0; step < 30; step++) {
      const next = replenishColonyOffer(42, current, current[step % 6]!, round, 46, calendar);
      const created = next.offers[step % 6]!;
      expect(ids.has(created.id)).toBe(false); expect(seeds.has(created.seed)).toBe(false);
      ids.add(created.id); seeds.add(created.seed); current = next.offers; round = next.round;
    }
    expect(normalizeColonyRound(undefined, current)).toBe(round);
    expect(normalizeColonyRound(round, [])).toBe(round);
  });
  it("preserves balanced difficulty and ore slots across six successive replacements", () => {
    const initial = offers();
    let current = initial, round = 0;
    for (let slot = 0; slot < 6; slot++) {
      const replacement = replenishColonyOffer(42, current, current[slot]!, round, 46, calendar);
      current = replacement.offers; round = replacement.round;
      expect(current[slot]!.difficulty).toBe(initial[slot]!.difficulty);
      expect(current[slot]!.ore).toBe(initial[slot]!.ore);
    }
    expect(current.map(island => island.difficulty).sort())
      .toEqual(["easy", "easy", "hard", "hard", "medium", "medium"]);
    expect(new Set(current.map(island => island.ore)).size).toBe(4);
  });
});
