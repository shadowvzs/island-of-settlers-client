import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { leadHomeRoadRound } from "./helpers/bridge-crossing-settlement";
import { createAngledBridgeSettlement } from "./helpers/bridge-settlement";

const BRIDGE_ID = 1;

/**
 * The river splits the island into two landmasses; a completed bridge joins them and a staffed
 * Woodcutter stands on the east bank, which has no storage of its own.
 */
const staffedFarBank = () => {
  const fixture = createAngledBridgeSettlement({ stock: { axe: 4, hammer: 4, logs: 40, planks: 40, stone: 40 } });
  const { eastAnchor, eastEnd, pointer, roads, simulation, westAnchor } = fixture;
  leadHomeRoadRound(roads);
  const plan = simulation.previewBridge(pointer, "wood", westAnchor).plan!;
  const tiles: RoadSegment[] = plan.segments.map(segment => ({ ...segment, bridge: { ...segment.bridge!, id: BRIDGE_ID } }));
  if (!roads.replaceSegments([...roads.segments(), ...tiles])) throw new Error("Bridge refused");
  const [width, depth] = getBuildingDefinition(BuildingType.Woodcutter).gridFootprint;
  let site: ReturnType<typeof simulation.placeBuilding> | undefined;
  for (let x = 21; x < 29 && !site?.ok; x += 1) for (let z = 6; z < 26 && !site?.ok; z += 1)
    site = simulation.placeBuilding(BuildingType.Woodcutter, x + (width % 2) / 2, z + (depth % 2) / 2);
  if (!site?.ok || !site.building) throw new Error("No east bank plot");
  const woodcutter = site.building;
  Object.assign(woodcutter, { construction: 1, foundationProgress: 1, required: {} });
  if (!simulation.connectRoads(woodcutter.access, eastEnd)) throw new Error("East building not connected");
  const worker = () => simulation.frames().find(actor => actor.building === woodcutter.uid && actor.job !== "Carrier");
  const arrived = () => worker() && woodcutter.worker === worker()!.uid && worker()!.phase !== "assigned" &&
    worker()!.x > eastAnchor.x;
  for (let elapsed = 0; elapsed < 300 && !arrived(); elapsed += 0.5) simulation.update(0.5);
  if (!arrived()) throw new Error(`The Woodcutter was never staffed: ${JSON.stringify(worker())}`);
  /** Cuts the bridge out of the roads at once, without the removal (and so without any rescan). */
  const cutRoads = () => {
    if (!roads.replaceSegments(roads.segments().filter(segment => !segment.bridge))) throw new Error("Cut refused");
  };
  return { ...fixture, cutRoads, worker: worker()!, woodcutter };
};

const isHome = (fixture: ReturnType<typeof staffedFarBank>, actor: SettlementActor) =>
  actor.phase === "retired" || actor.demolitionReturning === true &&
  Math.hypot(actor.x - fixture.simulation.headquarters.access.x, actor.z - fixture.simulation.headquarters.access.z) < 3;

describe("people left without any storage go home", () => {
  it("relocates the far bank's worker after a bridge removal isolates it, with a fade", () => {
    const fixture = staffedFarBank();
    const { simulation, woodcutter, worker } = fixture;
    expect(simulation.removeBridge(BRIDGE_ID).ok).toBe(true);
    for (let elapsed = 0; elapsed < 120 && simulation.bridges().length; elapsed += 0.5) simulation.update(0.5);
    expect(simulation.bridges()).toEqual([]);
    simulation.takeStorageFades();
    for (let step = 0; step < 4; step += 1) simulation.update(0.5);
    expect(isHome(fixture, worker), `${worker.phase} at ${worker.x}/${worker.z}`).toBe(true);
    expect(woodcutter.worker).toBeUndefined();
    expect(simulation.takeStorageFades().map(fade => fade.actor)).toContain(worker.uid);
  });

  it("relocates a worker a demolition strands in an isolated area", () => {
    const fixture = staffedFarBank();
    const { simulation, woodcutter, worker } = fixture;
    fixture.cutRoads();
    // No rescan was asked for: the worker keeps its post on the isolated bank.
    for (let step = 0; step < 6; step += 1) simulation.update(0.5);
    expect(woodcutter.worker).toBe(worker.uid);
    expect(simulation.demolishBuilding(woodcutter.uid)).toBeTruthy();
    for (let elapsed = 0; elapsed < 30 && !isHome(fixture, worker); elapsed += 0.5) simulation.update(0.5);
    expect(isHome(fixture, worker), `${worker.phase} at ${worker.x}/${worker.z}`).toBe(true);
  });

  it("relocates after a load over the next ticks, identically after a load and a snapshot reload", () => {
    const live = staffedFarBank();
    live.cutRoads();
    live.simulation.update(0.05);
    const saved = JSON.parse(JSON.stringify(live.simulation.saveState()));
    const restored = staffedFarBank();
    expect(restored.simulation.loadState(saved)).toEqual({ ok: true });
    expect(live.simulation.reloadSnapshot(saved).ok).toBe(true);
    const uid = live.worker.uid;
    const body = (fixture: typeof live) => fixture.simulation.frames().find(actor => actor.uid === uid)!;
    // Not synchronous: right after the load the worker still stands on the isolated bank.
    for (const fixture of [live, restored]) expect(body(fixture).demolitionReturning).toBeFalsy();
    for (const fixture of [live, restored]) for (let tick = 0; tick < 40; tick += 1) fixture.simulation.update(0.05);
    for (const fixture of [live, restored]) expect(isHome(fixture, body(fixture))).toBe(true);
    expect({ x: body(restored).x, z: body(restored).z }).toEqual({ x: body(live).x, z: body(live).z });
    expect(restored.simulation.counterChecksum()).toBe(live.simulation.counterChecksum());
  });
});
