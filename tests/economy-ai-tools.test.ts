import { beforeEach, describe, expect, it } from "vitest";

import { resolvedBuildProgram } from "../src/shared/settlement/economy-ai/build-program";
import { GROW_POSTURE, TOOL_SHORTAGE_MIN_BUILDINGS } from "../src/shared/settlement/economy-ai/constants";
import { fillWantedCounts } from "../src/shared/settlement/economy-ai/develop-goals";
import { raiseToolmaking, steerToolOutput } from "../src/shared/settlement/economy-ai/develop-tools";
import { economyStockOf, economyWareIndex } from "../src/shared/settlement/economy-ai/economy-stock";
import { METALWORKS_TYPE } from "../src/shared/settlement/mixed-output";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

/** EAI4-FOLLOWUP: the program's Metalworks and the economy manager's tool order. */

const program = resolvedBuildProgram("balanced", "roman");
const indexOf = (id: string) => program.goals.findIndex(goal => goal.id === id);
const wanted = (id: string) => program.view.wanted[indexOf(id)]!;
const IRON_CHAIN = ["metalworks", "ironSmelter", "ironMine", "charburner"];

beforeEach(() => {
  const { blocked, counts, finished } = program.view;
  blocked.fill(0);
  counts.fill(0);
  finished.fill(0);
  program.view.stock.fill(100);
  program.view.ownBuildings = 6;
  counts[indexOf("woodcutter")] = finished[indexOf("woodcutter")] = 1;
  counts[indexOf("sawmill")] = finished[indexOf("sawmill")] = 1;
  fillWantedCounts(program);
});

describe("the toolmaking goal", () => {
  it("is the program's Metalworks, wanted in a grown town with its iron chain", () => {
    expect(program.goals[program.toolmaking]!.typeId).toBe(METALWORKS_TYPE);
    expect(wanted("metalworks")).toBe(0);
    program.view.ownBuildings = 20;
    fillWantedCounts(program);
    for (const id of IRON_CHAIN) expect(wanted(id), id).toBeGreaterThanOrEqual(1);
  });

  it("is pulled early in a town of 10, with its chain, once a buildable goal lacks its worker's tool", () => {
    raiseToolmaking(program);
    expect(wanted("metalworks")).toBe(0);
    program.view.stock[program.goals[indexOf("woodcutter")]!.tool] = 0;
    raiseToolmaking(program);
    expect(wanted("metalworks"), "an opening plays its program").toBe(0);
    program.view.ownBuildings = TOOL_SHORTAGE_MIN_BUILDINGS;
    fillWantedCounts(program);
    raiseToolmaking(program);
    for (const id of IRON_CHAIN) expect(wanted(id), id).toBeGreaterThanOrEqual(1);
  });
});

describe("the economy manager's tool order", () => {
  const stock = economyStockOf("balanced");
  const targets = stock.targets[GROW_POSTURE]!;
  const outputs = ["axe", "saw", "pickaxe"];
  const metalworks = (fields: Partial<SettlementBuilding> = {}) =>
    ({ typeId: METALWORKS_TYPE, ...fields }) as SettlementBuilding;
  const holding = (counts: Record<string, number>) => {
    stock.pooled.fill(0);
    stock.promised.fill(0);
    for (const [ware, count] of Object.entries(counts)) stock.pooled[economyWareIndex(ware)] = count;
  };

  it("makes the tool furthest below its target, and keeps its choice once every tool is stocked", () => {
    const building = metalworks();
    holding({ axe: targets[economyWareIndex("axe")]!, pickaxe: 0, saw: 5 });
    steerToolOutput(stock, building, outputs, targets);
    expect(building.selectedOutput).toBe("pickaxe");
    holding({ axe: 50, pickaxe: 50, saw: 50 });
    steerToolOutput(stock, building, outputs, targets);
    expect(building.selectedOutput).toBe("pickaxe");
  });

  it("leaves a paused Metalworks and every other building alone", () => {
    holding({});
    const paused = metalworks({ productionPaused: true });
    steerToolOutput(stock, paused, outputs, targets);
    expect(paused.selectedOutput).toBeUndefined();
    const other = { typeId: 24 } as SettlementBuilding;
    steerToolOutput(stock, other, outputs, targets);
    expect(other.selectedOutput).toBeUndefined();
  });
});
