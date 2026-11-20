import type { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { ORDINARY_TROOP_TYPES } from "../../src/shared/settlement/military-combat-rules";
import { isHomeBuilding } from "../../src/shared/settlement/settlement-home";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";

/**
 * The headless tick fixtures over one save (A02/A10, S3+S4), shared by the tick attribution and the map script
 * cost benches. `mixed`: the save's live economy plus every free soldier marching to a banner inside the town and
 * computer foes beside it. `scaled`: the save plus `SCALED_EXTRA_CARRIERS` carriers walking home from road nodes.
 */
export type TickFixture = "owner" | "mixed" | "scaled";

const MIXED_FOES = 8;
const SCALED_EXTRA_CARRIERS = 460;

type Simulation = Awaited<ReturnType<typeof createHeadlessIsland>>["simulation"];

export const tickFixtureOf = (argument: string | undefined): TickFixture =>
  argument === "mixed" || argument === "scaled" ? argument : "owner";

/** Distinct road nodes in segment order (deterministic). */
const roadNodes = (roads: readonly { end: SettlementPoint; start: SettlementPoint }[]) => {
  const seen = new Set<string>();
  const nodes: SettlementPoint[] = [];
  for (const segment of roads) for (const point of [segment.start, segment.end]) {
    const key = `${point.x},${point.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(point);
  }
  return nodes;
};

/** A10 scale fixture: extra carriers walking home from the road nodes, written into the save. */
const applyScaledFixture = (scaled: GameSaveV1) => {
  const settlement = scaled.settlement as unknown as { actors: unknown[]; integrity: { actors: number };
    nextActor: number; roads: { end: SettlementPoint; start: SettlementPoint }[] };
  const nodes = roadNodes(settlement.roads);
  const home = (scaled.settlement.buildings.find(isHomeBuilding) ?? scaled.settlement.buildings[0])!.uid;
  for (let index = 0; index < SCALED_EXTRA_CARRIERS; index++) {
    const { x, z } = nodes[index % nodes.length]!;
    settlement.actors.push({ action: "idle", animationTime: 0, building: home, home, job: "Carrier", path: [],
      pathIndex: 0, phase: "home", queueWait: 0, timer: 0, uid: settlement.nextActor++, visible: true, ware: null,
      x, y: 2, yaw: 0, z });
  }
  settlement.integrity.actors = settlement.actors.length;
  return scaled;
};

/** The banner: the first open spot on rings around the town centre (deterministic order). */
const plantTownBanner = (simulation: Simulation) => {
  const buildings = simulation.buildings().filter(building => !(building.militaryFaction ?? 0));
  const home = buildings.find(isHomeBuilding) ?? buildings[0]!;
  const centreX = buildings.reduce((sum, building) => sum + building.x, 0) / buildings.length;
  const centreZ = buildings.reduce((sum, building) => sum + building.z, 0) / buildings.length;
  for (let radius = 4; radius <= 24; radius += 4)
    for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4;
      const point = { x: (centreX + home.x) / 2 + Math.cos(angle) * radius,
        z: (centreZ + home.z) / 2 + Math.sin(angle) * radius };
      if (simulation.plantMilitaryRally(point)) return point;
    }
  throw new Error("No open banner spot in the town");
};

const spawnFoes = (simulation: Simulation, centre: { x: number; z: number }) => {
  const foes: number[] = [];
  for (let attempt = 0; attempt < 96 && foes.length < MIXED_FOES; attempt++) {
    const angle = attempt * Math.PI / 12, radius = 7 + (attempt % 4);
    const point = { x: centre.x + Math.cos(angle) * radius, z: centre.z + Math.sin(angle) * radius };
    const id = simulation.spawnMilitaryOpponent(point, ORDINARY_TROOP_TYPES[foes.length % 3]!);
    if (id !== null) foes.push(id);
  }
  return foes;
};

export const applyMixedFixture = (simulation: Simulation) => {
  const banner = plantTownBanner(simulation);
  const types = simulation.militaryFreeTroops().filter(entry => entry.count > 0).map(entry => entry.type);
  const marching = simulation.callOutMilitary(types);
  const foes = spawnFoes(simulation, banner);
  return { banner, foes: foes.length, marching };
};

/** The save a fixture starts from (the scaled carriers are written into a copy). */
export const tickFixtureSave = (save: GameSaveV1, fixture: TickFixture) =>
  fixture === "scaled" ? applyScaledFixture(structuredClone(save)) : save;
