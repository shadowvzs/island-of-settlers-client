import { buildingsWithRules } from "@shared/catalog/building-data/rules";

/** Starter stock, road speeds and sawmill recipes are shared balance data (`@shared/catalog/balance`). */

/**
 * Carrier walking speed on dirt (cells/s). Owner BAL-01 2026-10-21: 30% below the former 1.2, so
 * carriers walk instead of running; roads and the carrier speed talent multiply it.
 */
export const CARRIER_WALK_SPEED = 1.2 * 0.7;
/** Ordinary worker walking speed before per-actor road/movement modifiers. */
export const WORKER_WALK_SPEED = .9;
/** Real seconds a production worker rests between cycles, before building-level/talent speed. */
export const WORKER_REST_SECONDS = 2;
/** Real seconds for one stock pickup/putdown animation, before in-place work-speed scaling. */
export const WARE_TRANSFER_SECONDS = 1;
/** Initial balance: one stone per half-cell segment upgraded; dirt construction is free. */
export const ROAD_STONE_COST = 1;

/** Shared shelf capacity for ordinary production outputs, upgraded or not (owner, 2026-10-19). */
export const PRODUCTION_OUTPUT_CAPACITY = 6;
/**
 * Production tempo (owner BAL-01, 2026-10-21): every production worker's in-place cycle (work timers,
 * waits, rest and the clips sampled from them) runs this much faster, i.e. production times are halved.
 * Rule seconds stay authored at rate 1; `production-timing.ts` turns them into real seconds.
 */
export const PRODUCTION_SPEED_FACTOR = 2;
/**
 * Building-material tiers (owner BAL-01): a tier-N material (RESOURCE_TIERS: 0 softwood/stone,
 * 1 hardwood/marble, 2 cedar/limestone, 3 walnut/basalt, 4 mahogany/granite) takes
 * 1 + this × N times its base building's cycle (+20% per tier).
 */
export const MATERIAL_TIER_TIME_STEP = 0.2;
/** Storage capacity per storage building type before its upgrade (rules sidecar `storage.capacity`). */
export const STORAGE_BASE_CAPACITY: Readonly<Record<number, number>> = Object.freeze(Object.fromEntries(
  buildingsWithRules().flatMap(({ entry, rules }) => rules.storage ? [[entry.code, rules.storage.capacity]] : [])));

/** Seconds from sprout to the mature tree. */
export const TREE_GROWTH_SECONDS = 120;
export const WHEAT_BATCH_SIZE = 8;
export const WHEAT_FIELD_LIMIT = 24;
export const WHEAT_GROWTH_SECONDS = 120;
/** The Flax Farm's four bounded reusable plots (FLAX-CLOTH-SHIPS-01 initial tuning). */
export const FLAX_FIELD_LIMIT = 4;
export const FLAX_GROWTH_SECONDS = 60;

/**
 * Live carrier carts (2026-10-12 integration). Values marked "owner" are conservative picks for
 * decisions the plan left open; see docs/plans/handcart-prototype-plan.md "Owner questions".
 */
export const HANDCART_LOGISTICS = Object.freeze({
  enabled: true,
  /** A cart only leaves for at least this many items; single items stay with ordinary carriers. */
  minItems: 2,
  /**
   * Owner 2026-11-08 cart priority: a job is cart-worthy from more than one walking load and at
   * least this share of a full cart load (stone: 3 of 6). Walkers keep the smaller jobs.
   */
  cartWorthyLoadShare: .5,
  /**
   * A free carrier fetches a crewless cart only while (walk to the cart + cart trip at cart speed)
   * is at most this factor times its own walking trip for the same job.
   */
  fetchDetourFactor: 1.5,
  /** Seconds to move one item between the cart bed and the building at its road endpoint. */
  itemSeconds: .8,
  /** Pulling speed relative to an ordinary carrier on the same road (owner: 0.9). */
  speedFactor: .9,
  /** Carts one storage may own (owner: 4). */
  storageLimit: 4,
  /** Logs the Sawmill uses for one cart (owner 2026-10-13: 4 logs); also the refund of a dismantled cart. */
  cost: Object.freeze({ logs: 4 }) as Readonly<Record<string, number>>
});

/**
 * Owner 2026-11-09 demand-based delivery: a consumer that has waited this many ticks (20 s) for a ware ranks
 * as if it needed one more item, so a small consumer is never starved by a larger one.
 */
export const DEMAND_RANKING = Object.freeze({ waitTicksPerUnit: 400 });
