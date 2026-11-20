/** Page query switch of an admin play-test started from the map editor's Script window (`?testPlay=1`). */
export const TEST_PLAY_PARAM = "testPlay";
export const TEST_PLAY_ON = "1";
/** The play-test runs as a tool run: no account, no continued save, no cloud slot. */
export const TEST_PLAY_SKIP_LOGIN_PARAM = "skipLogin";
export const TEST_PLAY_MAP_PARAM = "map";
/** The browser tab every play-test reuses, so the editor stays open beside it. */
export const TEST_PLAY_TAB = "island-test-play";

/** Newest log lines kept (older ones are dropped). */
export const TEST_PLAY_LOG_CAPACITY = 400;
/** The log reaches the panel at this tick cadence (0.25 s), never per entry or per frame. */
export const TEST_PLAY_PUBLISH_TICKS = 5;
/** Longest printed variable value; the rest is cut with an ellipsis. */
export const TEST_PLAY_VALUE_LENGTH = 48;

/** The four line kinds of the log, in filter button order, with their HUD icons. */
export const TEST_PLAY_LOG_KINDS = ["run", "step", "quest", "variable"] as const;
export type TestPlayLogKind = (typeof TEST_PLAY_LOG_KINDS)[number];
export const TEST_PLAY_KIND_ICONS: Readonly<Record<TestPlayLogKind, string>> = {
  quest: "notice", run: "scroll", step: "build", variable: "inventory"
};
export const TEST_PLAY_CLEAR_ICON = "demolish";
export const TEST_PLAY_COLLAPSE_ICONS = { collapsed: "expand", expanded: "collapse" } as const;
