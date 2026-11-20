/** Milliseconds between two reads of the simulation while the "why" window is open. */
export const ECONOMY_AI_POLL_MS = 500;
/** Listing order: scored goals, then unpaid ones (both by score), then the goals that were not scored. */
export const GOAL_STATUS_RANK = { backoff: 2, prerequisite: 2, scored: 0, tool: 2, unpaid: 1, unscored: 2 } as const;
/** Goals shown per faction (plan §3.4: "the scores of the top 3 goals"). */
export const TOP_GOALS = 3;
/** Refused plots listed per faction, newest first (the memo holds up to 32). */
export const LISTED_REFUSED_PLOTS = 5;
/** Goal scores are hundredths of a weight point; a factor is percent² (style × posture). */
export const SCORE_SCALE = 100;
export const FACTOR_SCALE = 10_000;
export const SCORE_DIGITS = 2;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PAD = 2;
/** The names of a waiting planner placement's steps, by saved stage. */
export const PLANNER_STAGE_LABELS = ["plot check", "road target", "placement"] as const;
/** Short layer names of the next-decision countdown, in `FACTION_AI_LAYERS` order. */
export const LAYER_INITIALS = ["S", "P", "E", "M"] as const;
/** Shown for a refusal that happened before the window was opened (the probe was off). */
export const REASON_NOT_RECORDED = "reason not recorded";
/** Map marks: refused plots and the waiting placement's candidates. */
export const PLOT_MARK_COLOURS = { candidate: "#3fa9f5", refused: "#e0503c", text: "#111" } as const;
export const PLOT_MARK_RADIUS = 5;
export const PLOT_MARK_FONT = "bold 11px sans-serif";
export const PLOT_MARK_LABEL_OFFSET = 8;
/** The handicap terms of `ScenarioFactionAi.bonus` in the "why" panel's order. */
export const BONUS_LABELS = ["construction", "production", "training"] as const;
