/** Shaft-only height revision: upper machinery/people translate without changing their scale or width. */
export const CATAPULT_ORIGINAL_SHAFT_HEIGHT = 1.65;
export const CATAPULT_SHAFT_HEIGHT = CATAPULT_ORIGINAL_SHAFT_HEIGHT * 1.5;
export const CATAPULT_HEIGHT_LIFT = CATAPULT_SHAFT_HEIGHT - CATAPULT_ORIGINAL_SHAFT_HEIGHT;
export const CATAPULT_DECK_HEIGHT = 1.77 + CATAPULT_HEIGHT_LIFT;
export const catapultRoofHeight = (original: number) => original + CATAPULT_HEIGHT_LIFT;

/** Forward cradle centre in the unscaled rig; conservatively clears the former40cm rock as well. */
export const CATAPULT_CARRY_FORWARD = .385;
/** Chest-height load centre keeps the shortest authored forearm rig within anatomical reach. */
export const CATAPULT_CARRY_HEIGHT = .91;
