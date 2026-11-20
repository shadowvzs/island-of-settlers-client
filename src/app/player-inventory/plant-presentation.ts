import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { translateMessage } from "../../shared/i18n/translate";

export const PLANT_ITEM_MESSAGES = {
  variant: msg({ id: "roadPlant.variant", message: "Variant {number}" }),
  compact: msg({ id: "roadPlant.compact", message: "Compact form" }),
  natural: msg({ id: "roadPlant.natural", message: "Natural form" }),
  pot: msg({ id: "roadPlant.pot", message: "Ceramic pot" }),
  description: msg({ id: "roadPlant.itemDescription", message: "Ornamental decoration. Produces no resources. Click to place on owned terrain; R rotates and right-click cancels." })
};

export const plantItemDetails = (asset: PlantDecorationAsset, i18n?: I18n) => [
  translateMessage(i18n, PLANT_ITEM_MESSAGES.variant, { number: asset.variant + 1 }),
  translateMessage(i18n, asset.form === "standalone" ? PLANT_ITEM_MESSAGES.natural : PLANT_ITEM_MESSAGES.compact),
  asset.potted ? translateMessage(i18n, PLANT_ITEM_MESSAGES.pot) : ""
].filter(Boolean).join(" · ");
