import { expect, it } from "vitest";

import { CATAPULT_DECK_HEIGHT, CATAPULT_SHAFT_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "../src/render-common/buildings/catapult-hatch";
import { CATAPULT_HATCH, CATAPULT_STONE_DIAMETER } from "../src/render-common/buildings/catapult-mechanism";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { BUILDING_STRUCTURE_HP } from "../src/shared/balance/military";
import { updateCatapultDefences } from "../src/shared/settlement/military-catapult-defence";
import type { MilitaryDoor } from "../src/shared/settlement/military-combat-rules";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";

it.each([true, false])("raises only the shaft and upper assembly while preserving compact widths, detailed=%s", detailed => {
  expect(CATAPULT_SHAFT_HEIGHT).toBeCloseTo(1.65 * 1.5);
  expect(CATAPULT_DECK_HEIGHT).toBeCloseTo(1.77 + 1.65 * .5);
  expect(CATAPULT_STONE_DIAMETER).toBe(.23375);
  expect(CATAPULT_STONE_DIAMETER * (16 / 11)).toBeCloseTo(.34);
  const recipe = createCatapultTowerRecipe("roman", detailed);
  const deck = recipe.parts.find(part => part.shape === "catapult-deck")!;
  expect(deck.size).toEqual([1.65, .16, 1.65]);
  expect(deck.position[1] + deck.size[1] / 2).toBeCloseTo(CATAPULT_DECK_HEIGHT);
  const base = recipe.parts.find(part => part.position[1] === .06)!;
  // Owner national-shell revision keeps the stair-room floor inside the rounded exterior.
  expect(base.size).toEqual([1.05, .12, 1.05]);
  const shell=recipe.parts.find(part=>part.shape==="catapult-national-shell")!;
  expect(shell.size).toEqual([1.7,CATAPULT_SHAFT_HEIGHT,1.7]);
  // Fully open lid and its underside straps lie outside every plane of the counterbored body opening.
  for (const part of recipe.parts.filter(part => part.catapultPart === "hatch")) {
    const openRightEdge = CATAPULT_HATCH.hinge[0] + part.position[1] - CATAPULT_HATCH.hinge[1] + part.size[1] / 2;
    expect(openRightEdge).toBeLessThan(CATAPULT_HATCH_WELL.center[0] - CATAPULT_HATCH_WELL.lower / 2 - .004);
  }
});

it("uses midpoint structure HP and migrates old prototype HP without healing its damage fraction", () => {
  expect(BUILDING_STRUCTURE_HP[16]).toBe((BUILDING_STRUCTURE_HP[2]! + BUILDING_STRUCTURE_HP[4]!) / 2);
  const doors = new Map<number, MilitaryDoor>([[1, { building: 1, faction: 0, hp: 200, maximum: 200,
    structure: { hp: 7000, maximum: 20000 } }]]);
  const context = { buildings: [{ uid: 1, typeId: 16, construction: 1 }] } as unknown as SettlementContext;
  updateCatapultDefences(context, new Map(), doors, () => false, () => undefined);
  expect(doors.get(1)!.structure).toEqual({ hp: 9625, maximum: 27500 });
  updateCatapultDefences(context, new Map(), doors, () => false, () => undefined);
  expect(doors.get(1)!.structure!.hp).toBe(9625);
});
