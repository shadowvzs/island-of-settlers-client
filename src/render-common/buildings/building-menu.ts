import { getBuildingDefinition } from "./building-catalog";
import { BUILDING_CATEGORY_GROUPS } from "./building-menu-groups";

/** Functional navigation never changes physical plots or progression tiers. */
export const BUILDING_MENU = BUILDING_CATEGORY_GROUPS.map(group => ({
  buildings: group.ids.map(getBuildingDefinition),
  id: group.id,
  name: group.name,
  size: group.id
}));

export const BUILDING_MENU_GROUPS = BUILDING_MENU.map(group => ({
  id: group.id, name: group.name, ids: group.buildings.map(building => building.id)
}));
