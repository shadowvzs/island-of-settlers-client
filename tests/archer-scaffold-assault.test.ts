import { describe, expect, it } from "vitest";

import { OPEN_SCAFFOLD_STRUCTURE_HP } from "../src/shared/balance/military";
import { siteStructure } from "../src/shared/settlement/fort-assault-rules";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { footprintDistance } from "../src/shared/settlement/settlement-garrison-archers";
import {
  type ArcherScaffoldFixture, createArcherScaffoldFixture, scaffoldStructure, soldierOf
} from "./helpers/archer-scaffold-fixture";

const MIXED_SQUAD = [
  { rank: 0, type: "heavy" as const },
  { rank: 0, type: "heavy" as const },
  { rank: 0, type: "shield" as const },
  { rank: 0, type: "shield" as const }
];

const runFor = ({ simulation }: ArcherScaffoldFixture, seconds: number, until = () => false) => {
  for (let tick = 0; tick < seconds * 20 && !until(); tick++) simulation.update(.05);
};

const isFalling = (fixture: ArcherScaffoldFixture) =>
  fixture.guards.some(guard => soldierOf(fixture, guard)?.combat?.towerFall !== undefined);

const scaffoldFootprint = ({ site }: ArcherScaffoldFixture) =>
  ({ halfDepth: site.depth / 2, halfWidth: site.width / 2, x: site.x, z: site.z });

/** Every enemy soldier and body: one record each, never lost or duplicated. */
const enemyRoster = ({ guards, simulation }: ArcherScaffoldFixture) => {
  const actors = simulation.snapshot().actors.filter(actor => guards.includes(actor.uid));
  const soldiers = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 1);
  return { actors: actors.map(actor => actor.uid).sort((a, b) => a - b),
    soldiers: soldiers.map(soldier => soldier.actor).sort((a, b) => a - b) };
};

const hurtAttackers = (fixture: ArcherScaffoldFixture) => fixture.players.filter(id => {
  const soldier = soldierOf(fixture, id);
  return !soldier?.combat || soldier.combat.hp < militaryHealth(soldier.combat.type, soldier.rank);
});

describe("archer scaffold assault", () => {
  it("gives open scaffolds their own, lower structure hit points", () => {
    expect(siteStructure({ bandit: { code: 1, layout: 0 }, typeId: 4 })).toEqual({
      hp: OPEN_SCAFFOLD_STRUCTURE_HP, maximum: OPEN_SCAFFOLD_STRUCTURE_HP
    });
    expect(siteStructure({ bandit: { code: 1, layout: 1 }, typeId: 4 })?.maximum).toBe(35_000);
  });

  it("melee strike an occupied scaffold while its archer shoots down at them", () => {
    const fixture = createArcherScaffoldFixture({ attackers: MIXED_SQUAD });
    const { guards, players, simulation, site } = fixture;
    expect(simulation.siegeMilitary(players, site.uid)).toBe(true);
    runFor(fixture, 25);
    expect(scaffoldStructure(fixture)!.hp).toBeLessThan(OPEN_SCAFFOLD_STRUCTURE_HP - 1500);
    expect(soldierOf(fixture, guards[0]!)).toMatchObject({ building: site.uid, stationed: true });
    const atSupports = simulation.snapshot().actors.filter(actor => players.includes(actor.uid) &&
      footprintDistance(scaffoldFootprint(fixture), actor.x, actor.z) < 1);
    expect(atSupports.length).toBeGreaterThanOrEqual(2);
    const before = atSupports.map(actor => soldierOf(fixture, actor.uid)?.combat?.hp ?? 0);
    runFor(fixture, 6);
    const after = atSupports.map(actor => soldierOf(fixture, actor.uid)?.combat?.hp ?? 0);
    expect(after.some((hp, index) => hp < before[index]!)).toBe(true);
  });

  it("drops the archer beside the ruin, keeps it through reloads and lets it fight at close range", () => {
    const fixture = createArcherScaffoldFixture({ attackers: MIXED_SQUAD });
    const { guards, players, simulation, site } = fixture;
    const guard = guards[0]!, roster = enemyRoster(fixture);
    simulation.siegeMilitary(players, site.uid);
    runFor(fixture, 15);
    const midAttack = simulation.saveState();
    expect(scaffoldStructure(fixture)!.hp).toBeLessThan(OPEN_SCAFFOLD_STRUCTURE_HP);
    expect(simulation.loadState(midAttack)).toEqual({ ok: true });
    runFor(fixture, 120, () => isFalling(fixture));
    expect(isFalling(fixture)).toBe(true);
    expect(scaffoldStructure(fixture)!.hp).toBe(0);
    expect(enemyRoster(fixture)).toEqual(roster);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    runFor(fixture, 1.2);
    const landed = soldierOf(fixture, guard)!, body = simulation.snapshot().actors.find(actor => actor.uid === guard)!;
    expect(landed).toMatchObject({ building: -3, stationed: false, combat: { fallenTowerArcher: true } });
    expect(landed.combat!.towerFall).toBeUndefined();
    expect(landed.combat!.hp).toBeGreaterThan(0);
    expect(body).toMatchObject({ phase: "militaryField", visible: true });
    expect(footprintDistance(scaffoldFootprint(fixture), body.x, body.z)).toBeLessThan(3);
    expect(enemyRoster(fixture)).toEqual(roster);
    // Baseline at landing: the archer strikes in close quarters at once. Since A14-3 (da67f54b8) a
    // broken archer routs along the covered route and may fall within the next seconds, so a baseline
    // taken later would miss that close-range strike.
    const hurt = hurtAttackers(fixture).length, wounded = new Map(players.map(id =>
      [id, soldierOf(fixture, id)?.combat?.hp ?? 0]));
    runFor(fixture, 2);
    const standing = simulation.snapshot().actors.find(actor => actor.uid === guard);
    if (standing) expect(footprintDistance(scaffoldFootprint(fixture), standing.x, standing.z)).toBeLessThan(3);
    runFor(fixture, 20, () => !soldierOf(fixture, guard));
    const struckBack = players.some(id => (soldierOf(fixture, id)?.combat?.hp ?? 0) < wounded.get(id)!);
    expect(struckBack || hurtAttackers(fixture).length > hurt).toBe(true);
    expect(soldierOf(fixture, guard)).toBeUndefined();
  });

  it("soldiers without orders turn on a scaffold that shoots them", () => {
    const fixture = createArcherScaffoldFixture({ attackers: MIXED_SQUAD, rally: { x: 20, z: 27 } });
    runFor(fixture, 20);
    expect(fixture.players.some(id => soldierOf(fixture, id)?.combat?.siege === fixture.site.uid)).toBe(true);
    expect(scaffoldStructure(fixture)!.hp).toBeLessThan(OPEN_SCAFFOLD_STRUCTURE_HP);
  });

  it("replays an assault and its collapse identically", () => {
    const run = () => {
      const fixture = createArcherScaffoldFixture({ archers: [0, 0], attackers: [...MIXED_SQUAD, ...MIXED_SQUAD] });
      fixture.simulation.siegeMilitary(fixture.players, fixture.site.uid);
      runFor(fixture, 60, () => isFalling(fixture));
      runFor(fixture, 2);
      const { military } = fixture.simulation.saveState();
      return { military, roster: enemyRoster(fixture) };
    };
    const first = run();
    expect(first.military!.combat!.doors.find(door => door.structure)!.structure!.hp).toBe(0);
    expect(run()).toEqual(first);
  });
});
