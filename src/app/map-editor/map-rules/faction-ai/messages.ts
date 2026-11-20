import { msg } from "@lingui/core/macro";

/** Computer factions rows of the Map rules section (editor UI; English source, hu/de from the translation batch). */
export const FACTION_AI_MESSAGES = {
  add: msg({ id: "factionAi.add", message: "Add a computer faction row (it is saved once its mode is not None)" }),
  bonus: {
    construction: msg({ id: "factionAi.bonus.construction", message: "Build" }),
    production: msg({ id: "factionAi.bonus.production", message: "Produce" }),
    training: msg({ id: "factionAi.bonus.training", message: "Train" })
  },
  bonusHint: msg({
    id: "factionAi.bonusHint",
    message: "Map-maker handicap in percent, {min}–{max}: 100 or empty is no bonus."
  }),
  bonusTitle: msg({ id: "factionAi.bonusTitle", message: "Bonus %" }),
  chip: msg({ id: "factionAi.chip", message: "Computer faction {faction}" }),
  chipNation: msg({ id: "factionAi.chipNation", message: "Computer faction {faction} ({nation})" }),
  details: msg({ id: "factionAi.details", message: "Depot start, bonus and limits of computer faction {faction}" }),
  depotEmpty: msg({ id: "factionAi.depotEmpty", message: "Empty depot" }),
  handicap: msg({ id: "factionAi.handicap", message: "Handicap +{percent} %" }),
  level: msg({
    id: "factionAi.level",
    message: "AI level: reaction time and decision quality, never extra information"
  }),
  levels: {
    easy: msg({ id: "factionAi.levels.easy", message: "Easy" }),
    hard: msg({ id: "factionAi.levels.hard", message: "Hard" }),
    island: msg({ id: "factionAi.levels.island", message: "Island" }),
    medium: msg({ id: "factionAi.levels.medium", message: "Medium" })
  },
  limitAuto: msg({ id: "factionAi.limitAuto", message: "auto" }),
  limitHint: msg({
    id: "factionAi.limitHint",
    message: "Hard cap {min}–{max}; empty uses the mode default (develop: the cap, maintain: what the map authored)."
  }),
  limits: {
    buildings: msg({ id: "factionAi.limits.buildings", message: "Buildings" }),
    population: msg({ id: "factionAi.limits.population", message: "Civilians" }),
    soldiers: msg({ id: "factionAi.limits.soldiers", message: "Soldiers" })
  },
  limitsTitle: msg({ id: "factionAi.limitsTitle", message: "Limits" }),
  modes: {
    develop: msg({
      id: "factionAi.modes.develop",
      message: "Develop: builds and grows its own economy and army from its depot start"
    }),
    maintain: msg({
      id: "factionAi.modes.maintain",
      message: "Maintain: repairs, re-garrisons and rebuilds what the map placed, from its depot stock only"
    }),
    none: msg({ id: "factionAi.modes.none", message: "None: authored units and buildings only (today's behaviour)" })
  },
  pendingNote: msg({ id: "factionAi.pendingNote", message: "Needs P1/P2" }),
  pendingHint: msg({
    id: "factionAi.pendingHint",
    message: "Maintain and develop are saved with the map but play as None until the economy AI phases P1/P2 land."
  }),
  picker: {
    empty: msg({ id: "factionAi.picker.empty", message: "No depot start: pick wares, settlers or soldiers." }),
    selected: msg({ id: "factionAi.picker.selected", message: "Depot start" }),
    title: msg({ id: "factionAi.picker.title", message: "Add wares and people" })
  },
  styles: {
    aggressive: msg({ id: "factionAi.styles.aggressive", message: "Aggressive: an early army that attacks often" }),
    balanced: msg({ id: "factionAi.styles.balanced", message: "Balanced: economy and army in step (default)" }),
    disabled: msg({ id: "factionAi.styles.disabled", message: "{style} (develop mode only)" }),
    turtle: msg({ id: "factionAi.styles.turtle", message: "Turtle: strong defences, rarely attacks" })
  },
  title: msg({ id: "factionAi.title", message: "Computer factions" }),
  titleHint: msg({
    id: "factionAi.titleHint",
    message: "How the computer plays each enemy faction of this map. One faction may develop; any number may maintain."
  })
};
