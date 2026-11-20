import {
  arrayOf, checkValue, integer, literal, objectOf, optional, string
} from "../../../../../island-of-settlers-shared/src/validation/index";
import type { DiscoveryBits } from "../faction-discovery";
import { packBitSet, type PackedBits, unpackBitSet } from "../save-cell-codecs";
import {
  BITS_PER_BYTE, BUILD_GOAL_KEY, BUILD_GOAL_KEY_MAX_LENGTH, INVALID_DEVELOP_SAVE, MAX_BUILD_GOAL_TARGET,
  MAX_BUILD_GOALS, MAX_MINE_ZONE_ID
} from "./constants";
import type { MaintainBackoff } from "./maintain-state";

/** The goal the strategic layer committed to: the program goal's key and the count it wants now. */
export interface DevelopGoal {
  id: string;
  target: number;
}

/** A goal the planner could not place: it waits out its backoff (plan §3.5) until it is reached. */
export interface DevelopGoalBackoff extends MaintainBackoff {
  attempts: number;
  goal: string;
  retryTick: number;
}

/**
 * A `develop` faction's memory (plan §3.2-§3.6): the committed goal and the refused goals' backoffs (EAI3a); the
 * strategic posture the economy manager's stock targets follow, its rolling building cursor, the deposits its
 * geologists surveyed, the survey cursor and the discovered cells (EAI3c).
 */
export interface DevelopState {
  /** In refusal order. */
  backoffs: DevelopGoalBackoff[];
  /** The economy manager examines own buildings from this uid on (plan §3.3 rolling cursor). */
  cursor: number;
  /** Mine zone ids its geologists surveyed, ascending. */
  deposits: number[];
  /** Allocated when the faction first plays `develop` (`faction-discovery.ts`); never cleared. */
  discovered?: DiscoveryBits;
  /** The strategic posture: `fortify` while it knew of an enemy soldier at its last strategic decision. */
  fortify: boolean;
  goal?: DevelopGoal;
  /** The last mine zone id its survey decision tried (the next one tries a later zone). */
  surveyCursor: number;
}

/** What it saves: absent while it holds nothing (every `maintain` faction). */
export interface DevelopSave {
  backoffs?: DevelopGoalBackoff[];
  cursor?: number;
  deposits?: number[];
  /** `length` is the bit count: the island's cells rounded up to whole bytes. */
  discovered?: PackedBits;
  fortify?: true;
  goal?: DevelopGoal;
  surveyCursor?: number;
}

const goalKey = string({ maxLength: BUILD_GOAL_KEY_MAX_LENGTH, pattern: BUILD_GOAL_KEY });

const developSaveCheck = objectOf({
  backoffs: optional(arrayOf(objectOf({ attempts: integer(1), goal: goalKey, retryTick: integer(0) }),
    MAX_BUILD_GOALS)),
  cursor: optional(integer(1)),
  deposits: optional(arrayOf(integer(1, MAX_MINE_ZONE_ID), MAX_MINE_ZONE_ID)),
  discovered: optional(objectOf({ bits: string(), length: integer(1) })),
  fortify: optional(literal(true)),
  goal: optional(objectOf({ id: goalKey, target: integer(1, MAX_BUILD_GOAL_TARGET) })),
  surveyCursor: optional(integer(1, MAX_MINE_ZONE_ID))
});

export const createDevelopState = (): DevelopState =>
  ({ backoffs: [], cursor: 0, deposits: [], fortify: false, surveyCursor: 0 });

const copyBackoff = ({ attempts, goal, retryTick }: DevelopGoalBackoff): DevelopGoalBackoff =>
  ({ attempts, goal, retryTick });

/** A plain copy for the save; undefined while it holds nothing. Each part is saved only when it holds something. */
export const saveDevelopState = (state: DevelopState): DevelopSave | undefined => {
  const { backoffs, cursor, deposits, discovered, fortify, goal, surveyCursor } = state;
  const saved: DevelopSave = {
    ...(backoffs.length ? { backoffs: backoffs.map(copyBackoff) } : {}), ...(cursor ? { cursor } : {}),
    ...(deposits.length ? { deposits: [...deposits] } : {}),
    ...(discovered ? { discovered: packBitSet(discovered, discovered.length * BITS_PER_BYTE) } : {}),
    ...(fortify ? { fortify: true as const } : {}), ...(goal ? { goal: { ...goal } } : {}),
    ...(surveyCursor ? { surveyCursor } : {})
  };
  return Object.keys(saved).length ? saved : undefined;
};

/** A load: the saved memory (the discovered bits as a fresh array), or none. */
export const restoreDevelopState = (state: DevelopState, saved: DevelopSave | undefined) => {
  state.backoffs.length = 0;
  for (const entry of saved?.backoffs ?? []) state.backoffs.push(copyBackoff(entry));
  state.cursor = saved?.cursor ?? 0;
  state.deposits.splice(0, state.deposits.length, ...saved?.deposits ?? []);
  state.discovered = saved?.discovered && unpackBitSet(saved.discovered, saved.discovered.length);
  state.fortify = saved?.fortify === true;
  state.goal = saved?.goal && { ...saved.goal };
  state.surveyCursor = saved?.surveyCursor ?? 0;
};

const ascending = (values: readonly number[] | undefined) =>
  !values || values.every((value, at) => at === 0 || values[at - 1]! < value);

/** Whether the saved discovered bits are the island's: `cells` rounded up to whole bytes, decodable. */
const discoveryFits = (discovered: PackedBits | undefined, cells: number) => {
  if (!discovered) return true;
  if (discovered.length !== Math.ceil(cells / BITS_PER_BYTE) * BITS_PER_BYTE) return false;
  try {
    unpackBitSet(discovered, discovered.length);
    return true;
  } catch {
    return false;
  }
};

/**
 * Why a saved develop memory is refused, or null (absent is valid; never empty; one backoff per goal; deposits
 * ascending; discovered bits of the island's `cells` when given).
 */
export const developSaveError = (saved: unknown, cells?: number) => {
  if (saved === undefined) return null;
  if (checkValue(developSaveCheck, saved).length || !Object.keys(saved as object).length) return INVALID_DEVELOP_SAVE;
  const { backoffs, deposits, discovered } = saved as DevelopSave;
  if (backoffs?.length === 0 || deposits?.length === 0 || !ascending(deposits)) return INVALID_DEVELOP_SAVE;
  if (cells !== undefined && !discoveryFits(discovered, cells)) return INVALID_DEVELOP_SAVE;
  const goals = new Set(backoffs?.map(entry => entry.goal));
  return goals.size === (backoffs?.length ?? 0) ? null : INVALID_DEVELOP_SAVE;
};
