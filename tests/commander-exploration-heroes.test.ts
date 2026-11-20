import { describe, expect, it } from "vitest";

import {
  commanderExplorationHeroes,
  commanderHeroBody,
  uniqueHeroBodies
} from "../src/app/commander-control/helpers";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { MilitaryCombatant } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";

const combat = (overrides: Partial<MilitaryCombatant> = {}): MilitaryCombatant => ({
  cooldown: 0,
  faction: 0,
  hp: 100,
  type: "archer",
  ...overrides
});

const soldier = (overrides: Partial<SettlementSoldier> = {}): SettlementSoldier => ({
  actor: 1,
  building: -3,
  combat: combat(),
  rank: 0,
  stationed: false,
  ...overrides
});

const frame = (actorId: number, overrides: Partial<WorkerFrame> = {}): WorkerFrame => ({
  action: "idle_breathe",
  actorId,
  animationTime: 0,
  gaitPhase: 0,
  heading: 0,
  nation: "roman",
  runBlend: 0,
  selected: false,
  target: null,
  variant: "roman-man-white",
  x: 0,
  y: 0,
  z: 0,
  ...overrides
});

describe("commander exploration hero bodies", () => {
  it("uses the nation's rider variant in the commander's actual armour rank", () => {
    expect(commanderHeroBody("viking", 2)).toEqual({
      armourRank: "centurion", nation: "viking", variant: "viking-woman-blue"
    });
    expect(commanderHeroBody("roman", 0)).toEqual({
      armourRank: "recruit", nation: "roman", variant: "roman-man-white"
    });
  });

  it("lists the commander first, then the selected escort resolved through rendered frames", () => {
    const soldiers = [
      soldier({ actor: 1, commanderId: "commander-7", rank: 1 }),
      soldier({ actor: 2, combat: combat({ selected: true }) }),
      soldier({ actor: 3, combat: combat({ selected: true, type: "heavy" }) }),
      soldier({ actor: 4 })
    ];
    const frames = [
      frame(2, { armourRank: "soldier", nation: "viking", variant: "viking-woman-blue" }),
      frame(3, { armourRank: "recruit" }),
      frame(4)
    ];
    expect(commanderExplorationHeroes({ nation: "roman" }, soldiers, frames)).toEqual([
      commanderHeroBody("roman", 1),
      { armourRank: "soldier", nation: "viking", variant: "viking-woman-blue" },
      { armourRank: "recruit", nation: "roman", variant: "roman-man-white" }
    ]);
  });

  it("skips selected soldiers that have no rendered frame and needs a commander row", () => {
    const soldiers = [soldier({ actor: 2, combat: combat({ selected: true }) })];
    expect(commanderExplorationHeroes({ nation: "roman" }, soldiers, [])).toEqual([]);
    expect(commanderExplorationHeroes(undefined, soldiers, [frame(2)])).toEqual([]);
  });

  it("keeps one request per nation/body/rank", () => {
    const bodies = [
      commanderHeroBody("roman", 0),
      commanderHeroBody("roman", 1),
      { armourRank: "recruit" as const, nation: "roman" as const, variant: "roman-man-white" },
      { nation: "roman" as const, variant: "roman-man-white" }
    ];
    expect(uniqueHeroBodies(bodies)).toHaveLength(3);
  });
});
