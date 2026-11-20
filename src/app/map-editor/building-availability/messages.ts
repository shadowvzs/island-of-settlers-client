import { msg } from "@lingui/core/macro";

/** Building availability section copy (editor UI; English source, other languages from the translation batch). */
export const BUILDING_AVAILABILITY_MESSAGES = {
  allow: msg({ id: "buildingAvailability.allow", message: "{building}: banned on this map (click to allow)" }),
  ban: msg({ id: "buildingAvailability.ban", message: "{building}: allowed (click to ban on this map)" }),
  banned: msg({ id: "buildingAvailability.banned", message: "Banned" }),
  banMode: msg({ id: "buildingAvailability.banMode", message: "Click a building to ban or allow it on this map" }),
  capBadge: msg({ id: "buildingAvailability.capBadge", message: "≤{level}" }),
  capDisabled: msg({ id: "buildingAvailability.capDisabled",
    message: "{building}: no level cap possible (banned, no building levels or highest tier 1)" }),
  capIneffective: msg({ id: "buildingAvailability.capIneffective",
    message: "{buildings}: level cap has no effect (banned, no building levels or not below the highest tier)" }),
  capMode: msg({ id: "buildingAvailability.capMode",
    message: "Click a building to lower its highest level one step (down to 1, then back to no cap)" }),
  capNone: msg({ id: "buildingAvailability.capNone",
    message: "{building}: no level cap (click to cap at level {next})" }),
  capSet: msg({ id: "buildingAvailability.capSet",
    message: "{building}: highest level {level} on this map (click to change)" }),
  chainBuild: msg({ id: "buildingAvailability.chainBuild",
    message: "{banned} banned → no {ware} → {buildings} cannot be built" }),
  chainWork: msg({ id: "buildingAvailability.chainWork",
    message: "{banned} banned → no {ware} → {buildings} cannot work" }),
  info: msg({ id: "buildingAvailability.info",
    message: "Highest tier = highest building level and material tier (2 hardwood + marble … 5 mahogany + granite). Banned buildings are hidden from the build menu; computer factions follow the same rules." }),
  levelCap: msg({ id: "buildingAvailability.levelCap", message: "Max level" }),
  more: msg({ id: "buildingAvailability.more", message: "{names} and {count} more" }),
  noSource: msg({ id: "buildingAvailability.noSource",
    message: "Tier {tier} is allowed but the map has no {wood} trees or {stone} deposit" }),
  tier: msg({ id: "buildingAvailability.tier", message: "Highest tier" }),
  tierOption: msg({ id: "buildingAvailability.tierOption", message: "Highest tier {tier}" }),
  title: msg({ id: "buildingAvailability.title", message: "Building availability" })
};
