import type { Object3D } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { findHarbourDock } from "../src/shared/settlement/settlement-harbour-docks";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSeaMask, findSeaRoute } from "../src/shared/settlement/settlement-sea-navigation";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import {
  SHIPYARD_HULL_PLANKS_BEFORE_RIGGING, SHIPYARD_MAST_CLOTH, SHIPYARD_RECIPES
} from "../src/shared/settlement/shipyard-recipes";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40, heights = new Float32Array((size + 1) ** 2);
  for (let z = 0; z <= size; z++) for (let x = 22; x <= size; x++) heights[z * (size + 1) + x] = -2;
  const world = { seed: 1, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 }, heights,
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < size; z++) for (let x = 22; x < size; x++) {
    world.walkCost[z * size + x] = 0; world.blocking[z * size + x] = 1;
  }
  const roads = { route: (from: {x:number;z:number}, to: {x:number;z:number}) =>
    ({ points: [{ ...to }], cost: Math.hypot(to.x - from.x, to.z - from.z), length: 10 }),
    addRoad: () => true, upgradeRoad: () => true };
  const context: SettlementContext = { options: { world, roads, findWorkerPath: (_from, to) => [{...to}] },
    buildings: [], actors: [], occupied: new Uint8Array(size ** 2), reservations: new Set(),
    nextActor: 0, nextBuilding: 0, settlers: 20, resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: [] };
  const harbor = (x: number, z: number) => {
    const b = makeBuilding(context, 39, x, z, 0); b.construction = 1; context.buildings.push(b); return b;
  };
  return { world, context, harbor };
};
const liveShipyardFixture = (extraStock: Record<string, number> = {}) => {
  const { context, world } = fixture();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ ...context.options, roads, findWorkerPath: undefined,
    initialStock: { cloth: 4, planks: 100, stone: 100, hammer: 5, ...extraStock } });
  const [width, depth] = getBuildingDefinition(36).gridFootprint;
  const result = simulation.placeBuilding(36, Math.floor(17 - width / 2) + width / 2,
    Math.floor(12 - depth / 2) + depth / 2);
  expect(result.ok, result.reason).toBe(true);
  const yard = result.building!;
  expect(simulation.connectRoads(simulation.headquarters.access, yard.access)).toBe(true);
  simulation.setShipyardMode(yard.uid, "ships");
  return { world, simulation, yard };
};
describe("civilian naval ownership and routes", () => {
  it("positions at a physical pier before boarding readiness and waits for every passenger", () => {
    const { context, harbor, world } = fixture(), from = harbor(18.5, 6), to = harbor(18.5, 28);
    let aboard = false, embarked = 0, loadingTicks = 0;
    const fleet = createNavalFleet(context, createSeaMask(world), {
      ready: () => false,
      loadPassengers: ship => {
        expect(findHarbourDock(context, from.uid, ship)).not.toBeNull();
        loadingTicks++;
        return aboard;
      },
      embark: () => { embarked++; }, release: () => {}
    });
    fleet.addShip({ x: 29.5, z: 12.5 });
    expect(fleet.queueTransport(from.uid, to.uid, {}, [11])).not.toBeNull();
    for (let tick = 0; tick < 1200; tick++) fleet.update(.05);
    expect(loadingTicks).toBeGreaterThan(200);
    expect(fleet.snapshot()[0]?.phase).toBe("loading");
    expect(embarked).toBe(0);
    const pose = fleet.frames()[0]!;
    for (let tick = 0; tick < 200; tick++) fleet.update(.05);
    expect(fleet.frames()[0]).toMatchObject({ x: pose.x, z: pose.z, yaw: pose.yaw });
    aboard = true; fleet.update(.05);
    expect(embarked).toBe(1);
    expect(fleet.snapshot()[0]?.phase).toBe("sailing");
  });
  it("keeps a saved sailing route and cursor when its canonical endpoint is unchanged", () => {
    const { context, harbor, world } = fixture(), from = harbor(18.5, 6), to = harbor(18.5, 28);
    from.inventory = { planks: 2 };
    const fleet = createNavalFleet(context, createSeaMask(world));
    fleet.addShip({ x: 28.5, z: 6.5 });
    expect(fleet.queueTransport(from.uid, to.uid, { planks: 1 })).not.toBeNull();
    for (let tick = 0; tick < 1200 && fleet.snapshot()[0]?.phase !== "sailing"; tick++) fleet.update(.05);
    const saved = fleet.saveState(), ship = saved.ships[0]!;
    expect(ship.phase).toBe("sailing");
    expect(ship.route.length).toBeGreaterThan(0);
    const restored = createNavalFleet(context, createSeaMask(world));
    restored.restore(saved);
    const after = restored.saveState().ships[0]!;
    expect(after.route).toEqual(ship.route);
    expect(after.cursor).toBe(ship.cursor);
  });
  it("routes connected ocean without crossing land, shallow water, freshwater or out-of-map aliases", () => {
    const { world } = fixture(); const sea = createSeaMask(world);
    expect(findSeaRoute(world, sea, { x: 23.5, z: 4.5 }, { x: 23.5, z: 30.5 })).toHaveLength(26);
    expect(findSeaRoute(world, sea, { x: 21.5, z: 4.5 }, { x: 23.5, z: 30.5 })).toBeNull();
    expect(findSeaRoute(world, sea, { x: -1, z: 5 }, { x: 23.5, z: 30.5 })).toBeNull();
    const island = new Float32Array(world.heights.length).fill(1);
    for (let z = 8; z < 13; z++) for (let x = 8; x < 13; x++) island[z * 41 + x] = -2;
    world.heights = island; expect(createSeaMask(world).some(Boolean)).toBe(false);
  });
  it("reserves exactly requested cargo, loads/sails/unloads once, and rejects capacity/input errors", () => {
    const { context, harbor, world } = fixture(), from = harbor(18.5, 6), to = harbor(18.5, 28);
    from.inventory = { planks: 50 };
    const fleet = createNavalFleet(context, createSeaMask(world)); fleet.addShip({x:28.5,z:6.5});
    expect(fleet.queueTransport(from.uid, to.uid, {planks:41})).toBeNull();
    expect(fleet.queueTransport(from.uid, to.uid, {planks:1.5})).toBeNull();
    expect(fleet.queueTransport(from.uid, to.uid, {planks:40})).toBe(1);
    expect(from.inventory.planks).toBe(10); expect(to.inventory.planks ?? 0).toBe(0);
    for (let i=0;i<3600;i++) fleet.update(.05);
    expect(to.inventory.planks).toBe(40); expect(fleet.frames()[0]?.cargoCount).toBe(0);
    expect(fleet.snapshot()[0]?.id).toBe(1); expect(fleet.snapshot()[0]?.phase).toBe("idle");
  });
  it("returns queued reservations on cancel and retains cargo when destination stops accepting it", () => {
    const { context, harbor, world } = fixture(), from = harbor(18.5,6), to = harbor(18.5,28);
    from.inventory = {stone:6}; const fleet = createNavalFleet(context, createSeaMask(world));
    const order = fleet.queueTransport(from.uid,to.uid,{stone:6})!;
    expect(from.inventory.stone).toBe(0); expect(fleet.cancelTransport(order)).toBe(true);
    expect(from.inventory.stone).toBe(6);
    fleet.addShip({x:28.5,z:6.5}); fleet.queueTransport(from.uid,to.uid,{stone:6}); fleet.update(.05);
    to.accepts.stone=false; from.accepts.stone=false;
    for(let i=0;i<2400 && fleet.snapshot()[0]?.phase!=="stranded";i++) fleet.update(.05);
    expect(fleet.snapshot()[0]?.phase).toBe("stranded"); expect(fleet.snapshot()[0]?.cargo.stone).toBe(6);
    to.accepts.stone=true;
    for(let i=0;i<3600;i++) fleet.update(.05);
    expect(to.inventory.stone).toBe(6);
  });
  it("retains paid cargo and passengers across an edited closed sea lane, reload and reopening", () => {
    const { context, harbor, world } = fixture(), from = harbor(18.5, 6), to = harbor(18.5, 28);
    from.inventory = { planks: 8 };
    const hooks = { ready: () => true, embark: () => {}, release: (_ids: readonly number[], _uid: number) => {} };
    const sea = createSeaMask(world), identity = sea;
    let fleet = createNavalFleet(context, sea, hooks);
    fleet.addShip({ x: 30.5, z: 6.5 });
    const order = fleet.queueTransport(from.uid, to.uid, { planks: 8 }, [42, 43]);
    expect(order).toBe(1);
    for (let tick = 0; tick < 2400 && fleet.snapshot()[0]?.phase !== "sailing"; tick++) fleet.update(.05);
    expect(fleet.snapshot()[0]?.phase).toBe("sailing");
    const before = world.heights.slice();
    for (let z = 18; z <= 20; z++) for (let x = 22; x <= 40; x++) world.heights[z * 41 + x] = 0;
    world.terrainRevision = 1; fleet.update(.05);
    expect(sea).toBe(identity); expect(sea[19 * 40 + 30]).toBe(0);
    expect(fleet.snapshot()[0]).toMatchObject({ phase: "stranded", cargo: { planks: 8 }, passengers: 2, orderId: 1 });
    const receipt = structuredClone(fleet.saveState());
    fleet = createNavalFleet(context, createSeaMask(world), hooks); fleet.restore(receipt);
    for (let tick = 0; tick < 80; tick++) fleet.update(.05);
    expect(fleet.snapshot()[0]).toMatchObject({ phase: "stranded", cargo: { planks: 8 }, passengers: 2, cancelled: false });
    expect(from.inventory.planks).toBe(0); expect(to.inventory.planks ?? 0).toBe(0);
    world.heights.set(before); world.terrainRevision = 2;
    for (let tick = 0; tick < 2400; tick++) fleet.update(.05);
    expect(to.inventory.planks).toBe(8); expect(fleet.snapshot()[0]?.phase).toBe("idle");
    expect(fleet.snapshot()[0]?.passengers).toBe(0);
  });
  it("drops a restored shipyard site that would block a harbour berth", () => {
    const { simulation, yard } = liveShipyardFixture();
    const harbour = simulation.debugRaiseBuilding(39);
    if (!harbour.ok) throw new Error(harbour.reason);
    for (let tick = 0; tick < 16000 && !simulation.saveState().naval.sites.some(([uid]) => uid === yard.uid); tick++)
      simulation.update(.05);
    const saved = structuredClone(simulation.saveState());
    const entry = saved.naval.sites.find(([uid]) => uid === yard.uid);
    expect(entry).toBeDefined();
    const [berth] = simulation.harbourBerths(harbour.building.uid);
    expect(berth).toBeDefined();
    entry![1].water = { x: berth!.x, z: berth!.z };
    saved.naval.active = [];
    expect(simulation.loadState(saved).ok).toBe(true);
    expect(simulation.saveState().naval.sites.some(([uid]) => uid === yard.uid)).toBe(false);
  }, 30000);

  it("builds an actual ship through recruited hammer worker and ten plank visits via public simulation API", () => {
    const { simulation, world, yard } = liveShipyardFixture();
    let visits=0,last=0;
    for(let i=0;i<16000 && simulation.ships().length===0;i++) {
      simulation.update(.05);
      const progress=simulation.shipSites()[0]?.progress ?? 0;
      if(progress>last) {visits++;last=progress;}
    }
    expect(yard.construction).toBe(1); expect(yard.worker).toBeDefined();
    expect(simulation.ships()).toHaveLength(1); expect(visits).toBe(10);
    expect(simulation.frames().find((actor)=>actor.uid===yard.worker)?.tool).toBe("hammer");
    expect(yard.output.boat ?? 0).toBe(0); expect(world.seaLevel).toBe(-1);
    const stored=simulation.buildings().reduce((n,b)=>n+(b.inventory.planks??0)+(b.input.planks??0),0);
    const carried=simulation.frames().filter((actor)=>actor.ware==="planks" || (actor.phase==="pickup" && actor.delivery?.ware==="planks")).length;
    expect(stored+carried).toBe(100-getConstructionCost(36, "roman").planks-10);
    // Sea ships consume four real cloth rolls at the rigging site.
    const cloth=simulation.buildings().reduce((n,b)=>n+(b.inventory.cloth??0)+(b.input.cloth??0),0);
    expect(cloth).toBe(0); expect(yard.input.cloth ?? 0).toBe(0);
  });
  it("transports between genuinely completed harbors through the public simulation fleet API", () => {
    const {context}=fixture();
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads=createRoadNetwork(context.options.world,{isBlocked:(x,z)=>simulation?.isOccupied(x,z)??false});
    simulation=createSettlementSimulation({...context.options,roads,findWorkerPath:undefined,initialStock:{cloth:4,planks:150,stone:100,hammer:8}});
    const place=(id:number,x:number,z:number)=>{
      const [w,d]=getBuildingDefinition(id).gridFootprint;
      const result=simulation.placeBuilding(id,Math.floor(x-w/2)+w/2,Math.floor(z-d/2)+d/2);
      expect(result.ok,result.reason).toBe(true);
      expect(simulation.connectRoads(simulation.headquarters.access,result.building!.access)).toBe(true);
      return result.building!;
    };
    const from=place(39,18,6),to=place(39,16,28),yard=place(36,17,17);
    simulation.setShipyardMode(yard.uid,"ships");
    let peakCrowd = 0, peakVisible = 0;
    for(let i=0;i<20000 && (from.construction<1 || to.construction<1 || !simulation.ships().length);i++) {
      simulation.update(.05);
      peakCrowd = Math.max(peakCrowd, simulation.frames().filter(actor => actor.visible &&
        Math.hypot(actor.x-simulation.headquarters.access.x,actor.z-simulation.headquarters.access.z)<4).length);
      peakVisible = Math.max(peakVisible,simulation.frames().filter(actor=>actor.visible).length);
    }
    expect(peakVisible).toBeGreaterThanOrEqual(5);
    expect(peakCrowd).toBeGreaterThanOrEqual(4);

    expect(from.construction).toBe(1);expect(to.construction).toBe(1);expect(simulation.ships(),JSON.stringify({yard: {input:yard.input,worker:yard.worker,status:yard.status}, actors:simulation.frames().map(a=>({uid:a.uid,phase:a.phase,visible:a.visible,x:a.x,z:a.z,queue:a.queueTarget,goal:a.path[a.pathIndex],ware:a.ware,stock:a.stockBuilding}))})).toHaveLength(1);
    simulation.setShipyardMode(yard.uid,"boats");from.inventory.fish=40;
    expect(simulation.queueSeaTransport(from.uid,to.uid,{fish:40})).not.toBeNull();
    expect(from.inventory.fish).toBe(0);
    for(let i=0;i<5200;i++) simulation.update(.05);
    expect(to.inventory.fish).toBe(40);expect(simulation.ships().find((ship)=>ship.id===1)?.cargo).toEqual({});
  },30000);
  it("demolishing a harbor cancels paid queued voyages without creating or losing their cargo",()=>{
    const {context}=fixture();
    let simulation:ReturnType<typeof createSettlementSimulation>;
    const roads=createRoadNetwork(context.options.world,{isBlocked:(x,z)=>simulation?.isOccupied(x,z)??false});
    simulation=createSettlementSimulation({...context.options,roads,findWorkerPath:undefined,initialStock:{cloth:4,planks:150,stone:100,hammer:8}});
    const place=(x:number,z:number)=>{
      const [w,d]=getBuildingDefinition(39).gridFootprint;
      const result=simulation.placeBuilding(39,Math.floor(x-w/2)+w/2,Math.floor(z-d/2)+d/2);
      expect(result.ok,result.reason).toBe(true);
      expect(simulation.connectRoads(simulation.headquarters.access,result.building!.access)).toBe(true);
      return result.building!;
    };
    const from=place(18,6),to=place(16,28);
    for(let i=0;i<20000 && (from.construction<1 || to.construction<1);i++)simulation.update(.05);
    expect(from.construction).toBe(1);expect(to.construction).toBe(1);
    from.inventory.fish=6;
    const order=simulation.queueSeaTransport(from.uid,to.uid,{fish:6})!;
    expect(order).not.toBeNull();expect(from.inventory.fish).toBe(0);
    expect(simulation.demolishBuilding(to.uid).ok).toBe(true);
    expect(from.inventory.fish).toBe(6);expect(simulation.cancelSeaTransport(order)).toBe(false);
    expect(simulation.demolishBuilding(from.uid).ok).toBe(true);
    expect(simulation.headquarters.inventory.fish).toBe(6);
  });
  it("applies a mid-trip switch only after finishing its paid ship plank and returning through the door", () => {
    const { simulation, yard } = liveShipyardFixture();
    for(let i=0;i<5000 && !simulation.frames().some((a)=>a.job==="Shipwright" && a.phase==="shipWork");i++)
      simulation.update(.05);
    const worker=simulation.frames().find((a)=>a.job==="Shipwright")!;
    expect(worker.phase).toBe("shipWork"); simulation.setShipyardMode(yard.uid,"boats");
    for(let i=0;i<2000;i++) simulation.update(.05);
    // A boat under way (halved production times, BAL-01) is a site too; check the ship site.
    expect(simulation.shipSites().find(site => site.kind === undefined)?.progress).toBe(.1); expect(simulation.ships()).toHaveLength(0);
    const boats=simulation.buildings().reduce((n,b)=>n+(b.inventory.boat??0)+(b.output.boat??0),0);
    expect(boats).toBeGreaterThan(0); expect(worker.tool).toBe("hammer");
    // Boats mode never spends the sea ship's cloth.
    expect(yard.input.cloth ?? 0).toBe(4);
  });
  it("fits the required cloth before the last hull planks and raises the mast at the recipe threshold", () => {
    const { simulation, yard } = liveShipyardFixture();
    let firstClothPlanks = -1, lastClothPlanks = -1, firstMastCloth = -1, previousCloth = 0;
    for (let tick = 0; tick < 24000 && simulation.ships().length === 0; tick++) {
      simulation.update(.05);
      const site = simulation.shipSites().find(frame => frame.kind === undefined);
      const cloth = site?.cloth ?? 0;
      if (!site || cloth === previousCloth) continue;
      const planks = Math.round(site.progress * SHIPYARD_RECIPES.ships.planks);
      if (firstClothPlanks < 0) firstClothPlanks = planks;
      lastClothPlanks = planks;
      previousCloth = cloth;
      if (firstMastCloth < 0 && cloth >= SHIPYARD_MAST_CLOTH) firstMastCloth = cloth;
    }
    expect(simulation.ships()).toHaveLength(1);
    expect(firstClothPlanks).toBe(SHIPYARD_HULL_PLANKS_BEFORE_RIGGING);
    expect(lastClothPlanks).toBe(SHIPYARD_HULL_PLANKS_BEFORE_RIGGING);
    expect(firstMastCloth).toBe(SHIPYARD_MAST_CLOTH);
    expect(yard.input.cloth ?? 0).toBe(0);
  }, 30_000);

  it("waits for real cloth before rigging a sea ship and launches once after delivery", () => {
    const { simulation } = liveShipyardFixture({ cloth: 0 });
    const yard = simulation.buildings().find(building => building.typeId === 36)!;
    for (let tick = 0; tick < 24000 && yard.status !== "Waiting for cloth"; tick++) simulation.update(.05);
    expect(yard.input.cloth ?? 0).toBe(0);
    expect(simulation.shipSites().find(site => site.kind === undefined)?.progress).toBeGreaterThanOrEqual(.8);
    expect(simulation.ships()).toHaveLength(0);
    expect(yard.status).toBe("Waiting for cloth");
    yard.input.cloth = 3;
    for (let tick = 0; tick < 24000; tick++) simulation.update(.05);
    expect(simulation.ships()).toHaveLength(0);
    expect(simulation.saveState().naval.sites.find(([uid]) => uid === yard.uid)?.[1].cloth).toBe(3);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    const resumedYard = simulation.buildings().find(building => building.uid === yard.uid)!;
    resumedYard.input.cloth = 1;
    for (let tick = 0; tick < 24000 && simulation.ships().length === 0; tick++) simulation.update(.05);
    expect(simulation.ships()).toHaveLength(1);
    expect(resumedYard.input.cloth ?? 0).toBe(0);
    expect(simulation.shipSites().find(site => site.kind === undefined)).toBeUndefined();
  }, 30_000);

  it("reloads a partial sea hull with its cloth receipt and still launches exactly one ship", () => {
    const { simulation, yard } = liveShipyardFixture();
    for (let tick = 0; tick < 24000; tick++) {
      simulation.update(.05);
      if ((simulation.shipSites().find(site => site.kind === undefined)?.progress ?? 0) >= .2) break;
    }
    const saved = simulation.saveState();
    const site = saved.naval.sites.find(([uid]) => uid === yard.uid)?.[1];
    expect(site?.steps).toBeGreaterThanOrEqual(2);
    expect(site?.cloth).toBe(0);
    const corrupt = structuredClone(saved);
    corrupt.naval.sites.find(([uid]) => uid === yard.uid)![1].cloth = 5;
    expect(simulation.loadState(corrupt).ok).toBe(false);
    expect(simulation.loadState(structuredClone(saved))).toEqual({ ok: true });
    for (let tick = 0; tick < 30000 && simulation.ships().length === 0; tick++) simulation.update(.05);
    expect(simulation.ships()).toHaveLength(1);
    expect(simulation.shipSites().find(frame => frame.kind === undefined)).toBeUndefined();
  }, 45_000);

  it.each([
    ["high", "roman"], ["high", "viking"], ["high", "nubian"], ["high", "japanese"],
    ["minimal", "roman"], ["minimal", "viking"], ["minimal", "nubian"], ["minimal", "japanese"]
  ] as const)("reveals one hull slice per plank and one cloth panel per cloth roll in %s/%s", (quality, nation) => {
    const renderer=createThreeSettlementShips(quality);
    const site = (cloth: number, progress = .8) => ({ id: 1, x: 4, y: 0, z: 5, yaw: 0, progress, cloth });
    const visible = (group: Object3D) => group.children.filter(child => child.visible).length;
    const environment = { playerNation: nation };
    renderer.update([], [site(0, .1)], 0, environment);
    const root=renderer.group.children[0]!;
    const hull = root.children[1]!, rig = root.children[2]!, clothGroup = root.children[5]!;
    expect(visible(hull)).toBe(1);
    expect(rig.visible).toBe(false);
    renderer.update([], [site(0, .5)], 1, environment);
    expect(visible(hull)).toBe(5);
    expect(rig.visible).toBe(false);
    renderer.update([], [site(0)], 2, environment);
    expect(visible(hull)).toBe(SHIPYARD_HULL_PLANKS_BEFORE_RIGGING);
    renderer.update([], [site(SHIPYARD_MAST_CLOTH - 1)], 3, environment);
    expect(visible(clothGroup)).toBe(SHIPYARD_MAST_CLOTH - 1);
    expect(rig.visible).toBe(false);
    renderer.update([], [site(SHIPYARD_MAST_CLOTH)], 4, environment);
    expect(visible(clothGroup)).toBe(SHIPYARD_MAST_CLOTH);
    expect(rig.visible).toBe(true);
    renderer.update([{ id: 9, x: 4, y: 0, z: 5, yaw: 0, phase: "sailing", cargoCount: 0 }], [], 5, environment);
    const shipRoot = renderer.group.children[0]!;
    expect(visible(shipRoot.children[1]!)).toBe(SHIPYARD_RECIPES.ships.planks);
    expect(shipRoot.children[2]?.visible).toBe(true);
    expect(visible(shipRoot.children[5]!)).toBe(0);
    renderer.update([], [], 4);
    expect(renderer.group.children).toHaveLength(0); renderer.dispose();
  });

  it.each(["high","minimal"] as const)("renders original sea craft and authoritative build stages in %s", quality => {
    const renderer=createThreeSettlementShips(quality);
    renderer.update([],[{id:1,x:4,y:0,z:5,yaw:0,progress:.1}],0);
    const root=renderer.group.children[0]!; expect(root.children[2]?.visible).toBe(false);
    renderer.update([{id:9,x:4,y:0,z:5,yaw:1,phase:"sailing",cargoCount:40}],[],1);
    expect(renderer.group.children).toHaveLength(1); expect(renderer.group.children[0]?.rotation.y).toBe(1);
    renderer.update([],[],2); expect(renderer.group.children).toHaveLength(0); renderer.dispose();
  });
});

describe("ship sinking save contract", () => {
  it("validates a full save after sinking and replays the removal without restoring the visual effect", () => {
    const { context, world } = fixture();
    const roads = createRoadNetwork(world, { isBlocked: () => false });
    const simulation = createSettlementSimulation({ ...context.options, roads });
    const fleet = createNavalFleet(context, createSeaMask(world));
    const id = fleet.addShip({ x: 28.5, z: 6.5 })!;
    const baseline = structuredClone(simulation.saveState());
    baseline.naval.fleet = structuredClone(fleet.saveState());
    const loadedBaseline = simulation.loadState(baseline);
    expect(loadedBaseline, JSON.stringify(loadedBaseline)).toMatchObject({ ok: true });
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    expect(simulation.sinkShip(id)).toBe(true);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toEqual(["sinkShip"]);
    const saved = structuredClone(simulation.saveState());
    expect(saved.naval.fleet.ships).toEqual([]);
    expect(JSON.stringify(saved)).not.toMatch(/sinkProgress|sinking/);
    recorder.dispose();
    expect(simulation.loadState(saved).ok).toBe(true);
    expect(simulation.shipFrames()).toEqual([]);
    expect(simulation.loadState(baseline).ok).toBe(true);
    expect(replayCommandLog(simulation, interval).ok).toBe(true);
    expect(simulation.ships()).toEqual([]);
  });

  it("removes an empty hull without a refund and never saves or resumes its animation", () => {
    const { context, world, harbor } = fixture();
    const home = harbor(18.5, 6); home.inventory = { planks: 11, cloth: 3 };
    const fleet = createNavalFleet(context, createSeaMask(world));
    const id = fleet.addShip({ x: 28.5, z: 6.5 })!;
    expect(fleet.snapshot()[0]?.canSink).toBe(true);
    expect(fleet.sinkShip(id)).toBe(true);
    expect(fleet.sinkShip(id)).toBe(false);
    expect(fleet.snapshot()).toEqual([]);
    expect(fleet.frames()).toEqual([expect.objectContaining({ id, sinkProgress: 0 })]);
    fleet.update(2);
    expect(fleet.frames()[0]!.sinkProgress).toBeGreaterThan(0);
    const saved = structuredClone(fleet.saveState());
    expect(saved.ships).toEqual([]);
    expect(JSON.stringify(saved)).not.toMatch(/sinkProgress|sinking/);
    const restored = createNavalFleet(context, createSeaMask(world));
    restored.restore(saved);
    expect(restored.frames()).toEqual([]);
    expect(restored.snapshot()).toEqual([]);
    fleet.update(10);
    expect(fleet.frames()).toEqual([]);
    expect(home.inventory).toEqual({ planks: 11, cloth: 3 });
  });

  it("refuses cargo, passengers, visitors and mission reservations without altering the save", () => {
    const { context, world } = fixture();
    const cases = [
      { cargo: { planks: 1 } }, { passengers: [2] }, { troops: [{ type: "shield", rank: 0, hp: 100 }] },
      { visitor: { role: "supply", leaving: false } }, { phase: "sailing" },
      { reservedFor: -1 }, { orderId: 1 }, { nextOrderId: 2 }, { foundingSiteUid: 3 }
    ];
    for (const patch of cases) {
      const fleet = createNavalFleet(context, createSeaMask(world));
      const id = fleet.addShip({ x: 28.5, z: 6.5 })!;
      Object.assign(fleet.saveState().ships[0]!, patch);
      const before = JSON.stringify(fleet.saveState());
      expect(fleet.sinkShip(id), JSON.stringify(patch)).toBe(false);
      expect(JSON.stringify(fleet.saveState())).toBe(before);
    }
  });

  it.each(["high", "minimal"] as const)("renders the one-time hull descent and clears it in %s", quality => {
    const renderer = createThreeSettlementShips(quality);
    const ship = { id: 1, x: 4, y: 0, z: 5, yaw: .5, phase: "idle" as const, cargoCount: 0 };
    renderer.update([{ ...ship, sinkProgress: 0 }], [], 0);
    const root = renderer.group.children.find(child => child.name.startsWith("ship")) ?? renderer.group.children[0]!;
    const surface = root.position.y;
    renderer.update([{ ...ship, sinkProgress: .5 }], [], 1);
    expect(root.position.y).toBeLessThan(surface - 2);
    expect(root.rotation.z).toBeGreaterThan(0);
    renderer.update([], [], 2);
    expect(root.parent).toBeNull();
    renderer.dispose();
  });
});
