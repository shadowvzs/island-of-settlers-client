import { expect, it } from "vitest";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_NATIVE_ACCEPTED } from "../../island-of-settlers-shared/src/road-plant-completion";
import { getGemShopOfferCards } from "../src/app/settlement-ui/gem-shop/helpers";
import { GEM_SHOP_CATEGORIES } from "../src/shared/progression/gem-shop";

it("offers stackable cross-culture decorations with distinct mineral names and independent affordability", () => {
  const category = GEM_SHOP_CATEGORIES.findIndex(row => row.id === "decorations");
  const cards = getGemShopOfferCards(category, { gems: 5, level: 1,
    inventory: { "roadDecoration:roman-rusticated-arch:granite": 2 } });
  const granite = cards.find(row => row.id === "road-decoration-roman-rusticated-arch-granite")!;
  const marble = cards.find(row => row.id === "road-decoration-roman-rusticated-arch-marble")!;
  expect(granite).toMatchObject({ disabled: false, price: "5", description: "Roman rusticated arch · Granite" });
  expect(marble.description).toBe("Roman rusticated arch · Marble");
  expect(cards.find(row => row.id === "road-decoration-japanese-timber-torii-native")?.disabled).toBe(false);
  const poor = getGemShopOfferCards(category, { gems: 4, level: 1 });
  expect(poor.find(row => row.id === granite.id)?.disabled).toBe(true);
});

it("keeps consumables in Items and routes only actual SKUs through the five decoration filters", () => {
  const items = GEM_SHOP_CATEGORIES.findIndex(row => row.id === "items"), decorations = GEM_SHOP_CATEGORIES.findIndex(row => row.id === "decorations");
  const player = { gems: 100, level: 1 };
  expect(getGemShopOfferCards(items, player).map(card => card.item)).toEqual(["chooseNation", "commanderRecovery"]);
  const arches = getGemShopOfferCards(decorations, player, undefined, "arches");
  const plants = getGemShopOfferCards(decorations, player, undefined, "plants");
  const lanterns = getGemShopOfferCards(decorations, player, undefined, "lanterns");
  const trees = getGemShopOfferCards(decorations, player, undefined, "trees");
  const columns = getGemShopOfferCards(decorations, player, undefined, "columns");
  expect(arches).toHaveLength(24); expect(plants).toHaveLength(PLANT_COMPLETION_NATIVE_ACCEPTED ? 110 : 11); expect(lanterns).toHaveLength(4);
  expect(columns).toHaveLength(4);
  expect(trees).toHaveLength(PLANT_COMPLETION_NATIVE_ACCEPTED ? 123 : 21);
  expect(plants.filter(card => card.id.includes("flower-pot"))).toHaveLength(2);
  expect(trees.filter(card => card.id.includes("maple") && !card.id.includes("bonsai"))).toHaveLength(PLANT_COMPLETION_NATIVE_ACCEPTED ? 12 : 9);
  expect(trees.filter(card => card.id.includes("pink-peach"))).toHaveLength(PLANT_COMPLETION_NATIVE_ACCEPTED ? 6 : 3);
  expect(lanterns.filter(card => card.id.includes("stone-lantern"))).toHaveLength(2);
  expect(lanterns.filter(card => card.id.includes("wooden-lantern"))).toHaveLength(2);
  const actual = [...arches, ...plants, ...trees, ...lanterns, ...columns].map(card => card.item!).sort((a, b) => a.localeCompare(b));
  expect(actual).toEqual(Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS).filter(item => ROAD_DECORATION_ITEM_DEFINITIONS[item as keyof typeof ROAD_DECORATION_ITEM_DEFINITIONS]!.shopAvailable).sort());
});
