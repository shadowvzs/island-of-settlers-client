/** Pure helpers of the shared form primitives. */

/** One option of a select: the value it reports and its label. */
export interface SelectOption<T> {
  label: string;
  value: T;
}

const SECTION_ICONS: Record<string, string> = {
  About: "credits",
  Account: "people",
  Camera: "scout",
  "Current island": "map",
  Daylight: "weather",
  Graphics: "settings",
  Interface: "menu",
  "New island": "map",
  Sound: "sound",
  Sounds: "sound",
  "Time & weather": "weather",
  Workers: "people",
  World: "map"
};

/** Heading icon of a titled settings section. */
export const getSectionIcon = (title: string) => SECTION_ICONS[title] ?? "settings";

/** Caption of a level slider; `Name: value` is what the e2e drivers query (`^Name:`). */
export const formatLevelCaption = (label: string, levels: readonly string[], level: number) =>
  `${label}: ${levels[level]}`;

/** A 0..1 value as a whole 0..100 slider position. */
export const toPercent = (value: number) => Math.round(value * 100);

/** The ratio of a whole percent (100 → 1), the inverse of `toPercent`. */
export const fromPercent = (percent: number) => percent / 100;

/** Caption of a 0..100 % slider. */
export const formatPercentCaption = (label: string, percent: number) => `${label}: ${percent} %`;

/**
 * Option values of a select are the choice indices (as the DOM select always used): the selected
 * value's index as the select value, the first option when the value is not offered.
 */
export const getChoiceIndex = <T>(choices: readonly SelectOption<T>[], selected: T) =>
  String(Math.max(0, choices.findIndex(choice => choice.value === selected)));

/** The choice reported for a select value (an option index). */
export const getChoiceValue = <T>(choices: readonly SelectOption<T>[], index: string) =>
  choices[Number(index)]!.value;

/** Slider and apply tick share a bottom line; the centered variant aligns a select. */
export const getApplyRowClassName = (centered: boolean) => centered
  ? "settings-panel__apply-row settings-panel__apply-row--centered"
  : "settings-panel__apply-row";

/** Marks a toggle button while its option is on. */
export const getActiveClassName = (active: boolean) => (active ? "is-active" : undefined);

type ArrowSteps = Readonly<Record<string, number>>;

const HORIZONTAL_STEPS: ArrowSteps = { ArrowLeft: -1, ArrowRight: 1 };
const ALL_ARROW_STEPS: ArrowSteps = { ...HORIZONTAL_STEPS, ArrowDown: 1, ArrowUp: -1 };

/** Roving focus keys of a group of `count` items: arrows (`steps`) wrap, Home / End jump; null for any other key. */
const createRovingIndex = (steps: ArrowSteps) => (key: string, index: number, count: number) => {
  const step = steps[key];
  if (step) return (index + step + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
};

/** Index of the tab a key moves to in a horizontal tab row (left / right, Home / End). */
export const getNextTabIndex = createRovingIndex(HORIZONTAL_STEPS);

/** Index a key moves to in a vertical list or radio group (all four arrows, Home / End). */
export const getNextRovingIndex = createRovingIndex(ALL_ARROW_STEPS);

/** Ids of one tab and its panel (`{prefix}-tab-{id}` / `{prefix}-panel-{id}`). */
export const getTabIds = (prefix: string, id: string) => ({
  panelId: `${prefix}-panel-${id}`,
  tabId: `${prefix}-tab-${id}`
});

/** One tab with its panel, ready to render: ids, selection and roving tab index. */
export interface TabRow<T> {
  /** `data-ui-anchor` of the tab button (map script highlights), when the tab list has an anchor prefix. */
  anchor?: string;
  content: T;
  id: string;
  index: number;
  label: string;
  panelId: string;
  selected: boolean;
  tabId: string;
  tabIndex: number;
}

export const getTabRows = <T>(
  prefix: string,
  items: readonly { content: T; id: string; label: string }[],
  active: number,
  anchorPrefix?: string
): TabRow<T>[] => items.map((item, index) => ({
  ...item,
  ...getTabIds(prefix, item.id),
  anchor: anchorPrefix && `${anchorPrefix}.${item.id}`,
  index,
  selected: index === active,
  tabIndex: index === active ? 0 : -1
}));


/** Status line of a command that returns `true` or the reason it was refused. */
/** A command's outcome: done, or the reason it was refused. */
export type CommandOutcome = true | string;
/** At once, or once the server answered (gem shop and talent reset of signed-in players). */
export type PendingCommand = CommandOutcome | Promise<CommandOutcome>;
export const COMMAND_PENDING = "Asking the server…";
const COMMAND_FAILED = "The server did not answer. Please try again.";

/** The server's outcome; a failed request reads as a refusal the player can retry. */
const outcomeOf = async (result: Promise<CommandOutcome>) => {
  try {
    return await result;
  } catch {
    return COMMAND_FAILED;
  }
};

/** Runs `done` with the outcome, now or when the server answers (`pending` first shows the wait). */
export const settleCommand = (result: PendingCommand, done: (outcome: CommandOutcome) => void,
  pending?: () => void) => {
  if (typeof result !== "object") { done(result); return; }
  pending?.();
  void (async () => { done(await outcomeOf(result)); })();
};

export const getCommandStatus = (result: true | string, successText: string) =>
  result === true ? successText : result;

/** A status line's text and the key it belongs to (e.g. the building uid, the open count and tab). */
export interface KeyedStatus {
  key: unknown;
  text: string;
}

/** The status for `key`: the same entry while the key holds, else an empty one (an old text never returns). */
export const toKeyedStatus = (entry: KeyedStatus, key: unknown): KeyedStatus =>
  (Object.is(entry.key, key) ? entry : { key, text: "" });

/** Joins the detail parts that are set with " · " ("Forest · 64×64 map"); empty when none is. */
export const joinDetails = (...parts: readonly (string | false | undefined)[]) => parts.filter(Boolean).join(" · ");

/** Joins the class names that are set, e.g. `joinClassNames("settlement-ui__button", extra)`. */
export const joinClassNames = (...names: readonly (string | false | undefined)[]) =>
  names.filter(Boolean).join(" ");
