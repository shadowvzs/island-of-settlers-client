/** Constants of the quest form, the quest list and the declared home rewards (design §13.6, lane TRG12). */

/** "Completed when" choices the author picks among (built-in kinds come from templates and stay as they are). */
export const OBJECTIVE_CHOICES = ["condition", "counterReached", "scripted"] as const;
export type ObjectiveChoice = (typeof OBJECTIVE_CHOICES)[number];

export const DEADLINE_KINDS = ["none", "playTime", "gameTime", "date", "dateAfterActivation"] as const;
export type DeadlineChoice = (typeof DEADLINE_KINDS)[number];

export const REPEAT_KINDS = ["once", "onCompletion", "interval", "calendar"] as const;

export const OCCURRENCE_KINDS = ["once", "window", "counter"] as const;

/** A new counter objective: counts tools made since activation, target 10. */
export const DEFAULT_COUNTER = "tools";
export const DEFAULT_COUNTER_TARGET = 10;

/** A new play-time or game-time deadline (seconds) and a new interval repeat (one day). */
export const DEFAULT_DEADLINE_SECONDS = 600;
export const DEFAULT_INTERVAL_DAYS = 1;

/** Upcoming claim windows the repeat preview lists. */
export const CLAIM_PREVIEW_COUNT = 3;

/** How far ahead the calendar preview looks for windows (days). */
export const CLAIM_PREVIEW_HORIZON_DAYS = 800;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Calendar menus: months 1..12, days 1..31, weekdays 0 (Sunday)..6. */
export const MONTHS_IN_YEAR = 12;
export const DAYS_IN_LONGEST_MONTH = 31;
export const DAYS_IN_WEEK = 7;

/** Default players of a declared counter reward (the shared limit is `SCRIPT_LIMITS.homeRewardOccurrences`). */
export const DEFAULT_REWARD_OCCURRENCES = 3;

/** A reference year for month and weekday names: 2023-01-01 was a Sunday. */
export const REFERENCE_YEAR = 2023;
export const SUNDAY_REFERENCE_UTC = Date.UTC(REFERENCE_YEAR, 0, 1);

/** Player-visible texts a new quest or group starts with (all game languages; the author edits them). */
export const NEW_QUEST_TITLE = { de: "Neue Quest", en: "New quest", hu: "Új küldetés" } as const;
export const NEW_GROUP_TITLE = { de: "Neue Gruppe", en: "New group", hu: "Új csoport" } as const;
