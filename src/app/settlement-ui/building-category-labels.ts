import type { I18n } from "@lingui/core";
import { categoriesOfKind } from "@shared/catalog";

import { type BuildingCategoryId, buildingCategoryKey } from "../../render-common/buildings/building-menu-groups";
import { contentDescriptor } from "../../shared/i18n/content-text";

/** The building panel tab's name (content catalog category text). */
export const getBuildingCategoryName = (id: BuildingCategoryId, i18n?: I18n) => {
  const key = buildingCategoryKey(id);
  const text = categoriesOfKind("building").find(category => category.id === key)?.text.name;
  if (!text) return id;
  if (i18n) return i18n._(contentDescriptor(text));
  return text.en;
};
