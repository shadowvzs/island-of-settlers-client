import { expect, it } from "vitest";

import { NATION_DRINK_CHAINS } from "../src/shared/settlement/nation-drinks";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { migrateSettlementNation } from "../src/shared/settlement/settlement-nation-migration";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

it("preserves goods, crops, paid receipts and reservations through every nation pair and reload", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 48, cellsZ: 48, erosionDroplets: 0 });
  const sim = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const nations = Object.keys(NATION_DRINK_CHAINS) as Array<keyof typeof NATION_DRINK_CHAINS>;
  for (const from of nations) for (const to of nations) {
    const previous = NATION_DRINK_CHAINS[from], next = NATION_DRINK_CHAINS[to];
    const save = sim.saveState();
    save.playerNation = from;
    const pool = save.storagePools.pools.find(entry => entry.id === save.buildings[0]!.storagePoolId)!;
    pool.available = { [previous.raw]: 3, [previous.drink]: 4, beer: 2, hammer: 1 };
    save.fields = [{ id: 1, owner: save.buildings[0]!.uid, kind: previous.plantation,
      x: 20.5, z: 20.5, state: "growing", progress: .5, step: 0 }];
    const migrated = migrateSettlementNation(save, to);
    expect(migrated.storagePools.pools.find(entry => entry.id === pool.id)!.available).toEqual({ [next.raw]: 3, [next.drink]: 4, beer: 2, hammer: 1 });
    expect(migrated.fields[0]).toMatchObject({ id: 1, kind: next.plantation, progress: .5 });
    expect(save.playerNation).toBe(from);
    expect(pool.available[previous.raw]).toBe(3);
    expect(sim.loadState(migrated)).toEqual({ ok: true });
    expect(sim.saveState().fields[0]!.kind).toBe(next.plantation);
    expect(sim.setPlayerNation(from)).toBe(true);
    expect(sim.storageSnapshot(sim.headquarters.uid)!.available).toEqual({ [previous.raw]: 3, [previous.drink]: 4, beer: 2, hammer: 1 });
  }
});
