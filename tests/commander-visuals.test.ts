import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { commanderPortrait, troopPortrait } from "../src/app/settlement/army-icons";
import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import { getCommanderView } from "../src/app/settlement-ui/building-details/commander-helpers";
import { getCommanderCards } from "../src/app/settlement-ui/expedition-planner/helpers";
import {
  COMMANDER_AURA_RADIUS_TILES, commanderAppearance, riderArmourRank
} from "../src/render-common/mounts/commander-appearance";
import { NATION_RIDERS } from "../src/render-common/mounts/nation-riders";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { ORDINARY_TROOP_TYPES } from "../src/shared/settlement/military-combat-rules";
import {
  COMMANDER_AURA_RADIUS, commanderDefinition, type CommanderSnapshot
} from "../src/shared/settlement/settlement-commander";
import { DEBUG_EXPEDITION_TROOPS } from "../src/shared/settlement/settlement-debug-expeditions";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { isTavernTroop, TAVERN_RECIPES } from "../src/shared/settlement/tavern-rules";

const NATIONS = ["roman", "viking", "nubian", "japanese"] as const;

const snapshot = (nation: (typeof NATIONS)[number]): CommanderSnapshot => ({
  aura: { ...commanderDefinition(nation).aura },
  blockDetail: null,
  blockReason: null,
  canReturn: false,
  deckSlots: 2,
  definition: { ...commanderDefinition(nation) },
  developmentAllowed: false,
  healingSeconds: 0,
  healthReady: true,
  homeLodgeUid: 1,
  hp: 315,
  hpFraction: 1,
  id: "commander-art-1",
  lastXpResult: undefined,
  level: 1,
  location: "lodge",
  maximumHp: 315,
  name: "Aurelius",
  nation,
  nextThreshold: 30,
  ready: true,
  recoveryComplete: true,
  recoverySeconds: 0,
  xp: 0
});

const mountFrame = (commanderId: string | undefined, phase = "militaryField", hp = 105) => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 7, x: 3, y: .2, z: 3, yaw: 0, mounted: true, visible: true, job: "Soldier",
    action: "walk", phase, ware: null, animationTime: 4, path: [], pathIndex: 0, building: 0, home: 0,
    timer: 0 } as SettlementActor;
  const soldier = { actor: 7, rank: 0, commanderId, combat: { type: "cavalry" as const,
    faction: 0, hp, cooldown: 0, selected: false } };
  frames.updateWorkers([actor], .1, [soldier]);
  return frames.cavalryMounts[0];
};

describe("national commander presentation", () => {
  it.each(NATIONS)("selects the %s commander armour, insignia, aura and portrait", nation => {
    const look = commanderAppearance(nation);
    expect(look.armourRank).toBe("centurion");
    expect(look.auraRadius).toBe(COMMANDER_AURA_RADIUS);
    expect(look.auraRadius).toBe(COMMANDER_AURA_RADIUS_TILES);
    expect(look.insignia).toBe({ japanese: "sashimono", nubian: "bow", roman: "shield",
      viking: "standard" }[nation]);
    expect(commanderPortrait(nation)).not.toBe(troopPortrait(nation, "cavalry"));
    expect(commanderPortrait(nation)).toContain(`/commander-portraits/${nation}.png`);
    const portrait = resolve("assets/commander-portraits", `${nation}.png`);
    expect(existsSync(portrait), portrait).toBe(true);
    expect(statSync(portrait).size).toBeGreaterThan(2_000);
  });

  it("keeps ordinary riders on soldier armour and the commander on centurion armour", () => {
    expect(riderArmourRank(false)).toBe("soldier");
    expect(riderArmourRank(true)).toBe("centurion");
    expect(new Set(NATIONS.map(nation => commanderAppearance(nation).auraColor)).size).toBe(NATIONS.length);
    expect(new Set(NATIONS.map(nation => commanderAppearance(nation).bannerColor)).size).toBe(NATIONS.length);
    expect(new Set(NATIONS.map(nation => commanderAppearance(nation).emblemColor)).size).toBe(NATIONS.length);
  });

  it("marks only the commander mount with the aura and national standard", () => {
    const ordinary = mountFrame(undefined)!;
    expect(ordinary).toMatchObject({ auraActive: false, commander: false, rider: "roman-man-white" });
    const commander = mountFrame("commander-art-1")!;
    expect(commander).toMatchObject({ auraActive: true, commander: true, nation: "roman",
      rider: NATION_RIDERS.roman });
    const wounded = mountFrame("commander-art-1", "militaryField", 0)!;
    expect(wounded.auraActive).toBe(false);
    const aboard = mountFrame("commander-art-1", "navalAboard")!;
    expect(aboard.auraActive).toBe(false);
  });

  it("uses the commander portrait in the existing lodge card view", () => {
    for (const nation of NATIONS) {
      const view = getCommanderView(snapshot(nation), undefined, nation);
      expect(view.portrait).toBe(commanderPortrait(nation));
      expect(view.levelMarks).toBe("▲");
    }
  });

  it("uses the definition portrait consistently in lodge and expedition cards", () => {
    const commander = snapshot("roman");
    commander.definition = { ...commander.definition, icon: "nubian" };
    const lodge = getCommanderView(commander, undefined, "roman");
    const card = getCommanderCards([commander], commander.id).find(card => card.id === commander.id);
    expect(lodge.portrait).toBe(commanderPortrait("nubian"));
    expect(card?.portrait).toBe(lodge.portrait);
  });

  it("does not re-enable ordinary cavalry recruitment or hidden troop production", () => {
    expect(ORDINARY_TROOP_TYPES).not.toContain("cavalry");
    expect(isTavernTroop("cavalry")).toBe(false);
    expect(TAVERN_RECIPES).not.toHaveProperty("cavalry");
    expect(DEBUG_EXPEDITION_TROOPS.cavalry).toBe(0);
  });
});
