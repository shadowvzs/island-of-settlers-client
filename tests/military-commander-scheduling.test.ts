import { describe, expect, it } from "vitest";

import { COMMANDER_PROFILES } from "../src/shared/balance/commander-profiles";
import { DECISION_INTERVAL } from "../src/shared/balance/military";
import { type CommanderUnit, createMilitaryCommander } from "../src/shared/settlement/military-commander";

const fieldUnit = (uid: number, faction: number, x: number, z: number): CommanderUnit => ({
  busy: false,
  faction,
  fighting: false,
  health: 1,
  home: { x, z },
  marching: false,
  rank: 0,
  type: "shield",
  uid,
  x,
  z
});

const commanderOver = (units: CommanderUnit[], options: {
  factions?: () => readonly number[];
  onUnits?: () => void;
}) => createMilitaryCommander({
  cellsX: 64,
  cellsZ: 64,
  command: () => true,
  profile: () => COMMANDER_PROFILES.medium,
  isClear: () => true,
  units: () => {
    options.onUnits?.();
    return units;
  },
  ...(options.factions ? { factions: options.factions } : {})
});

describe("commander decision scheduling", () => {
  it("builds no units until a cheap faction clock is due", () => {
    // Faction 1 starts a quarter interval in, so it decides after 3/4 of an interval.
    const ticksToDue = Math.ceil((DECISION_INTERVAL * 3 / 4) / 0.05);
    let unitCalls = 0, factionReads = 0;
    const commander = commanderOver([fieldUnit(1, 1, 10, 10)], {
      factions: () => { factionReads++; return [1]; },
      onUnits: () => { unitCalls++; }
    });
    for (let tick = 0; tick < ticksToDue - 1; tick++) commander.update(0.05);
    expect(factionReads).toBe(ticksToDue - 1);
    expect(unitCalls).toBe(0);
    commander.update(0.05);
    expect(unitCalls).toBe(1);
  });

  it("keeps deriving the factions from units when no cheap source is supplied", () => {
    let unitCalls = 0;
    const commander = commanderOver([fieldUnit(1, 1, 10, 10)], { onUnits: () => { unitCalls++; } });
    commander.update(0.05);
    expect(unitCalls).toBe(1);
  });

  it("keeps the same due tick with duplicate faction readings", () => {
    const ticksToDue = Math.ceil((DECISION_INTERVAL * 3 / 4) / 0.05);
    let unitCalls = 0;
    const commander = commanderOver(
      [fieldUnit(1, 1, 10, 10), fieldUnit(2, 1, 12, 10)],
      { factions: () => [1, 1, 1], onUnits: () => { unitCalls++; } }
    );
    for (let tick = 0; tick < ticksToDue - 1; tick++) commander.update(0.05);
    expect(unitCalls).toBe(0);
    commander.update(0.05);
    expect(unitCalls).toBe(1);
  });
});
