import { describe, expect, it } from "vitest";

import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { playerHoldings } from "../src/shared/settlement/plausibility-bounds";
import {
  advance, type AssaultSimulation as Simulation, crew, enemies, ENEMY, mannedFixture, playerSoldiers,
  sendAttackGroup, siteDoor as towerDoor, standing
} from "./helpers/military-assault-fixture";

/** Every player stone: building stocks, carried loads and the pooled storage balance. */
const stoneHeld = (sim: Simulation) => {
  const settlement = sim.saveState();
  const pooled = settlement.storagePools?.pools.reduce((sum, pool) => sum + (pool.available.stone ?? 0), 0) ?? 0;
  return pooled + (playerHoldings({ settlement } as unknown as GameSaveV1).stone ?? 0);
};

describe("CAT-CAPTURE: enemy attack on a player Catapult Tower", () => {
  it("fights the crew at the door, then burns the undefended tower down instead of capturing it", () => {
    const { sim, site } = mannedFixture(16);
    for (let second = 0; second < 240 && catapultLocalStone(site) < 3; second++) advance(sim, 1);
    expect(crew(sim, site.uid).map(soldier => soldier.combat?.type).sort()).toEqual(["heavy", "shield"]);
    expect(site.worker).toBeDefined();
    const stoneBefore = stoneHeld(sim), towerStone = catapultLocalStone(site), defenders = playerSoldiers(sim);
    const ids = sendAttackGroup(sim, site.access);
    const boulders = new Set<number>();
    let allJoined = false, captured = false, crewLost = false, fallenAt = -1;
    for (let second = 0; second < 600 && standing(sim, site.uid); second++) {
      for (let tick = 0; tick < 20; tick++) {
        sim.update(.05);
        for (const shot of sim.militaryArrows()) if (shot.boulder && shot.faction === 0) boulders.add(shot.id);
      }
      const door = towerDoor(sim, site.uid), live = sim.buildings().find(entry => entry.uid === site.uid);
      captured ||= door?.faction === ENEMY || (live?.militaryFaction ?? 0) !== 0;
      allJoined ||= enemies(sim).filter(soldier => soldier.combat?.siege === site.uid).length === ids.length;
      crewLost ||= playerSoldiers(sim) < defenders;
      if (fallenAt >= 0 || door?.structure?.hp !== 0) continue;
      fallenAt = second;
      expect(live?.catapultCycle).toBeUndefined();
    }
    expect({ allJoined, captured, crewLost }).toEqual({ allJoined: true, captured: false, crewLost: true });
    expect(fallenAt).toBeGreaterThan(0);
    expect(standing(sim, site.uid)).toBe(false);
    expect(towerDoor(sim, site.uid)).toBeUndefined();
    expect(sim.militarySoldiers().some(soldier => soldier.building === site.uid)).toBe(false);
    // The ruin's roof rack and ground pile are salvaged through the ordinary demolition path.
    expect(towerStone).toBeGreaterThan(0);
    expect(stoneHeld(sim)).toBe(stoneBefore - boulders.size);
    expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
  }, 120_000);

  // Upload parity reloads in place (determinism-gaps evaluation, option A-lite): every load of the same
  // checkpoint must continue identically, through the door fight, the wall assault and the fall.
  it("continues identically from every load of a save taken while the walls are being struck", () => {
    const { sim, site } = mannedFixture(16);
    advance(sim, 30);
    sendAttackGroup(sim, site.access);
    const structure = () => towerDoor(sim, site.uid)?.structure;
    for (let second = 0; second < 400 && structure()?.hp === structure()?.maximum; second++) advance(sim, 1);
    expect(structure()!.hp).toBeLessThan(structure()!.maximum);
    const checkpoint = JSON.stringify(sim.saveState());
    const resume = () => {
      expect(sim.loadState(JSON.parse(checkpoint))).toEqual({ ok: true });
      advance(sim, 90);
      return JSON.stringify(sim.saveState());
    };
    const first = resume();
    expect(standing(sim, site.uid)).toBe(false);
    expect(resume()).toBe(first);
  }, 120_000);
});
