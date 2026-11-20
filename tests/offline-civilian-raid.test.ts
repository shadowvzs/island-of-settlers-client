import { describe, expect, it } from "vitest";

import { CIVILIAN_HP, MILITARY_PROFILES } from "../src/shared/balance/military";
import {
  applyOfflineCivilianRaid, estimateOfflineRaid, OFFLINE_RAID_CATCH_SHARE, OFFLINE_RAID_ENGAGEMENT_SECONDS
} from "../src/shared/settlement/offline-civilian-raid";
import { advance, ENEMY, villageFixture } from "./helpers/military-assault-fixture";

/**
 * Fast offline catch-up (owner 2026-11-09): civilian raid losses are estimated from the raiders'
 * strength, the civilians exposed near them and the window, then applied with the exact consequences.
 */
const raidedVillage = (raiders: number) => {
  const { sim, site } = villageFixture();
  advance(sim, 15);
  const { access } = sim.headquarters;
  const middle = { x: (access.x + site.access.x) / 2, z: (access.z + site.access.z) / 2 + 1.5 };
  for (let index = 0; index < raiders; index++)
    expect(sim.spawnMilitaryOpponent({ x: middle.x + index * .8, z: middle.z }, "heavy", 0, ENEMY)).not.toBeNull();
  return sim;
};

describe("offline civilian raid estimate", () => {
  it("follows the documented formula and picks the exposed civilians nearest a raider", () => {
    const save = raidedVillage(6).saveState();
    const raid = estimateOfflineRaid(save, 3600);
    const heavy = MILITARY_PROFILES.heavy;
    const capacity = 6 * heavy.damage / heavy.interval / CIVILIAN_HP;
    expect(raid.raiders).toBe(6);
    expect(raid.exposed).toBeGreaterThan(0);
    expect(raid.losses).toBe(Math.min(raid.exposed,
      Math.floor(capacity * OFFLINE_RAID_ENGAGEMENT_SECONDS * OFFLINE_RAID_CATCH_SHARE + 1e-9)));
    // A shorter window than the engagement scales the losses down.
    expect(estimateOfflineRaid(save, 1).losses).toBeLessThanOrEqual(raid.losses);
    expect(estimateOfflineRaid(save, 0).losses).toBe(0);
  });

  it("applies the losses: the dead and their claims are gone, the casualty count grows, the save loads", () => {
    const sim = raidedVillage(6);
    const save = sim.saveState();
    const raid = applyOfflineCivilianRaid(save, 3600);
    expect(raid.losses).toBeGreaterThan(0);
    const victims = new Set(raid.victims);
    expect(save.actors.some(actor => victims.has(actor.uid))).toBe(false);
    expect(save.buildings.some(building => building.worker !== undefined && victims.has(building.worker))).toBe(false);
    expect(save.military?.combat?.civilianDeaths).toBe(raid.losses);
    expect(save.integrity?.actors).toBe(save.actors.length);
    expect(sim.loadState(save)).toEqual({ ok: true });
    advance(sim, 10);
  });

  it("changes nothing without raiders", () => {
    const { sim } = villageFixture();
    advance(sim, 15);
    const save = sim.saveState(), before = JSON.stringify(save);
    expect(applyOfflineCivilianRaid(save, 3600).losses).toBe(0);
    expect(JSON.stringify(save)).toBe(before);
  });
});
