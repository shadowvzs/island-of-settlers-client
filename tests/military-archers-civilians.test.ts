import { describe, expect, it } from "vitest";

import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";
import {
  advance, type AssaultSimulation, ENEMY, mannedFixture, sendAttackGroup, siteDoor, standing
} from "./helpers/military-assault-fixture";

/**
 * MIL-ASSAULT (owner 2026-11-08): a computer archer shoots a civilian of a destroyed player military
 * building (outside, so attackable) once every soldier target is gone, with a real arrow.
 */
const woundedNow = (sim: AssaultSimulation) => sim.saveState().military?.combat?.woundedCivilians ?? [];
const bodyOf = (sim: AssaultSimulation, uid: number) => sim.frames().find(actor => actor.uid === uid);

/** A ring of archer places ~4 tiles around the staff, inside the short civilian range. */
const ARCHER_OFFSETS: readonly SettlementPoint[] = [
  { x: -4, z: 0 }, { x: 4, z: 0 }, { x: 0, z: -4 }, { x: 0, z: 4 },
  { x: -3, z: -3 }, { x: 3, z: 3 }, { x: -3, z: 3 }, { x: 3, z: -3 }
];

const spawnArchers = (sim: AssaultSimulation, staff: SettlementPoint) => {
  const archers: number[] = [];
  for (const offset of ARCHER_OFFSETS) {
    if (archers.length >= 4) break;
    const id = sim.spawnMilitaryOpponent({ x: staff.x + offset.x, z: staff.z + offset.z }, "archer", 0, ENEMY);
    if (id !== null) archers.push(id);
  }
  return archers;
};

describe("MIL-ASSAULT: computer archers shoot civilians outside buildings", () => {
  it("looses real arrows at the staff of a fallen tower and kills it, deterministically", () => {
    const { sim, site } = mannedFixture(16);
    for (let second = 0; second < 240 && catapultLocalStone(site) < 3; second++) advance(sim, 1);
    const staff = site.worker!;
    expect(staff).toBeDefined();
    const attackers = sendAttackGroup(sim, site.access, 12, 2);
    // The tower falls; its ruin is cleared (and the staff steps out) ten seconds later.
    let attackTicks = 0;
    while (attackTicks < 12_000 && siteDoor(sim, site.uid)?.structure?.hp !== 0) {
      sim.update(.05); attackTicks++;
    }
    expect(siteDoor(sim, site.uid)?.structure?.hp).toBe(0);
    // Send the melee attackers away while the ruin still burns: their retreat ignores civilians.
    expect(sim.commandMilitaryOpponent(attackers, { x: 40, z: 40 }, ENEMY, "retreat")).toBe(true);
    let removedTicks = 0;
    while (removedTicks < 400 && standing(sim, site.uid)) { sim.update(.05); removedTicks++; }
    expect(standing(sim, site.uid)).toBe(false);
    // Wait until the evacuated staff is out of the catacombs.
    for (let tick = 0; tick < 400 && !bodyOf(sim, staff)?.visible; tick++) sim.update(.05);
    const staffBody = bodyOf(sim, staff);
    expect(staffBody).toBeDefined();
    const archers = spawnArchers(sim, staffBody!);
    expect(archers.length).toBeGreaterThan(0);
    // Only archers do the killing: every old attacker is fallen or retreating (it ignores civilians).
    for (const id of attackers) {
      const attacker = sim.militarySoldiers().find(soldier => soldier.actor === id);
      if (attacker) expect(attacker.combat?.order).toBe("retreat");
    }
    let arrowSeen = false, ticksToDeath = -1, ticksSinceSave = 0;
    let saved: ReturnType<AssaultSimulation["saveState"]> | undefined;
    for (let tick = 0; tick < 1800 && bodyOf(sim, staff); tick++) {
      sim.update(.05);
      if (!arrowSeen && sim.militaryArrows().length > 0) {
        arrowSeen = true;
        saved = JSON.parse(JSON.stringify(sim.saveState()));
        ticksSinceSave = 0;
      } else if (saved) ticksSinceSave++;
    }
    expect(arrowSeen).toBe(true);
    expect(bodyOf(sim, staff)).toBeUndefined();
    expect(woundedNow(sim).some(entry => entry.actor === staff)).toBe(false);
    expect(sim.saveState().military?.combat?.civilianDeaths).toBeGreaterThan(0);
    expect(saved).toBeDefined();
    ticksToDeath = ticksSinceSave;
    // The save was taken mid-shot: replaying it kills the staff on the very same tick.
    expect(sim.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    expect(bodyOf(sim, staff)).toBeDefined();
    for (let tick = 0; tick < ticksToDeath; tick++) sim.update(.05);
    expect(bodyOf(sim, staff)).toBeUndefined();
    expect(woundedNow(sim).some(entry => entry.actor === staff)).toBe(false);
  }, 240_000);
});
