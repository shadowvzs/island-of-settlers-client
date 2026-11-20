import { afterEach, describe, expect, it, vi } from "vitest";

import { type DirectorTraceRecord, setDirectorTraceSink } from "../src/shared/settlement/commander/director-trace";
import { REFERENCE_SOLDIER } from "../src/shared/settlement/commander/known-sites";
import type { StrategicIntent } from "../src/shared/settlement/commander/strategic-intents";
import { RESERVE_RELEASE_MAX, STRATEGY_LEVELS } from "../src/shared/settlement/economy-ai/constants";
import { musterReserve, reserveStrength } from "../src/shared/settlement/economy-ai/faction-muster";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { stateHashOf } from "../tools/bench/military-a14-metrics";
import { ATTACK_FIXTURE_FACTION, createFactionAttackFixture } from "./helpers/faction-attack-fixture";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * EAI4-FOLLOWUP: a `develop` faction keeps its spare soldiers stored in its depot; its strategy counts them and
 * releases what its attack, raid or scout lacks into the field, where the director forms its force.
 */

const FACTION = ATTACK_FIXTURE_FACTION;
const HARD = STRATEGY_LEVELS.hard;
const ATTACK: StrategicIntent = { kind: "attack", minStrength: 800, target: { kind: "site", uid: 5 } };

/** A military port that records each release and holds `spare` soldiers. */
const reserveOf = (spare: number) => {
  const released: number[] = [];
  const context = { military: {
    releaseReserve: (_owner: number, count: number) => {
      const sent = Math.min(count, spare);
      released.push(sent);
      return sent;
    },
    spareReserve: () => spare
  } } as unknown as Pick<SettlementContext, "military">;
  return { context, released };
};

describe("calling up the depot reserve (pure)", () => {
  it("counts spare stored soldiers as strength and releases only what the intents still lack", () => {
    const { context, released } = reserveOf(10);
    expect(reserveStrength(context, FACTION)).toBe(10 * REFERENCE_SOLDIER);
    expect(musterReserve(context, FACTION, [ATTACK], 2 * REFERENCE_SOLDIER)).toBe(6);
    expect(musterReserve(context, FACTION, [ATTACK], 800)).toBe(0);
    expect(musterReserve(context, FACTION, [{ kind: "scout" }], 0)).toBe(1);
    expect(musterReserve(context, FACTION, [{ kind: "scout" }], REFERENCE_SOLDIER)).toBe(0);
    expect(musterReserve(context, FACTION, [{ area: { radius: 5, x: 1, z: 1 }, kind: "hold" }], 0)).toBe(0);
    expect(released).toEqual([6, 1]);
  });

  it("releases at most one march's worth per decision", () => {
    const { context } = reserveOf(40);
    const huge: StrategicIntent = { ...ATTACK, minStrength: 40 * REFERENCE_SOLDIER };
    expect(musterReserve(context, FACTION, [huge], 0)).toBe(RESERVE_RELEASE_MAX);
  });
});

const advance = (simulation: { update: (dt: number) => void }, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};

/** The faction's soldiers by where they are: stored in its depot (-1), in the field (-3) or in a building. */
const soldierPosts = (simulation: ReturnType<typeof createFactionAttackFixture>["simulation"]) =>
  simulation.saveState().military?.soldiers.filter(soldier => soldier.combat?.faction === FACTION)
    .map(soldier => soldier.building) ?? [];

afterEach(() => setDirectorTraceSink(null));

describe("a develop faction whose soldiers wait in its depot", () => {
  it("calls them up, scouts, and marches on the player's known Guardhouse", () => {
    const records: DirectorTraceRecord[] = [];
    const live = createFactionAttackFixture({ level: "hard", mode: "develop" }, undefined, true);
    expect(soldierPosts(live.simulation).every(post => post === -1)).toBe(true);
    setDirectorTraceSink(entry => { records.push({ ...entry }); });
    advance(live.simulation, HARD.firstAttackTicks + 2400);
    expect(records.find(entry => entry.macro !== "hold")?.macro).toBe("scout");
    const offensive = records.filter(entry => entry.macro === "strike" || entry.macro === "raid");
    expect(offensive.length).toBeGreaterThan(0);
    expect(offensive.every(entry => entry.target === live.guardhouse)).toBe(true);
    expect(Math.max(...offensive.map(entry => entry.members))).toBeGreaterThan(1);
    expect(soldierPosts(live.simulation).filter(post => post === -1).length).toBeLessThan(12);
  }, 300_000);

  it("is deterministic, and a reload while its called-up force marches continues to the same state", () => {
    const camp = () => createFactionAttackFixture({ level: "hard", mode: "develop" }, undefined, true);
    const live = camp(), reloaded = camp();
    const midway = HARD.firstAttackTicks + 1500;
    advance(reloaded.simulation, midway);
    const saved = reloaded.simulation.saveState();
    expect(reloaded.simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    advance(reloaded.simulation, 600);
    advance(live.simulation, midway + 600);
    expect(stateHashOf(reloaded.simulation)).toBe(stateHashOf(live.simulation));
  }, 300_000);
});
