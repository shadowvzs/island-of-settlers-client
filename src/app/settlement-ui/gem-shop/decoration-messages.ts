import { msg } from "@lingui/core/macro";

export const DECORATION_SHOP_MESSAGES = {
  buy: msg({ id: "settlement.trade.buyAction", message: "Buy" }),
  cancel: msg({ id: "gemShop.decorationCancel", message: "Cancel" }),
  preview: msg({ id: "gemShop.decorationPreview", message: "Decoration preview" }),
  price: msg({ id: "gemShop.decorationPrice", message: "Price: {price} gems" }),
  category: msg({ id: "gemShop.decorations", message: "Decorations" }),
  types: msg({ id: "gemShop.decorationTypes", message: "Decoration types" }),
  arches: msg({ id: "gemShop.decorationArches", message: "Arches" }),
  plants: msg({ id: "gemShop.decorationPlants", message: "Plants" }),
  trees: msg({ id: "gemShop.decorationTrees", message: "Trees" }),
  lanterns: msg({ id: "gemShop.decorationLanterns", message: "Lanterns" }),
  columns: msg({ id: "gemShop.decorationColumns", message: "Columns" }),
  empty: msg({ id: "gemShop.decorationEmpty", message: "No decorations are available in this category yet." })
};
