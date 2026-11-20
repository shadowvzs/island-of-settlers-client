import {
  CAPSTONE_BRANCH_POINTS, MAX_PLAYER_LEVEL, TALENT_MAX_RANK, TALENT_POINTS_PER_LEVEL, type TalentBranch,
  type TalentDefinition, type TalentModifiers, TALENTS, TIER_GATE_POINTS
} from "@shared/catalog/balance";

/** Applied ranks per talent id; talents without points are absent. */
export type TalentRanks = Readonly<Record<string, number>>;

const TALENT_BY_ID: ReadonlyMap<string, TalentDefinition> = new Map(TALENTS.map(entry => [entry.id, entry]));

const findTalent = (id: string) => TALENT_BY_ID.get(id);

const ZERO_MODIFIERS: TalentModifiers = {
  adventureExperience: 0, adventureLoot: 0, adventureSailingReduction: 0, carrierSpeed: 0, colonyProductionSpeed: 0,
  colonyShipIntervalReduction: 0, colonyStartSettlers: 0, constructionSpeed: 0, dockPorterSpeed: 0, doorStrength: 0,
  fieldGrowthSpeed: 0, handcartCapacity: 0, hunterFisherSpeed: 0, populationLimit: 0, productionSpeed: 0,
  questRewards: 0, recruitTrainingSpeed: 0, settlerGrowthSpeed: 0, shippingTimeReduction: 0, siegeDamage: 0,
  soldierDamage: 0, soldierHealth: 0, storageCapacity: 0, towerArcherDamage: 0, tradeOfferSlots: 0, treeGrowthSpeed: 0
};
/** No talents: every hook multiplies by one (or adds zero). */
export const NEUTRAL_TALENT_MODIFIERS: Readonly<TalentModifiers> = Object.freeze({ ...ZERO_MODIFIERS });

/** Points a player level grants: one per level from level 1 (80 at level 80). */
export const talentPointsForLevel = (level: number) =>
  Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(level))) * TALENT_POINTS_PER_LEVEL;

export const rankOf = (ranks: TalentRanks, id: string) => ranks[id] ?? 0;

export const spentTalentPoints = (ranks: TalentRanks) =>
  Object.values(ranks).reduce((sum, rank) => sum + rank, 0);

/** Points in a branch's non-capstone talents: what opens the capstone. */
export const branchGatePoints = (ranks: TalentRanks, branch: TalentBranch) =>
  TALENTS.reduce((sum, entry) =>
    entry.branch === branch && !entry.capstone ? sum + rankOf(ranks, entry.id) : sum, 0);

export const isCapstoneOpen = (ranks: TalentRanks, definition: TalentDefinition) =>
  !definition.capstone || branchGatePoints(ranks, definition.branch) >= CAPSTONE_BRANCH_POINTS;

/** Points in one tier of a branch: what opens the tier below. */
export const tierPoints = (ranks: TalentRanks, branch: TalentBranch, tier: number) =>
  TALENTS.reduce((sum, entry) =>
    entry.branch === branch && entry.tier === tier ? sum + rankOf(ranks, entry.id) : sum, 0);

/** Tiers 2 and 3 open after TIER_GATE_POINTS in the branch's tier above; tier 1 and capstones have no tier gate. */
export const isTierOpen = (ranks: TalentRanks, definition: TalentDefinition) =>
  definition.tier < 2 || Boolean(definition.capstone) ||
  tierPoints(ranks, definition.branch, definition.tier - 1) >= TIER_GATE_POINTS;

/** The tier rule's refusal for a closed tier. */
const tierGateReason = (definition: TalentDefinition) =>
  `Requires ${TIER_GATE_POINTS} points in tier ${definition.tier - 1} of this branch`;

const isRank = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 &&
  (value as number) <= TALENT_MAX_RANK;

/** Saved shape: known talent ids with whole ranks 0..max (no level needed). */
export const isTalentRanksShape = (value: unknown): value is TalentRanks =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
  Object.entries(value as object).every(([id, rank]) => TALENT_BY_ID.has(id) && isRank(rank));

/** Why the next rank of `id` is refused, or true: max rank, free points, level, tier and capstone gates. */
export const talentRaiseCheck = (ranks: TalentRanks, id: string, level: number): true | string => {
  const definition = findTalent(id);
  if (!definition) return "Unknown talent";
  if (rankOf(ranks, id) >= TALENT_MAX_RANK) return "This talent is at its highest rank";
  if (level < definition.requiredLevel) return `Requires level ${definition.requiredLevel}`;
  if (!isTierOpen(ranks, definition)) return tierGateReason(definition);
  if (!isCapstoneOpen(ranks, definition))
    return `Requires ${CAPSTONE_BRANCH_POINTS} points in this branch`;
  if (spentTalentPoints(ranks) >= talentPointsForLevel(level)) return "No talent points left";
  return true;
};

/** The ranks with one more point in `id`; unchanged when refused. */
export const raiseTalent = (ranks: TalentRanks, id: string, level: number): TalentRanks =>
  talentRaiseCheck(ranks, id, level) === true ? { ...ranks, [id]: rankOf(ranks, id) + 1 } : ranks;

/** Full rule check: shape, points within the level, level, tier and capstone gates. */
export const talentRanksError = (value: unknown, level: number): string | null => {
  if (!isTalentRanksShape(value)) return "Invalid talent ranks";
  if (spentTalentPoints(value) > talentPointsForLevel(level)) return "More talent points than the level grants";
  for (const [id, rank] of Object.entries(value)) {
    if (!rank) continue;
    const definition = findTalent(id)!;
    if (level < definition.requiredLevel) return `Talent ${id} requires level ${definition.requiredLevel}`;
    if (!isTierOpen(value, definition)) return `Talent ${id} ${tierGateReason(definition).toLowerCase()}`;
    if (!isCapstoneOpen(value, definition)) return `Talent ${id} requires ${CAPSTONE_BRANCH_POINTS} branch points`;
  }
  return null;
};

/** `next` keeps every applied rank and only adds points. */
export const keepsAppliedRanks = (applied: TalentRanks, next: TalentRanks) =>
  Object.entries(applied).every(([id, rank]) => rankOf(next, id) >= rank);

/** Drops zero ranks so equal trees compare and save the same. */
export const compactTalentRanks = (ranks: TalentRanks): TalentRanks =>
  Object.fromEntries(Object.entries(ranks).filter(([, rank]) => rank > 0).sort(([a], [b]) => a.localeCompare(b)));

const modifierCache = new WeakMap<object, Readonly<TalentModifiers>>();

const buildModifiers = (ranks: TalentRanks) => {
  const modifiers: TalentModifiers = { ...ZERO_MODIFIERS };
  for (const [id, rank] of Object.entries(ranks)) {
    const definition = findTalent(id);
    if (!definition || !isRank(rank)) continue;
    for (const { modifier, perRank } of definition.effects) modifiers[modifier] += perRank * rank;
  }
  // Two decimals keep 5 × 0.05 exactly 0.25 for every hook and display.
  for (const key of Object.keys(modifiers) as (keyof TalentModifiers)[])
    modifiers[key] = Math.round(modifiers[key] * 1e6) / 1e6;
  return Object.freeze(modifiers);
};

/**
 * One frozen modifiers object per ranks object, computed when ranks change (never per frame). Ranks
 * that fail the shape check give the neutral modifiers.
 */
export const talentModifiers = (ranks: TalentRanks | undefined): Readonly<TalentModifiers> => {
  if (!ranks || !isTalentRanksShape(ranks)) return NEUTRAL_TALENT_MODIFIERS;
  let modifiers = modifierCache.get(ranks);
  if (!modifiers) { modifiers = buildModifiers(ranks); modifierCache.set(ranks, modifiers); }
  return modifiers;
};

/** The largest value a modifier reaches with every talent changing it at its highest rank. */
export const maximumTalentModifier = (modifier: keyof TalentModifiers) =>
  TALENTS.reduce((sum, entry) => sum + entry.effects.reduce((total, effect) =>
    effect.modifier === modifier ? total + effect.perRank * TALENT_MAX_RANK : total, 0), 0);

/** A duration shortened by a time-reduction share (−5% → ×0.95); never below 10%. */
export const reducedDuration = (seconds: number, reduction: number) =>
  seconds * Math.max(.1, 1 - reduction);

/** A rate sped up so that the duration shrinks by `reduction` (−25% time → ×1.33 rate). */
export const timeReductionRate = (reduction: number) => 1 / Math.max(.1, 1 - reduction);
