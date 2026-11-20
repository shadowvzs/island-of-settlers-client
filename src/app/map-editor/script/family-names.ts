import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * Names of the catalog family paths that have no catalog entry of their own (design §13.3 family tree; the TRG11
 * review asked for translated family names). A family whose last segment is an entry key of its kind
 * (`animal.deer` → `animal:deer`, `building.production.bakery` → `building:bakery`) uses that entry's name.
 */
export const FAMILY_NAMES: Readonly<Record<string, MessageDescriptor>> = {
  "animal": msg({ id: "mapEditor.script.family.animal", message: "Animal" }),
  "bandit": msg({ id: "mapEditor.script.family.bandit", message: "Bandit camp" }),
  "bird": msg({ id: "mapEditor.script.family.bird", message: "Bird" }),
  "boat": msg({ id: "mapEditor.script.family.boat", message: "Boat" }),
  "boat.fishing": msg({ id: "mapEditor.script.family.boat.fishing", message: "Fishing boat" }),
  "building": msg({ id: "mapEditor.script.family.building", message: "Building" }),
  "building.military": msg({ id: "mapEditor.script.family.building.military", message: "Military building" }),
  "building.production": msg({ id: "mapEditor.script.family.building.production", message: "Production building" }),
  "building.production.mine": msg({ id: "mapEditor.script.family.building.production.mine", message: "Mine" }),
  "building.residence": msg({ id: "mapEditor.script.family.building.residence", message: "Residence" }),
  "building.service": msg({ id: "mapEditor.script.family.building.service", message: "Service building" }),
  "building.storage": msg({ id: "mapEditor.script.family.building.storage", message: "Storage building" }),
  "butterfly": msg({ id: "mapEditor.script.family.butterfly", message: "Butterfly" }),
  "commander": msg({ id: "mapEditor.script.family.commander", message: "Commander" }),
  "critter": msg({ id: "mapEditor.script.family.critter", message: "Small animal" }),
  "decoration": msg({ id: "mapEditor.script.family.decoration", message: "Decoration" }),
  "decoration.arches": msg({ id: "mapEditor.script.family.decoration.arches", message: "Arch" }),
  "decoration.columns": msg({ id: "mapEditor.script.family.decoration.columns", message: "Column" }),
  "decoration.lanterns": msg({ id: "mapEditor.script.family.decoration.lanterns", message: "Lantern" }),
  "decoration.plants": msg({ id: "mapEditor.script.family.decoration.plants", message: "Decorative plant" }),
  "decoration.trees": msg({ id: "mapEditor.script.family.decoration.trees", message: "Decorative tree" }),
  "deposit": msg({ id: "mapEditor.script.family.deposit", message: "Deposit" }),
  "deposit.ore": msg({ id: "mapEditor.script.family.deposit.ore", message: "Ore deposit" }),
  "deposit.stone": msg({ id: "mapEditor.script.family.deposit.stone", message: "Stone deposit" }),
  "fish": msg({ id: "mapEditor.script.family.fish", message: "Fish" }),
  "plant": msg({ id: "mapEditor.script.family.plant", message: "Plant" }),
  "settler": msg({ id: "mapEditor.script.family.settler", message: "Settler" }),
  "settler.construction": msg({ id: "mapEditor.script.family.settler.construction", message: "Construction worker" }),
  "settler.idle": msg({ id: "mapEditor.script.family.settler.idle", message: "Idle settler" }),
  "settler.military": msg({ id: "mapEditor.script.family.settler.military", message: "Military settler" }),
  "settler.production": msg({ id: "mapEditor.script.family.settler.production", message: "Production worker" }),
  "settler.service": msg({ id: "mapEditor.script.family.settler.service", message: "Service worker" }),
  "shell": msg({ id: "mapEditor.script.family.shell", message: "Shell" }),
  "ship": msg({ id: "mapEditor.script.family.ship", message: "Ship" }),
  "ship.sailing": msg({ id: "mapEditor.script.family.ship.sailing", message: "Sailing ship" }),
  "soldier": msg({ id: "mapEditor.script.family.soldier", message: "Soldier" }),
  "soldier.melee": msg({ id: "mapEditor.script.family.soldier.melee", message: "Melee soldier" }),
  "soldier.ranged": msg({ id: "mapEditor.script.family.soldier.ranged", message: "Ranged soldier" }),
  "stone": msg({ id: "mapEditor.script.family.stone", message: "Stone" }),
  "tree": msg({ id: "mapEditor.script.family.tree", message: "Tree" }),
  "whale": msg({ id: "mapEditor.script.family.whale", message: "Whale" })
};
