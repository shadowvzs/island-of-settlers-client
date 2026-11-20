import { describe, expect, it } from "vitest";

import { clearIslandRoadGround } from "../src/app/settlement/island-road-clearance";
import { fitRoadsideCover } from "../src/render-common/props/field-cover-exclusions";
import { flareBridgeApproaches } from "../src/shared/settlement/bridge-approaches";
import { bridgeFootprint, insideBridgeFootprint } from "../src/shared/settlement/bridge-footprint";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { createAngledBridgeSettlement, createBridgeSettlement } from "./helpers/bridge-settlement";

/** Every vegetation prop the island can scatter near a river, in one dense grid over the fixture. */
const PLANTS = [PROP.reeds, PROP.cattail, PROP.waterLily, PROP.sedge, PROP.fern, PROP.flowers, PROP.bush,
  PROP.riverShrub, PROP.willowShrub, PROP.berryBush, PROP.broadleafShrub, PROP.fieldShrub, PROP.mushrooms];

const scatterPlants = (world: WorldData) => {
  const xs: number[] = [], zs: number[] = [], types: number[] = [];
  for (let z = 6.1; z < 26; z += 0.37) for (let x = 2.1; x < 26; x += 0.41) {
    xs.push(x); zs.push(z); types.push(PLANTS[types.length % PLANTS.length]!);
  }
  const count = xs.length;
  world.props = {
    count, form: new Uint8Array(count), phase: new Float32Array(count), rotation: new Float32Array(count),
    scale: new Float32Array(count).fill(1), types: Uint8Array.from(types), x: Float32Array.from(xs),
    y: new Float32Array(count), z: Float32Array.from(zs)
  } as WorldData["props"];
  // Prop removal refreshes the build class around each freed cell, which reads the slope layer.
  world.slopeClass ??= new Uint8Array(world.cellsX * world.cellsZ);
};

const remainingInside = (world: WorldData, segments: readonly RoadSegment[]) => {
  const footprint = bridgeFootprint(segments, world)!;
  const inside: { type: number; x: number; z: number }[] = [];
  for (let index = 0; index < world.props.count; index += 1) {
    const type = world.props.types[index]!, x = world.props.x[index]!, z = world.props.z[index]!;
    if (type !== PROP_REMOVED && insideBridgeFootprint(footprint, x, z)) inside.push({ type, x, z });
  }
  return inside;
};

/** Without a renderer the clearance updates the shared field cover exclusions directly. */
const NO_RENDERER = {} as Parameters<typeof clearIslandRoadGround>[1];

const tuft = (x: number, z: number) => ({ scale: 1, stretch: 1, x, z });

describe("no vegetation grows on a bridge", () => {
  it("clears plants, reeds and grass tufts from a completed straight bridge, its abutments and ramps", () => {
    const fixture = createBridgeSettlement();
    const world = fixture.world as WorldData;
    const plan = fixture.simulation.previewBridge(fixture.pointer, "stone", fixture.leftAnchor).plan!;
    const roads = flareBridgeApproaches([...fixture.roads.segments(), ...plan.segments]);
    scatterPlants(world);
    const before = remainingInside(world, roads).length;
    expect(before).toBeGreaterThan(50);
    clearIslandRoadGround(world, NO_RENDERER, roads);
    expect(remainingInside(world, roads)).toEqual([]);
    // Wading plants away from the bridge stay: only the bridge clears reeds and cattails.
    let reedsLeft = 0;
    for (let index = 0; index < world.props.count; index += 1)
      if (world.props.types[index] === PROP.cattail || world.props.types[index] === PROP.reeds) reedsLeft += 1;
    expect(reedsLeft).toBeGreaterThan(20);
    const footprint = bridgeFootprint(roads, world)!;
    for (let z = 10; z < 22; z += 0.23) for (let x = 5; x < 16; x += 0.29) {
      if (!insideBridgeFootprint(footprint, x, z)) continue;
      expect(fitRoadsideCover(world, tuft(x, z)), `tuft at ${x}/${z}`).toBeUndefined();
    }
    expect(fitRoadsideCover(world, tuft(3, 8))).toBeDefined();
  });

  it("clears the footprint of an angled bridge while it is still a construction site", () => {
    const fixture = createAngledBridgeSettlement();
    const world = fixture.world as WorldData;
    const built = fixture.simulation.buildBridge(fixture.pointer, "wood", fixture.westAnchor);
    expect(built.ok).toBe(true);
    const sites = fixture.simulation.bridgeConstructions().flatMap(site => site.segments);
    const roads = fixture.roads.segments();
    expect(roads.some(segment => segment.bridge)).toBe(false);
    scatterPlants(world);
    expect(remainingInside(world, [...roads, ...sites]).length).toBeGreaterThan(50);
    clearIslandRoadGround(world, NO_RENDERER, roads, sites);
    expect(remainingInside(world, [...roads, ...sites])).toEqual([]);
    const footprint = bridgeFootprint([...roads, ...sites], world)!;
    const deckCentre = { x: (sites[0]!.start.x + sites.at(-1)!.end.x) / 2, z: (sites[0]!.start.z + sites.at(-1)!.end.z) / 2 };
    expect(insideBridgeFootprint(footprint, deckCentre.x, deckCentre.z)).toBe(true);
    expect(fitRoadsideCover(world, tuft(deckCentre.x, deckCentre.z))).toBeUndefined();
  });
});
