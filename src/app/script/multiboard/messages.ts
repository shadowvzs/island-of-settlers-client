import { msg } from "@lingui/core/macro";

/** Copy of the multiboard windows; titles, headers and cells are map data (`QuestText`). */
export const MULTIBOARD_MESSAGES = {
  collapse: msg({ id: "script.multiboard.collapse", message: "Collapse {title}" }),
  expand: msg({ id: "script.multiboard.expand", message: "Expand {title}" }),
  stack: msg({ id: "script.multiboard.stack", message: "Information boards" })
};
