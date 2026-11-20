import { msg } from "@lingui/core/macro";

/** Soldier selection feedback (military controls P2, §7 and §11); written to the settlement message line. */
export const ARMY_SELECTION_MESSAGES = {
  firstUseTip: msg({
    id: "settlement.armySelection.firstUseTip",
    message: "Right-click to order: enemies attack, your buildings garrison or store, ground moves. Shift+drag selects. On touch: long-press."
  }),
  groupAssigned: msg({
    id: "settlement.armySelection.groupAssigned",
    message: "Group {digit}: {count, plural, one {# soldier} other {# soldiers}}."
  }),
  groupCleared: msg({ id: "settlement.armySelection.groupCleared", message: "Group {digit} cleared." }),
  groupEmpty: msg({ id: "settlement.armySelection.groupEmpty", message: "Group {digit} has no soldier on the map." }),
  noSoldiers: msg({ id: "settlement.armySelection.noSoldiers", message: "No soldier on the map to select." }),
  selectedType: msg({
    id: "settlement.armySelection.selectedType",
    message: "{count, plural, one {# soldier of this type selected.} other {# soldiers of this type selected.}}"
  })
} as const;

/** The rail's selection controls (box select and the control-group badges). */
export const ARMY_RAIL_SELECTION_MESSAGES = {
  boxSelect: msg({ id: "settlement.armyRail.boxSelect", message: "Box select" }),
  boxSelectTitle: msg({
    id: "settlement.armyRail.boxSelectTitle",
    message: "Box select: drag a box to add soldiers (touch). With a mouse, Shift+drag."
  }),
  groupBadge: msg({
    id: "settlement.armyRail.groupBadge",
    message: "Group {digit}: {count, plural, one {# soldier} other {# soldiers}}. Press {digit} to select it, Shift+{digit} to assign."
  }),
  groupBadgeAboard: msg({
    id: "settlement.armyRail.groupBadgeAboard",
    message: "Group {digit}: {count, plural, one {# soldier} other {# soldiers}} on the map, {aboard} aboard a ship (not selected). Press {digit} to select it, Shift+{digit} to assign."
  }),
  groupsHeading: msg({ id: "settlement.armyRail.groupsHeading", message: "Control groups" })
} as const;
