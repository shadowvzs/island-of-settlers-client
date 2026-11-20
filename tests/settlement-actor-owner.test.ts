import { describe, expect, it } from "vitest";

import { hostileCivilianEmployerError } from "../src/shared/settlement/hostile-civilian-ownership";
import { actorOwnerOf } from "../src/shared/settlement/settlement-ownership";
import { createActor } from "../src/shared/settlement/settlement-paths";
import { validateSavedActors } from "../src/shared/settlement/settlement-save-actors";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { economyScenario } from "./helpers/economy-factions";

const ENEMY = 2;

const storage = (uid: number, militaryFaction?: number) => ({
  construction: 1, doorThreshold: { x: uid, z: 1 }, idleSettlers: 2, militaryFaction, typeId: 29, uid, y: 0
}) as unknown as SettlementBuilding;

const island = (economyFactions?: readonly number[]) => ({
  actors: [], buildings: [storage(1), storage(2, ENEMY)], nextActor: 10,
  options: { world: { scenario: economyScenario(economyFactions) } },
  population: { onDuty: 0 }, settlers: 4
}) as unknown as SettlementContext;

const savedWorker = (job: string, building: number) => {
  const actor = createActor(island([ENEMY]), job, 2);
  return JSON.parse(JSON.stringify({ ...actor, building, home: building })) as SettlementActor;
};

/** EAI1b step b6: people recruited by an economy faction carry its owner; the player's never gain a field. */
describe("actor ownership", () => {
  it("marks a person recruited from an economy faction's storage and leaves the player's unmarked", () => {
    const context = island([ENEMY]);
    const worker = createActor(context, "Woodcutter", 2);
    expect(worker.hostileCivilianFaction).toBe(ENEMY);
    expect(actorOwnerOf(context, worker)).toBe(ENEMY);
    const player = createActor(context, "Woodcutter", 1);
    expect("hostileCivilianFaction" in player).toBe(false);
  });

  it("keeps a hostile depot of a faction without an economy as before", () => {
    const worker = createActor(island(), "Carrier", 2);
    expect(worker.hostileCivilianFaction).toBeUndefined();
  });

  it("never reuses a retired person of another economy (EAI1c c6)", () => {
    const context = island([ENEMY]);
    const retired = createActor(context, "Woodcutter", 2);
    retired.phase = "retired";
    expect(createActor(context, "Carrier", 1)).not.toBe(retired);
    expect(retired.hostileCivilianFaction).toBe(ENEMY);
  });

  it("accepts a saved economy worker of any civilian job only where that faction runs an economy", () => {
    const worker = savedWorker("Woodcutter", 2);
    const ids = new Set([1, 2]), economy = (faction: number) => faction === ENEMY;
    expect(validateSavedActors([worker], ids, new Set())).toBe("Invalid hostile civilian ownership");
    expect(validateSavedActors([worker], ids, new Set(), 0, economy)).toBeNull();
    expect(validateSavedActors([savedWorker("Mount", 2)], ids, new Set(), 0, economy))
      .toBe("Invalid hostile civilian ownership");
    const buildings = [storage(1), storage(2, ENEMY)];
    expect(hostileCivilianEmployerError([worker], buildings)).toBe("Invalid hostile civilian employer");
    expect(hostileCivilianEmployerError([worker], buildings, economy)).toBeUndefined();
    expect(hostileCivilianEmployerError([savedWorker("Woodcutter", 1)], buildings, economy))
      .toBe("Invalid hostile civilian employer");
  });
});
