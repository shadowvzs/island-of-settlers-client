/** Original sewn flour sack, uniformly smaller in inventory, stock and transport. */
export const FLOUR_BAG_SCALE = .8;

/** Uniform enlargement of the original trunk, including both cut ends. */
export const LOG_WARE_SCALE = 1.35;

/** Pigfarm residents and every canonical pig ware share the requested 10% reduction. */
export const PIG_VISUAL_SCALE = .9;

/** The beer cask is 30% smaller in every physical stock, carry, cart and horse-cargo model. */
export const BEER_VISUAL_SCALE = .7;

/** Carried/stocked cut-stone block: one cube edge and its centre above the ware origin. */
export const STONE_WARE_BLOCK = Object.freeze({ centreY: .04725, edge: .255 });
