import { describe, expect, it } from "vitest";

import {
  CIVILIAN_SIGHT, commanderSight, EXPLORER_SHIP_SIGHT, GARRISON_BUILDING_SIGHT, HEADQUARTERS_SIGHT, SCOUT_SIGHT,
  SOLDIER_SIGHT
} from "../src/shared/balance/vision";
import {
  createFactionVision, type FactionVisionSources, SIGHT_ENTER, SIGHT_LEAVE
} from "../src/shared/settlement/faction-vision";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";

const SIZE = 64;

const person = (uid: number, x: number, z: number, fields: Partial<SettlementActor> = {}) =>
  ({ job: "Carrier", uid, visible: true, x, z, ...fields }) as SettlementActor;
const building = (uid: number, typeId: number, x: number, z: number, fields: Partial<SettlementBuilding> = {}) =>
  ({ construction: 1, typeId, uid, x, z, ...fields }) as SettlementBuilding;

const island = (actors: SettlementActor[] = [], buildings: SettlementBuilding[] = [],
  soldiers = new Map<number, SettlementSoldier>()): FactionVisionSources & { actors: SettlementActor[] } => ({
  actors, buildings, military: { soldierOf: uid => soldiers.get(uid) }, playerNation: "roman"
});

/** Cells of `faction` seen along the row through `z`, right of `x` (the reach of a disk centred there). */
const reachRight = (vision: ReturnType<typeof createFactionVision>, faction: number, x: number, z: number) => {
  let reach = 0;
  while (vision.sees(faction, x + reach + 1, z)) reach++;
  return reach;
};

const total = (layer: Readonly<Uint16Array> | undefined) => layer?.reduce((sum, value) => sum + value, 0) ?? 0;

describe("faction vision layer", () => {
  it("stamps an integer disk round the observer's cell", () => {
    const vision = createFactionVision(SIZE, SIZE);
    vision.update(island([person(1, 20.5, 20.5)]));
    expect(vision.observersAt(0, 20.5, 20.5)).toBe(1);
    expect(vision.sees(0, 20.5 + CIVILIAN_SIGHT, 20.5)).toBe(true);
    expect(vision.sees(0, 21.5 + CIVILIAN_SIGHT, 20.5)).toBe(false);
    // 8² + 8² = 128 <= 144 is inside; 9² + 8² = 145 is outside.
    expect(vision.sees(0, 28.5, 28.5)).toBe(true);
    expect(vision.sees(0, 29.5, 28.5)).toBe(false);
    expect(vision.sees(1, 20.5, 20.5)).toBe(false);
  });

  it("restamps only when an observer changes cell", () => {
    const actor = person(1, 20.1, 20.1), sources = island([actor]);
    const vision = createFactionVision(SIZE, SIZE);
    vision.update(sources);
    actor.x = 20.9; actor.z = 20.8;
    vision.update(sources);
    expect(vision.stats().restamps).toBe(1);
    actor.x = 30.5;
    vision.update(sources);
    expect(vision.stats().restamps).toBe(2);
    expect(vision.sees(0, 20.5 - CIVILIAN_SIGHT, 20.5)).toBe(false);
    expect(vision.observersAt(0, 30.5, 20.5)).toBe(1);
    expect(total(vision.layer(0))).toBe(total(createRebuilt(sources).layer(0)));
  });

  it("counts overlapping observers and clips at the map edge", () => {
    const vision = createFactionVision(SIZE, SIZE);
    vision.update(island([person(1, .5, .5), person(2, 2.5, .5)]));
    expect(vision.observersAt(0, 1.5, .5)).toBe(2);
    expect(vision.sees(0, .5 + CIVILIAN_SIGHT, .5)).toBe(true);
    expect(vision.sees(0, -1, .5)).toBe(false);
  });

  it("takes each unit kind's sight radius", () => {
    const soldiers = new Map<number, SettlementSoldier>([
      [2, { actor: 2, building: -1, rank: 0, stationed: false, combat: { cooldown: 0, faction: 1, hp: 1,
        type: "archer" } }],
      [3, { actor: 3, building: -1, rank: 0, stationed: false, combat: { cooldown: 0, faction: 1, hp: 1,
        type: "shield" } }],
      [4, { actor: 4, building: -1, commanderId: "c", rank: 0, stationed: false }]
    ]);
    const actors = [person(1, 10.5, 10.5, { job: "Scout" }), person(2, 10.5, 30.5, { job: "Soldier" }),
      person(3, 10.5, 50.5, { job: "Soldier" }), person(4, 40.5, 45.5, { job: "Soldier" }),
      person(5, 40.5, 30.5, { hostileCivilianFaction: 3 })];
    const vision = createFactionVision(SIZE, SIZE);
    vision.update(island(actors, [], soldiers));
    expect(reachRight(vision, 0, 10.5, 10.5)).toBe(SCOUT_SIGHT);
    expect(reachRight(vision, 1, 10.5, 30.5)).toBe(SOLDIER_SIGHT.archer);
    expect(reachRight(vision, 1, 10.5, 50.5)).toBe(SOLDIER_SIGHT.shield);
    expect(Math.min(SIZE - 41, commanderSight("roman"))).toBe(reachRight(vision, 0, 40.5, 45.5));
    expect(reachRight(vision, 3, 40.5, 30.5)).toBe(CIVILIAN_SIGHT);
    // Owner 2026-11-13: civilians keep today's 12-tile reveal; soldiers 11/13, commander and scout 18.
    expect(CIVILIAN_SIGHT).toBe(12);
    expect(SOLDIER_SIGHT.archer).toBeGreaterThan(SOLDIER_SIGHT.shield);
    expect(commanderSight("roman")).toBeGreaterThan(SOLDIER_SIGHT.archer);
  });

  it("lets finished headquarters and garrisoned buildings see; empty towers and lookouts are blind", () => {
    const sites = [building(1, 0, 10.5, 10.5), building(2, 4, 40.5, 40.5, { militaryFaction: 2 }),
      building(3, 4, 80.5, 10.5, { construction: .5 }), building(4, 14, 10.5, 80.5, { worker: 9 }),
      building(5, 4, 80.5, 80.5)];
    const inside = person(8, 40.5, 40.5, { building: 2, job: "Soldier", phase: "garrison", visible: false });
    const scout = person(9, 10.5, 80.5, { building: 4, job: "Scout", phase: "inside", visible: false });
    const sources = island([inside, scout], sites);
    const vision = createFactionVision(128, 128);
    vision.update(sources);
    expect(reachRight(vision, 0, 10.5, 10.5)).toBeGreaterThanOrEqual(HEADQUARTERS_SIGHT);
    expect(reachRight(vision, 2, 40.5, 40.5)).toBe(GARRISON_BUILDING_SIGHT);
    expect(vision.sees(0, 80.5, 10.5)).toBe(false); // Unfinished tower.
    expect(vision.sees(0, 10.5, 80.5)).toBe(false); // The lookout only charts (player-fog.ts).
    expect(vision.sees(0, 80.5, 80.5)).toBe(false); // Finished but empty tower.
    expect(vision.stats().buildingObservers).toBe(2);
    sources.actors.splice(0, 1);
    vision.update(sources);
    expect(total(vision.layer(2))).toBe(0); // The last soldier left: the tower is blind again.
  });

  it("lets exploration ships under way see", () => {
    const ships = [{ exploration: {}, id: 1, phase: "sailing", x: 20.5, z: 20.5 },
      { exploration: {}, id: 2, phase: "idle", x: 40.5, z: 40.5 },
      { id: 3, phase: "sailing", x: 50.5, z: 20.5 }] as unknown as NavalShip[];
    const vision = createFactionVision(SIZE, SIZE);
    vision.update({ ...island(), naval: { explorerShips: () => ships } });
    expect(reachRight(vision, 0, 20.5, 20.5)).toBe(EXPLORER_SHIP_SIGHT);
    expect(vision.sees(0, 40.5, 40.5)).toBe(false);
    expect(vision.sees(0, 50.5, 20.5)).toBe(false); // Not an exploration ship.
    expect(vision.stats().shipObservers).toBe(1);
    ships[0]!.phase = "away";
    vision.update({ ...island(), naval: { explorerShips: () => ships } });
    expect(total(vision.layer(0))).toBe(0);
  });

  it("removes the sight of dead, hidden and removed units", () => {
    const actors = [person(1, 10.5, 10.5), person(2, 30.5, 30.5), person(3, 50.5, 50.5)];
    const sources = island(actors);
    const vision = createFactionVision(SIZE, SIZE);
    vision.update(sources);
    actors[0]!.visible = false; actors[0]!.phase = "militaryDead";
    actors.splice(1, 1);
    vision.update(sources);
    expect(vision.sees(0, 10.5, 10.5)).toBe(false);
    expect(vision.sees(0, 30.5, 30.5)).toBe(false);
    expect(vision.sees(0, 50.5, 50.5)).toBe(true);
    actors.length = 0;
    vision.update(sources);
    expect(total(vision.layer(0))).toBe(0);
    expect(vision.stats().actorObservers).toBe(0);
  });

  it("follows a faction change of a captured building", () => {
    const site = building(1, 4, 20.5, 20.5, { militaryFaction: 2 });
    const sources = island([person(2, 20.5, 20.5, { building: 1, job: "Soldier", phase: "garrison", visible: false })],
      [site]);
    const vision = createFactionVision(SIZE, SIZE);
    vision.update(sources);
    site.militaryFaction = undefined;
    vision.update(sources);
    expect(total(vision.layer(2))).toBe(0);
    expect(vision.sees(0, 20.5, 20.5)).toBe(true);
  });

  it("matches a fresh rebuild after a long random walk", () => {
    const actors = Array.from({ length: 40 }, (_, index) => person(index + 1, 32, 32,
      { hostileCivilianFaction: index % 3 || undefined }));
    const sources = island(actors);
    const vision = createFactionVision(SIZE, SIZE);
    let seed = 7;
    const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let tick = 0; tick < 400; tick++) {
      for (const actor of actors) {
        actor.x = Math.min(SIZE - .01, Math.max(0, actor.x + (random() - .5) * 1.5));
        actor.z = Math.min(SIZE - .01, Math.max(0, actor.z + (random() - .5) * 1.5));
        actor.visible = random() > .05;
      }
      vision.update(sources);
    }
    const rebuilt = createRebuilt(sources);
    for (const faction of [0, 1, 2]) expect(vision.layer(faction)).toEqual(rebuilt.layer(faction));
  });
});

describe("computer sight changes (A14-4b)", () => {
  it("queues a computer observer's new and old disks, never the player's, and nothing on a rebuild", () => {
    const soldiers = new Map<number, SettlementSoldier>([[2, { actor: 2, building: -3, rank: 0, stationed: false,
      combat: { cooldown: 0, faction: 1, hp: 100, type: "shield" } } as SettlementSoldier]]);
    const guard = person(2, 10.5, 10.5, { job: "Soldier" }), sources = island([person(1, 30.5, 30.5), guard], [],
      soldiers);
    const vision = createFactionVision(SIZE, SIZE);
    const drained = () => {
      const changes: number[][] = [];
      expect(vision.drainSightChanges((...change) => changes.push(change))).toBe(true);
      return changes;
    };
    vision.update(sources);
    expect(drained()).toEqual([[1, 10 * SIZE + 10, SOLDIER_SIGHT.shield, SIGHT_ENTER]]);
    guard.x = 20.5;
    vision.update(sources);
    expect(drained()).toEqual([[1, 10 * SIZE + 20, SOLDIER_SIGHT.shield, SIGHT_ENTER],
      [1, 10 * SIZE + 10, SOLDIER_SIGHT.shield, SIGHT_LEAVE]]);
    vision.update(sources);
    expect(drained()).toEqual([]);
    vision.rebuild(sources);
    expect(drained()).toEqual([]);
  });
});

const createRebuilt = (sources: FactionVisionSources) => {
  const vision = createFactionVision(SIZE, SIZE);
  vision.rebuild(sources);
  return vision;
};
