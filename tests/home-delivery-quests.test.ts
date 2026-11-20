import { expect, it } from "vitest";

import { HOME_QUEST_BOOK } from "../src/shared/quests/home-quest-book";
import { homeQuestSummary } from "../src/shared/quests/home-quests";
import { applyQuestClaim } from "../src/shared/settlement/settlement-quest-claim";
import { claimAt, NO_ISLAND_FACTS, stateBefore } from "./helpers/home-quest-state";

/** EXT-TEMPLATES: the home tutorial's delivery steps are paid from the island stock at the claim (quest `cost`). */

const DELIVERIES = [
  { amount: 10, id: "wood.planks-delivery", ware: "planks" },
  { amount: 10, id: "stone.delivery", ware: "stone" },
  { amount: 5, id: "food.bread-delivery", ware: "bread" }
] as const;

it.each(DELIVERIES)("$id is ready with the wares in stock and its claim takes them", ({ amount, id, ware }) => {
  const state = stateBefore(id);
  const stock = { inventory: { [ware]: amount + 3 } as Record<string, number> };
  const stored = (key: string) => stock.inventory[key] ?? 0;
  const short = { ...NO_ISLAND_FACTS, stored: (key: string) => (key === ware ? amount - 1 : 0) };
  expect(homeQuestSummary(state, short, true)).toMatchObject({ progress: amount - 1, ready: false });
  expect(claimAt(state, short)).toBeNull();
  const facts = { ...NO_ISLAND_FACTS, stored };
  expect(homeQuestSummary(state, facts, true).ready).toBe(true);
  const claim = claimAt(state, facts)!;
  expect(claim.cost).toEqual({ [ware]: amount });
  const buildings = [{ construction: 1, inventory: stock.inventory, typeId: 0, uid: 1 }];
  const command = { bookId: HOME_QUEST_BOOK.id, cost: claim.cost, goods: {}, occurrence: "0", questId: id,
    skip: false };
  expect(applyQuestClaim(buildings as never, command, stored)).toBe(true);
  expect(stock.inventory[ware]).toBe(3);
  expect(applyQuestClaim(buildings as never, command, stored)).toBe("Not enough goods in storage for this quest");
});

it("a skipped stone delivery (no rock on the island) takes nothing", () => {
  const facts = { ...NO_ISLAND_FACTS, missingResource: () => true };
  expect(claimAt(stateBefore("stone.delivery"), facts, true)).toMatchObject({ cost: {}, experience: 0 });
});
