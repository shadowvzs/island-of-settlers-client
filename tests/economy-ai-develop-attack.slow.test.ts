import { describe, expect, it } from "vitest";

import {
  createDevelopReferenceIsland, DEVELOP_REFERENCE_MAPS, type DevelopReferenceSimulation, placeIdlePlayerSite,
  REFERENCE_AI
} from "./helpers/develop-reference-maps";

/**
 * EAI-CLOSE: a medium `develop` faction finds and attacks an idle player on the reference maps. Its scout reaches
 * the player's headquarters (start-known, owner Q3); the headquarters is never a target, so the idle player owns one
 * woodcutter beside it, the building the AI must discover and hit.
 * EASY-RAIDS (owner 2026-11-17): an easy faction makes only rare, small, late raids: none before 20 game minutes,
 * the first by 30, never a full attack (strike) and at most four soldiers.
 */
const TICKS_PER_MINUTE = 1200;
/** Ticks between two looks: an easy raid lasts well under a minute (its 45 s hit window), so look every 10 s. */
const SAMPLE_TICKS = 200;
const ATTACK_DEADLINE_MINUTES = 15;
const EASY_EARLIEST_MINUTES = 20;
const EASY_DEADLINE_MINUTES = 30;
const EASY_RAID_PARTY = 4;

const offensivesOf = (simulation: DevelopReferenceSimulation) => simulation.saveState().military?.combat?.director
  ?.factions.find(faction => faction.faction === REFERENCE_AI)?.forces
  .filter(force => force.macro === "strike" || force.macro === "raid") ?? [];

/** The faction's first strike or raid by the deadline (its game minute and force), or undefined. */
const firstOffensive = (simulation: DevelopReferenceSimulation, deadline: number) => {
  for (let ticks = SAMPLE_TICKS; ticks <= deadline * TICKS_PER_MINUTE; ticks += SAMPLE_TICKS) {
    for (let tick = 0; tick < SAMPLE_TICKS; tick++) simulation.update(.05);
    const [force] = offensivesOf(simulation);
    if (force) return { macro: force.macro, members: force.members.length, minute: ticks / TICKS_PER_MINUTE };
  }
  return undefined;
};

const referenceIsland = (map: typeof DEVELOP_REFERENCE_MAPS[number], level: "easy" | "medium") => {
  const { simulation } = createDevelopReferenceIsland(map, { level });
  placeIdlePlayerSite(simulation);
  return simulation;
};

const MAP_CASES = DEVELOP_REFERENCE_MAPS.map(map => [map.name, map] as const);

describe("develop AI attack on an idle player (EAI-CLOSE)", () => {
  it.each(MAP_CASES)("attacks the idle player's woodcutter on the %s map in time", (_name, map) => {
    const offensive = firstOffensive(referenceIsland(map, "medium"), ATTACK_DEADLINE_MINUTES);
    expect(offensive?.minute).toBeLessThanOrEqual(ATTACK_DEADLINE_MINUTES);
  }, 300_000);

  it.each(MAP_CASES)("easy raids the idle player's woodcutter late and small on the %s map", (_name, map) => {
    const offensive = firstOffensive(referenceIsland(map, "easy"), EASY_DEADLINE_MINUTES);
    expect(offensive?.minute).toBeGreaterThanOrEqual(EASY_EARLIEST_MINUTES);
    expect(offensive?.minute).toBeLessThanOrEqual(EASY_DEADLINE_MINUTES);
    expect(offensive?.macro).toBe("raid");
    expect(offensive?.members).toBeLessThanOrEqual(EASY_RAID_PARTY);
  }, 600_000);
});
