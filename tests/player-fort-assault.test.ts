import { describe, expect, it } from "vitest";

import {
  advance, type AssaultSimulation, crew, ENEMY, enemies, mannedFixture, playerSoldiers, sendAttackGroup, siteDoor,
  standing
} from "./helpers/military-assault-fixture";

/**
 * MIL-ASSAULT (owner 2026-11-08): the computer attacks the player's Barracks, Guardhouse, Watchtower
 * and Fortress through the shared siege path. The garrison defends at the door; once it is beaten the
 * walls are struck, and at 0 HP the building burns down (never captured, like the Catapult Tower).
 */
const BUILDINGS = [[1, "Barracks"], [2, "Guardhouse"], [4, "Watchtower"], [9, "Fortress"]] as const;

/** A manned building: waits for its garrison, then returns the stationed count. */
const manned = (sim: AssaultSimulation, uid: number) => {
  for (let second = 0; second < 240 && crew(sim, uid).length === 0; second++) advance(sim, 1);
  advance(sim, 20);
  return crew(sim, uid).length;
};

interface AssaultLog { captured: boolean; fallenAt: number; fortifiedAt: number; garrisonLost: boolean }

/** Runs the assault second by second until the building is gone (or `limit` seconds pass). */
const runAssault = (sim: AssaultSimulation, uid: number, limit: number) => {
  const defenders = playerSoldiers(sim);
  const log: AssaultLog = { captured: false, fallenAt: -1, fortifiedAt: -1, garrisonLost: false };
  for (let second = 0; second < limit && standing(sim, uid); second++) {
    advance(sim, 1);
    const door = siteDoor(sim, uid), live = sim.buildings().find(entry => entry.uid === uid);
    if (door && log.fortifiedAt < 0) log.fortifiedAt = second;
    log.captured ||= (door?.faction ?? 0) !== 0 || (live?.militaryFaction ?? 0) !== 0;
    log.garrisonLost ||= playerSoldiers(sim) < defenders;
    if (log.fallenAt < 0 && door?.structure?.hp === 0) log.fallenAt = second;
  }
  return log;
};

describe("MIL-ASSAULT: enemy attack on the player's military buildings", () => {
  it.each(BUILDINGS)("type %i (%s): fortified on attack, garrison fights, then burns down, never captured",
    (typeId) => {
      const { sim, site } = mannedFixture(typeId);
      expect(manned(sim, site.uid)).toBeGreaterThan(0);
      // Never attacked: no door, no ownership marker (identical state to before this change).
      expect(siteDoor(sim, site.uid)).toBeUndefined();
      expect(site.militaryFaction).toBeUndefined();
      sendAttackGroup(sim, site.access, 12, 2);
      const log = runAssault(sim, site.uid, 900);
      expect(log).toMatchObject({ captured: false, garrisonLost: true });
      expect(log.fortifiedAt).toBeGreaterThanOrEqual(0);
      expect(log.fallenAt).toBeGreaterThan(log.fortifiedAt);
      expect(standing(sim, site.uid)).toBe(false);
      expect(siteDoor(sim, site.uid)).toBeUndefined();
      expect(sim.militarySoldiers().some(soldier => soldier.building === site.uid)).toBe(false);
      expect(enemies(sim).length).toBeGreaterThan(0);
      expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
    }, 240_000);

  it("continues identically from every load of a save taken during the Watchtower door fight", () => {
    const { sim, site } = mannedFixture(4);
    expect(manned(sim, site.uid)).toBeGreaterThan(0);
    sendAttackGroup(sim, site.access, 12, 2);
    const garrison = crew(sim, site.uid).length;
    for (let second = 0; second < 300 && crew(sim, site.uid).length === garrison; second++) advance(sim, 1);
    expect(siteDoor(sim, site.uid)?.structure).toBeDefined();
    const checkpoint = JSON.stringify(sim.saveState());
    const resume = () => {
      expect(sim.loadState(JSON.parse(checkpoint))).toEqual({ ok: true });
      advance(sim, 60);
      return JSON.stringify(sim.saveState());
    };
    const first = resume();
    expect(resume()).toBe(first);
  }, 240_000);

  it("leaves a Watchtower that is never attacked untouched while enemies fight elsewhere", () => {
    const { sim, site } = mannedFixture(4);
    manned(sim, site.uid);
    const ids = [0, 1, 2].map(index => sim.spawnMilitaryOpponent({ x: 52 + index, z: 52 }, "heavy", 0, ENEMY));
    expect(ids.every(id => id !== null)).toBe(true);
    advance(sim, 60);
    expect(siteDoor(sim, site.uid)).toBeUndefined();
    expect(sim.buildings().find(entry => entry.uid === site.uid)?.militaryFaction).toBeUndefined();
  }, 120_000);
});
