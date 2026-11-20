import { describe, expect, it } from "vitest";

import { BUILDING_LEVEL_STEPS } from "../src/shared/balance/building-levels";
import { CIVILIAN_SIGHT } from "../src/shared/balance/vision";
import { createFactionVision, type FactionVisionSources } from "../src/shared/settlement/faction-vision";
import { createPlayerFog } from "../src/shared/settlement/player-fog";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const SIZE = 192;
const cell = (x: number, z: number) => Math.floor(z) * SIZE + Math.floor(x);

/** A hidden world, one vision layer and the player's fog it drives (as attachSettlementVision wires them). */
const island = () => {
  const world = { cellsX: SIZE, cellsZ: SIZE, fog: new Uint8Array(SIZE * SIZE) } as unknown as WorldData;
  let vision: ReturnType<typeof createFactionVision> | undefined;
  const fog = createPlayerFog(world, () => vision?.layer(0));
  vision = createFactionVision(SIZE, SIZE, fog.sink);
  const sources: FactionVisionSources & { actors: SettlementActor[]; buildings: SettlementBuilding[] } =
    { actors: [], buildings: [], military: { soldierOf: () => undefined }, playerNation: "roman" };
  let owned = new Uint8Array(SIZE * SIZE);
  const tick = () => { vision!.update(sources); fog.update(sources, owned); };
  const setOwned = (paint: (owned: Uint8Array) => void) => { owned = new Uint8Array(SIZE * SIZE); paint(owned); };
  const rebuild = () => { vision!.rebuild(sources); fog.rebuild(sources, owned); };
  return { fog, rebuild, setOwned, sources, tick, vision: vision!, world };
};

const walker = (x: number, z: number) =>
  ({ job: "Carrier", uid: 1, visible: true, x, z }) as SettlementActor;
const lookout = (fields: Partial<SettlementBuilding> = {}) =>
  ({ construction: 1, typeId: 14, uid: 7, worker: 8, x: 96, z: 96, ...fields }) as SettlementBuilding;
const lookoutScout = (phase = "inside") =>
  ({ job: "Scout", phase, uid: 8, visible: false, x: 96, z: 96 }) as SettlementActor;

describe("player fog from the vision layer", () => {
  it("shows live sight, keeps the walked trail discovered and leaves the rest hidden", () => {
    const { sources, tick, world } = island();
    const person = walker(40.5, 40.5);
    sources.actors.push(person);
    tick();
    expect(world.fog[cell(40.5 + CIVILIAN_SIGHT, 40.5)]).toBe(FOG.visible);
    expect(world.fog[cell(41.5 + CIVILIAN_SIGHT, 40.5)]).toBe(FOG.hidden);
    const revision = world.fogRevision, explored = world.exploredRevision;
    tick();
    expect(world.fogRevision).toBe(revision); // Nothing changed: no revision bump.
    person.x = 100.5;
    tick();
    expect(world.fog[cell(40.5, 40.5)]).toBe(FOG.discovered);
    expect(world.fog[cell(100.5, 40.5)]).toBe(FOG.visible);
    expect(world.fog[cell(70.5, 70.5)]).toBe(FOG.hidden);
    expect(world.exploredRevision).toBe(explored! + 1);
  });

  it("never fades permanent sight (starting sector, fog of war off)", () => {
    const { sources, tick, world } = island();
    world.permanentFog = new Uint8Array(SIZE * SIZE);
    world.permanentFog[cell(40.5, 40.5)] = FOG.visible;
    world.fog[cell(40.5, 40.5)] = FOG.visible;
    const person = walker(40.5, 40.5);
    sources.actors.push(person);
    tick();
    person.x = 140.5;
    tick();
    expect(world.fog[cell(40.5, 40.5)]).toBe(FOG.visible);
    expect(world.fog[cell(41.5, 40.5)]).toBe(FOG.discovered);
  });

  it("keeps owned land and one exterior ring visible, and fades land that is lost", () => {
    const { setOwned, tick, world } = island();
    setOwned(owned => { for (let x = 50; x < 60; x++) owned[cell(x, 50)] = 1; });
    tick();
    expect(world.fog[cell(49, 49)]).toBe(FOG.visible);
    expect(world.fog[cell(60, 51)]).toBe(FOG.visible);
    expect(world.fog[cell(61, 50)]).toBe(FOG.hidden);
    setOwned(() => undefined);
    tick();
    expect(world.fog[cell(55, 50)]).toBe(FOG.discovered);
  });

  it("charts a staffed lookout's circle as explored, without live sight", () => {
    const { sources, tick, world } = island();
    const tower = lookout(), scout = lookoutScout("assigned");
    sources.buildings.push(tower); sources.actors.push(scout);
    tick();
    expect(world.fog.every(value => value === FOG.hidden)).toBe(true); // Not staffed yet.
    scout.phase = "inside";
    tick();
    expect(world.fog[cell(166, 96)]).toBe(FOG.discovered);
    expect(world.fog[cell(170, 96)]).toBe(FOG.hidden);
    expect(world.fog.includes(FOG.visible)).toBe(false);
    scout.phase = "retired";
    tick();
    expect(world.fog[cell(166, 96)]).toBe(FOG.discovered); // Exploration survives a vacancy.
  });

  it("charts the wider circle once an upgrade completes, and an unfinished lookout charts nothing", () => {
    const { sources, tick, world } = island();
    const tower = lookout({ construction: .5 });
    sources.buildings.push(tower); sources.actors.push(lookoutScout());
    tick();
    expect(world.fog.every(value => value === FOG.hidden)).toBe(true);
    tower.construction = 1;
    const factor = 1 + BUILDING_LEVEL_STEPS.sight;
    const inside = 96 + Math.floor(70 * factor), outside = 96 + Math.ceil(74 * factor) + 1;
    tick();
    expect(world.fog[cell(inside, 96)]).toBe(FOG.hidden);
    tower.workshopUpgrade = { level: 1 };
    tick();
    expect(world.fog[cell(inside, 96)]).toBe(FOG.discovered);
    expect(world.fog[cell(outside, 96)]).toBe(FOG.hidden);
  });

  it("rebuilds the same fog from saved exploration (stale live sight fades, sight returns)", () => {
    const live = island(), loaded = island();
    const person = walker(40.5, 40.5);
    live.sources.actors.push(person);
    for (let step = 0; step < 30; step++) { person.x += 1; live.tick(); }
    // A load reads saved visible cells back as discovered (game-save.ts); the rebuild shows live sight again.
    loaded.world.fog.set(live.world.fog.map(value => Math.min(value, FOG.discovered)));
    loaded.sources.actors.push({ ...person });
    loaded.rebuild();
    expect(loaded.world.fog).toEqual(live.world.fog);
    const stale = island();
    stale.world.fog.set(live.world.fog);
    stale.rebuild();
    expect(stale.world.fog.includes(FOG.visible)).toBe(false);
  });
});
