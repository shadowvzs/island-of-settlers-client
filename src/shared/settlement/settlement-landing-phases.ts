/** The phases of a soldier landing from an anchored ship (adventure landing, colony raid ship). */
/** On the anchored ship, waiting for a turn on the gangway (an adventure's soldiers stand on its deck). */
export const ADVENTURE_ABOARD = "adventureAboard";
/** Walking down the gangway from the ship's side to the shore. */
export const ADVENTURE_GANGWAY = "adventureGangway";
/** Aboard the landing ship or on its gangway. */
export const ADVENTURE_SHIP_PHASES: readonly string[] = [ADVENTURE_ABOARD, ADVENTURE_GANGWAY];
/**
 * A rider riding on from the gangway foot over a beach too narrow for a horse's room (owner, 2026-10-15),
 * until his horse has room and a way to his gathering place.
 */
export const ADVENTURE_BEACH = "adventureBeach";
export const ADVENTURE_LANDING_PHASES: readonly string[] = [...ADVENTURE_SHIP_PHASES, ADVENTURE_BEACH];
