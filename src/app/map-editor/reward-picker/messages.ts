import { msg } from "@lingui/core/macro";

/** Reward picker copy (editor UI; en source, hu in the PO). */
export const REWARD_PICKER_MESSAGES = {
  amountOf: msg({ id: "rewardPicker.amountOf", message: "Amount of {name}" }),
  empty: msg({ id: "rewardPicker.empty", message: "No reward selected yet: pick one from the tabs." }),
  noMatches: msg({ id: "rewardPicker.noMatches", message: "Nothing matches \"{query}\"." }),
  removeName: msg({ id: "rewardPicker.removeName", message: "Remove {name}" }),
  search: msg({ id: "rewardPicker.search", message: "Search rewards" }),
  searchPlaceholder: msg({ id: "rewardPicker.searchPlaceholder", message: "Name (English or Hungarian)" }),
  selected: msg({ id: "rewardPicker.selected", message: "Selected rewards" }),
  tabCount: msg({ id: "rewardPicker.tabCount", message: "{label} ({count})" }),
  tabs: {
    decorations: msg({ id: "rewardPicker.tabs.decorations", message: "Decorations" }),
    misc: msg({ id: "rewardPicker.tabs.misc", message: "Misc" }),
    people: msg({ id: "rewardPicker.tabs.people", message: "People" }),
    wares: msg({ id: "rewardPicker.tabs.wares", message: "Wares" })
  },
  tabsLabel: msg({ id: "rewardPicker.tabsLabel", message: "Reward kinds" }),
  title: msg({ id: "rewardPicker.title", message: "Choose rewards" }),
  unknownDecoration: msg({
    id: "rewardPicker.unknownDecoration",
    message: "Unknown decoration id \"{id}\": it is not in the decoration catalog. Remove it and pick one from the tab."
  })
};
