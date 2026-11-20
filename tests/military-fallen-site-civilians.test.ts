import { describe, expect, it } from "vitest";

import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { CIVILIAN_THREAT_RADIUS } from "../src/shared/settlement/military-civilian-safety";
import {
  advance, type AssaultSimulation, crew, enemies, mannedFixture, sendAttackGroup, siteDoor, standing
} from "./helpers/military-assault-fixture";

/**
 * MIL-ASSAULT (owner 2026-11-08/09): when a player military building is destroyed, the people who
 * were at it lose its protection. Its civilians step out and, like every civilian outside a
 * building, are attacked; they flee to a safe storage (owner 2026-11-09) unless the attackers catch them.
 */
const combatOf = (sim: AssaultSimulation) => sim.saveState().military?.combat;

describe("MIL-ASSAULT: civilians at a destroyed player building", () => {
  it("leaves the Catapult Tower's staff outside the ruin, where they are killed or flee out of reach", () => {
    const { sim, site } = mannedFixture(16);
    for (let second = 0; second < 240 && catapultLocalStone(site) < 3; second++) advance(sim, 1);
    expect(crew(sim, site.uid).length).toBeGreaterThan(0);
    const staff = site.worker!;
    expect(staff).toBeDefined();
    sendAttackGroup(sim, site.access, 12, 2);
    let removedAt = -1;
    for (let second = 0; second < 600 && removedAt < 0; second++) {
      advance(sim, 1);
      if (!standing(sim, site.uid)) removedAt = second;
    }
    expect(removedAt).toBeGreaterThan(0);
    expect(siteDoor(sim, site.uid)).toBeUndefined();
    // A save while the staff is in danger round-trips.
    const checkpoint = JSON.stringify(sim.saveState());
    expect(sim.loadState(JSON.parse(checkpoint))).toEqual({ ok: true });
    // In danger: outside and within reach of an attacker. Out of danger: dead, indoors, or out of reach
    // (no storage is safe while the attackers stand at the headquarters, so it waits in the open).
    const inDanger = () => {
      const body = sim.frames().find(actor => actor.uid === staff && actor.visible);
      return Boolean(body) && enemies(sim).some(soldier => {
        const enemy = sim.frames().find(actor => actor.uid === soldier.actor);
        return enemy && Math.hypot(enemy.x - body!.x, enemy.z - body!.z) <= CIVILIAN_THREAT_RADIUS;
      });
    };
    for (let second = 0; second < 90 && inDanger(); second++) advance(sim, 1);
    expect(inDanger()).toBe(false);
    const killed = !sim.frames().some(actor => actor.uid === staff);
    expect(combatOf(sim)?.civilianDeaths ?? 0).toBe(killed ? 1 : 0);
    expect(combatOf(sim)?.woundedCivilians?.some(entry => entry.actor === staff) ?? false).toBe(false);
    expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
  }, 240_000);
});
