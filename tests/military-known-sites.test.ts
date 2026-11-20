import { describe, expect, it, vi } from "vitest";

import {
  SCOUT_AGE_TICKS, SCOUT_GOALS, SECTOR_TILES, SITE_CERTAINTY_TICKS
} from "../src/shared/balance/commander-director";
import { GARRISON_CAPACITIES } from "../src/shared/balance/military";
import { type DirectorTraceRecord, setDirectorTraceSink } from "../src/shared/settlement/commander/director-trace";
import { type KnownSite, siteDefenceEstimate } from "../src/shared/settlement/commander/known-sites";
import { createFactionKnowledge, factionKnowledgeSaveError } from "../src/shared/settlement/faction-knowledge";
import { createFactionVision } from "../src/shared/settlement/faction-vision";
import {
  probeSiteRead, setVisionProbe, visionProbeReport
} from "../src/shared/settlement/faction-vision-probe";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { placeFinished } from "../tools/bench/garrison-balance-harness";
import { struckColony } from "./helpers/struck-colony";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/** A14-4b strategic knowledge: known-sites ledger, sector staleness, scout plans, raids on known sites only. */
const ENEMY = 1;
const SIZE = 96;
const GUARDHOUSE = 2;
const WOODCUTTER = 17;

/** One computer soldier walking a 96² island with a player Guardhouse (two inside) and a Woodcutter. */
const island = () => {
  let tick = 0;
  const scout = { job: "Soldier", phase: "militaryField", uid: 9, visible: true, x: 80.5, z: 8.5 } as SettlementActor;
  const soldier = { actor: 9, building: -3, combat: { cooldown: 0, faction: ENEMY, hp: 100, type: "shield" },
    rank: 0, stationed: false } as SettlementSoldier;
  const guardhouse = { access: { x: 20, z: 23 }, militaryFaction: 0, typeId: GUARDHOUSE, uid: 40, x: 20, z: 20 };
  const woodcutter = { access: { x: 60, z: 63 }, militaryFaction: 0, typeId: WOODCUTTER, uid: 41, x: 60, z: 60 };
  const buildings = [guardhouse, woodcutter];
  const vision = createFactionVision(SIZE, SIZE);
  const sources = { military: { soldierOf: (uid: number) => uid === 9 ? soldier : undefined } };
  const garrison = (uid: number) => uid === 40 ? { count: 2, strength: 180 } : undefined;
  const knowledge = createFactionKnowledge({ buildings: () => buildings, garrison, now: () => tick,
    sees: () => vision.sees, units: () => [], vision: () => vision });
  const walk = (x: number, z: number, ticks = 1) => {
    scout.x = x; scout.z = z;
    for (let step = 0; step < ticks; step++) {
      vision.update({ actors: [scout], buildings: [], ...sources });
      knowledge.observe();
      tick++;
    }
  };
  return { buildings, guardhouse, knowledge, now: () => tick, vision, walk, woodcutter };
};

describe("known-sites ledger", () => {
  it("records a site when first seen, dates its last sighting when it leaves sight and counts its garrison", () => {
    const { guardhouse, knowledge, walk } = island();
    walk(80.5, 8.5, 5);
    expect(knowledge.knowsBuilding(ENEMY, guardhouse)).toBe(false);
    walk(24.5, 20.5);
    const record = knowledge.strategic.site(ENEMY, guardhouse.uid)!;
    expect(record).toMatchObject({ firstKnownTick: 5, garrisonSeen: 2, strengthSeen: 180, type: GUARDHOUSE });
    walk(24.5, 21.5, 10);
    expect(record.firstKnownTick).toBe(5);
    expect(knowledge.strategic.defence(ENEMY, guardhouse.uid)).toBe(180);
    walk(80.5, 8.5);
    expect(record.lastSeenTick).toBe(16);
    walk(80.5, 8.5, SITE_CERTAINTY_TICKS);
    expect(knowledge.strategic.defence(ENEMY, guardhouse.uid)).toBeGreaterThan(180);
    expect(knowledge.knowsBuilding(ENEMY, guardhouse)).toBe(true);
    // Its own buildings and a woodcutter it never saw stay unknown.
    expect(knowledge.strategic.site(ENEMY, 41)).toBeUndefined();
  });

  it("estimates a site's defence from what was seen, sliding towards the full garrison with age", () => {
    const site: KnownSite = { firstKnownTick: 0, garrisonSeen: 2, lastSeenTick: 100, strengthSeen: 180,
      type: GUARDHOUSE, uid: 1, x: 0, z: 0 };
    const full = siteDefenceEstimate({ ...site, garrisonSeen: -1 }, 100, false);
    expect(full).toBeGreaterThan(180);
    expect(GARRISON_CAPACITIES[GUARDHOUSE]).toBeGreaterThan(0);
    expect(siteDefenceEstimate(site, 100, true)).toBe(180);
    const half = siteDefenceEstimate(site, 100 + SITE_CERTAINTY_TICKS / 2, false);
    expect(half).toBeGreaterThan(180);
    expect(half).toBeLessThan(full);
    expect(siteDefenceEstimate(site, 100 + SITE_CERTAINTY_TICKS * 2, false)).toBe(full);
    expect(siteDefenceEstimate({ ...site, type: WOODCUTTER }, 10_000, false)).toBe(180);
  });

  it("saves canonically: a reload saves the same and keeps knowing; broken saves are refused", () => {
    const { buildings, knowledge, now, vision, walk } = island();
    walk(24.5, 20.5, 3);
    walk(60.5, 56.5, 3);
    const saved = knowledge.save();
    expect(factionKnowledgeSaveError(saved)).toBeNull();
    expect(saved.sites?.map(entry => entry.slice(0, 3))).toEqual([[ENEMY, 40, GUARDHOUSE], [ENEMY, 41, WOODCUTTER]]);
    const copy = createFactionKnowledge({ buildings: () => buildings, now, sees: () => vision.sees, units: () => [],
      vision: () => vision });
    copy.restore(structuredClone(saved));
    expect(copy.save()).toEqual(saved);
    expect(factionKnowledgeSaveError({ ...saved, sites: [[1, 40, 2, 0, 0, 9, 3, 0, 0]] })).not.toBeNull();
    expect(factionKnowledgeSaveError({ ...saved, sites: [...saved.sites!].reverse() })).not.toBeNull();
    expect(factionKnowledgeSaveError({ ...saved, sectors: [[1, -1, 3]] })).not.toBeNull();
    expect(factionKnowledgeSaveError({ ...saved, scouting: [[1, 0, []]] })).not.toBeNull();
  });

  it("migrates a format 11 save's seen buildings into the ledger (known since tick 0, garrison unknown)", () => {
    const { buildings, knowledge } = island();
    knowledge.restore({ alerts: [], buildings: [[ENEMY, 40], [ENEMY, 99]], records: [] });
    expect(knowledge.strategic.site(ENEMY, 40)).toMatchObject({ firstKnownTick: 0, garrisonSeen: -1 });
    expect(knowledge.strategic.site(ENEMY, 99)).toBeUndefined();
    expect(knowledge.knowsBuilding(ENEMY, buildings[0]!)).toBe(true);
  });
});

describe("sector staleness and scout plans", () => {
  const clear = () => true;

  it("plans the start-known place first, then stale sectors on the way; keeps the plan while its trip runs", () => {
    const { knowledge, now, walk } = island();
    walk(80.5, 8.5, 2);
    const start = { x: 20, z: 80 };
    const goals = knowledge.strategic.scoutGoals(ENEMY, { x: 80, z: 8 }, [start], clear);
    expect(goals.length).toBe(SCOUT_GOALS);
    expect(goals).toContainEqual(start);
    // Visiting order: always the nearest unvisited goal next.
    expect(goals.at(-1)).toEqual(start);
    // Seeing the first goal does not reshuffle the trip.
    walk(goals[0]!.x, goals[0]!.z, 2);
    expect(knowledge.strategic.scoutGoals(ENEMY, { x: 80, z: 8 }, [start], clear)).toEqual(goals);
    // Every goal seen: the next call plans a new trip without them.
    for (const goal of goals) walk(goal.x, goal.z, 2);
    const next = knowledge.strategic.scoutGoals(ENEMY, { x: 80, z: 8 }, [start], clear);
    expect(next.some(goal => goals.some(old => old.x === goal.x && old.z === goal.z))).toBe(false);
    expect(knowledge.save().scouting?.[0]?.[1]).toBe(now());
  });

  it("dates a sector when the observer that covered its centre walks away; stale again after the scout age", () => {
    const { knowledge, walk } = island();
    const centre = { x: SECTOR_TILES / 2 + .5, z: SECTOR_TILES / 2 + .5 };
    walk(centre.x, centre.z, 3);
    walk(80.5, 80.5);
    const save = knowledge.save();
    expect(save.sectors).toContainEqual([ENEMY, 0, 3]);
    walk(80.5, 80.5, SCOUT_AGE_TICKS + 1);
    const goals = knowledge.strategic.scoutGoals(ENEMY, { x: 30, z: 30 }, [], clear);
    expect(goals.length).toBeGreaterThan(0);
  });
});

/** Probe totals of the raid and director site reads over a run. */
const siteReads = () => visionProbeReport().filter(site => /^(raid|director)\./.test(site.site));

describe("probe of building reads", () => {
  it("counts a read of an unknown, unseen building as unseen", () => {
    setVisionProbe(() => false);
    try {
      probeSiteRead("raid.test", ENEMY, { uid: 1, x: 5, z: 5 }, false);
      probeSiteRead("raid.test", ENEMY, { uid: 2, x: 5, z: 5 }, true);
      expect(visionProbeReport()[0]).toMatchObject({ reads: 2, remembered: 1, unseen: 1 });
    } finally {
      setVisionProbe(null);
    }
  });
});

describe("colony land raiders strike only known sites (fog raid, land part)", () => {
  /** Three finished player Guardhouses around the home, unseen by the colony at the start. */
  const fortifiedColony = (withoutMilitaryCommander: boolean) => {
    const simulation = struckColony("medium", { withoutMilitaryCommander }, { planks: 200, stone: 200 });
    const home = simulation.headquarters;
    const placed: number[] = [];
    for (const [dx, dz] of [[-6, 0], [6, 6], [0, 8]])
      placed.push(placeFinished(simulation, GUARDHOUSE, home.x + dx!, home.z + dz!).uid);
    return { placed, simulation };
  };

  for (const withoutMilitaryCommander of [false, true]) {
    const mode = withoutMilitaryCommander ? "without the AI commander" : "through the director";
    it(`reads no unseen player building ${mode}; sites are first known only after the raid set out`, () => {
      setVisionProbe("latest");
      const records: DirectorTraceRecord[] = [];
      setDirectorTraceSink(record => { records.push({ ...record }); });
      try {
        const { placed, simulation } = fortifiedColony(withoutMilitaryCommander);
        for (let tick = 0; tick < 20 * 120; tick++) simulation.update(.05);
        const reads = siteReads();
        expect(reads.reduce((sum, site) => sum + site.reads, 0)).toBeGreaterThan(0);
        expect(reads.filter(site => site.unseen > 0)).toEqual([]);
        const sites = simulation.saveState().military?.combat?.knowledge?.sites ?? [];
        const known = sites.filter(entry => placed.includes(entry[1]));
        expect(known.length).toBeGreaterThan(0);
        // Nothing was known before the first land party set out (45 s after the strike).
        expect(known.every(entry => entry[5] >= 20 * 45)).toBe(true);
        expect(records.filter(record => record.macro === "strike").every(record => record.knownTargets > 0))
          .toBe(true);
      } finally {
        setDirectorTraceSink(null);
        setVisionProbe(null);
      }
    }, 120_000);
  }
});
