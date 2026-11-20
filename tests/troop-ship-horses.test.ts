import { describe, expect, it } from "vitest";

import { deckTroopsView } from "../src/app/settlement/deck-troops-view";
import { SHIP_DECK_HORSE_WORLD } from "../src/render-common/ships/ship-deck-layout";
import { createHarbourDocks } from "../src/shared/settlement/settlement-harbour-docks";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { landingClearance } from "./helpers/landing-clearance";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

type Fleet = ReturnType<typeof createNavalFleet>;
const run = (fleet: Fleet, until: () => boolean, seconds = 400) => {
  for (let time = 0; time < seconds && !until(); time += SHIP_TICK) fleet.update(SHIP_TICK);
};

/** A troop ship bringing two men on foot and two riders (room on deck for both horses). */
const troopShip = (types: readonly ("cavalry" | "heavy" | "archer")[] = ["cavalry", "heavy", "cavalry", "archer"]) => {
  const sea = createShipSea(), harbour = sea.harbour(60), landed: unknown[] = [];
  const hooks = { embark: () => undefined, landTroops: (troops: readonly unknown[]) => { landed.push(...troops); },
    ready: () => true, release: () => undefined };
  const fleet = createNavalFleet(sea.context, sea.sea, hooks);
  const troops = types.map(type => ({ hp: 100, rank: 1, type }));
  expect(fleet.sendVisitor(harbour.uid, { fish: 5 }, [], "troops", troops)).not.toBeNull();
  const docks = createHarbourDocks(sea.context);
  const view = (current: Fleet = fleet) => deckTroopsView(sea.world, current.frames(),
    docks(current.snapshot(), current.frames()));
  return { fleet, hooks, landed, sea, view };
};
const typeOf = (view: ReturnType<ReturnType<typeof troopShip>["view"]>, uid: number) =>
  view.soldiers.find(soldier => soldier.actor === uid)!.combat!.type;

describe("riders' horses on colony troop ships (owner, 2026-10-15)", () => {
  it("stands the horses on deck for the voyage, each held by its rider at its head", () => {
    const { fleet, view } = troopShip();
    run(fleet, () => fleet.frames()[0]?.phase === "sailing", 60);
    const { actors, horses } = view();
    expect(actors).toHaveLength(4);
    expect(horses).toHaveLength(2);
    for (const horse of horses) {
      const holder = actors.find(actor => actor.uid === horse.leader)!;
      expect(horse.held).toBe(true);
      expect(typeOf(view(), holder.uid)).toBe("cavalry");
      expect(holder.mounted).toBe(false);
      expect(Math.hypot(holder.x - horse.x, holder.z - horse.z)).toBeLessThan(1.7);
    }
    expect(Math.hypot(horses[0]!.x - horses[1]!.x, horses[0]!.z - horses[1]!.z)).toBeGreaterThan(.5);
  });

  it("lands the men first, then the riders mounted, a horse's length and more apart", () => {
    const { fleet, landed, view } = troopShip();
    run(fleet, () => fleet.frames()[0]?.phase === "unloading");
    const setOff = new Map<number, number>();
    let time = 0, closestRiders = Infinity;
    run(fleet, () => {
      time += SHIP_TICK;
      const current = view();
      const walking = current.actors.filter(actor => actor.action === "walk");
      for (const actor of walking) if (!setOff.has(actor.uid)) setOff.set(actor.uid, time);
      for (const actor of walking) expect(Boolean(actor.mounted)).toBe(typeOf(current, actor.uid) === "cavalry");
      const bodies = [...current.actors, ...current.horses.map(horse => ({
        mounted: true, x: horse.x, yaw: horse.heading, z: horse.z
      }))];
      for (let index = 0; index < bodies.length; index++) for (const other of bodies.slice(index + 1))
        expect(landingClearance(bodies[index]!, other), JSON.stringify({ time, a: bodies[index], b: other })).toBeGreaterThanOrEqual(-.01);
      const riders = walking.filter(actor => actor.mounted);
      if (riders.length === 2)
        closestRiders = Math.min(closestRiders, Math.hypot(riders[0]!.x - riders[1]!.x, riders[0]!.z - riders[1]!.z));
      // A horse leaves the deck once its rider has mounted.
      expect(current.horses.length + riders.length).toBeLessThanOrEqual(2);
      return landed.length > 0;
    });
    expect(landed).toHaveLength(4);
    const current = view(), ids = [...setOff.keys()];
    expect(ids).toHaveLength(4);
    const order = ids.sort((a, b) => setOff.get(a)! - setOff.get(b)!);
    expect(order.map(uid => ["heavy", "archer", "cavalry", "cavalry"][uid % 64])).toEqual(
      ["heavy", "archer", "cavalry", "cavalry"]);
    expect(current.actors).toHaveLength(0);
    expect(closestRiders).toBeGreaterThan(SHIP_DECK_HORSE_WORLD.depth);
  });

  it.each([6, 10, 16])("delivers a mixed %i-troop ship without losing passengers", count => {
    const types = Array.from({ length: count }, (_, index) => index % 3 === 0 ? "cavalry" as const : "heavy" as const);
    const { fleet, landed, view } = troopShip(types);
    const departed = new Set<number>();
    run(fleet, () => {
      const current = view();
      for (const actor of current.actors) if (actor.action === "walk") departed.add(actor.uid);
      const bodies = [...current.actors, ...current.horses.map(horse => ({
        mounted: true, x: horse.x, yaw: horse.heading, z: horse.z
      }))];
      for (let index = 0; index < bodies.length; index++) for (const other of bodies.slice(index + 1))
        expect(landingClearance(bodies[index]!, other), JSON.stringify({ count, phase: fleet.frames()[0]?.phase, elapsed: fleet.frames()[0]?.cargoWork?.elapsed, a: bodies[index], b: other })).toBeGreaterThanOrEqual(-.01);
      return landed.length > 0;
    });
    expect(landed).toHaveLength(count);
    expect(departed.size).toBe(count);
  });

  it("extends an old short unloading receipt without rewinding its elapsed work", () => {
    const { fleet, hooks, sea, view } = troopShip(Array.from({ length: 16 }, (_, index) =>
      index % 3 === 0 ? "cavalry" : "heavy"));
    run(fleet, () => view().actors.some(actor => actor.mounted));
    const state = structuredClone(fleet.saveState()), ship = state.ships[0]!;
    const expectedSeconds = ship.handling!.seconds;
    const elapsed = ship.handling!.seconds - ship.timer;
    ship.handling!.seconds -= 3; ship.timer -= 3;
    const restored = createNavalFleet(sea.context, sea.sea, hooks);
    restored.restore(state);
    expect(restored.frames()[0]!.cargoWork!.elapsed).toBeCloseTo(elapsed);
    expect(restored.saveState().ships[0]!.handling!.seconds).toBeCloseTo(expectedSeconds);
  });

  it("carries on landing the riders where it was after a save in the middle of it", () => {
    const { fleet, hooks, sea, view } = troopShip();
    run(fleet, () => view().actors.some(actor => actor.mounted));
    const before = view(), restored = createNavalFleet(sea.context, sea.sea, hooks);
    restored.restore(structuredClone(fleet.saveState()));
    const after = view(restored);
    expect(after.actors.map(({ mounted, uid, x, z }) => ({ mounted, uid, x, z })))
      .toEqual(before.actors.map(({ mounted, uid, x, z }) => ({ mounted, uid, x, z })));
    expect(after.horses).toEqual(before.horses);
  });
});
