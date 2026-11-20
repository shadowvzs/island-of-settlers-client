/**
 * Tick phases of the computer commander (`tick-phase-profile.ts`). Both group under `commander` when the
 * phases are summed by their dotted prefix.
 */

/** Clocks, perception, squads, scores and order choice: the commander's own decision cost. */
export const COMMANDER_PHASE = "commander";
/** The marches a decision orders (flow fields, formation places): the order layer's cost. */
export const COMMANDER_MARCH_PHASE = "commander.march";
