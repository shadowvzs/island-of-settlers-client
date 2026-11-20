import { isOwnBuilding } from "./settlement-home";

/**
 * Catapult ammunition kinds (owner CAT-AMMO, 2026-11-07). Every kind is an ordinary stone ware.
 * Plain `stone` is the default and is never written to a save, so default towers stay byte-identical.
 */
export const CATAPULT_AMMO_KINDS = Object.freeze(["stone", "basalt", "limestone", "granite", "marble"] as const);
export type CatapultAmmoKind = (typeof CATAPULT_AMMO_KINDS)[number];
export const DEFAULT_CATAPULT_AMMO: CatapultAmmoKind = "stone";

const AMMO_KIND_SET: ReadonlySet<string> = new Set(CATAPULT_AMMO_KINDS);
export const isCatapultAmmoKind = (value: unknown): value is CatapultAmmoKind =>
  typeof value === "string" && AMMO_KIND_SET.has(value);

/** The ware a tower requests for new deliveries; existing stock keeps its own kinds. */
export const catapultAmmoChoice = (site: { catapultAmmo?: CatapultAmmoKind }): CatapultAmmoKind =>
  site.catapultAmmo ?? DEFAULT_CATAPULT_AMMO;

/** Units of every ammunition kind in one goods record (roof input or incoming promises). */
export const catapultAmmoUnits = (goods: Readonly<Record<string, number>>) => {
  let units = 0;
  for (const kind of CATAPULT_AMMO_KINDS) units += goods[kind] ?? 0;
  return units;
};

/**
 * Oldest-first kind order of a stock. `undefined` means every unit is plain stone; a queue made only
 * of stone is dropped again so a tower that never switched keeps its original saved shape.
 */
export type CatapultKindQueue = CatapultAmmoKind[] | undefined;
export const compactKindQueue = (queue: CatapultKindQueue): CatapultKindQueue =>
  queue?.some(kind => kind !== DEFAULT_CATAPULT_AMMO) ? queue : undefined;
export const appendQueuedKinds = (
  queue: CatapultKindQueue, length: number, kind: CatapultAmmoKind, count: number
): CatapultKindQueue => {
  if (count <= 0 || (!queue && kind === DEFAULT_CATAPULT_AMMO)) return queue;
  const next = queue ?? Array<CatapultAmmoKind>(length).fill(DEFAULT_CATAPULT_AMMO);
  for (let unit = 0; unit < count; unit++) next.push(kind);
  return next;
};
export const kindQueueError = (queue: unknown, length: number) => {
  if (queue === undefined) return undefined;
  if (!Array.isArray(queue) || queue.length !== length || !queue.every(isCatapultAmmoKind))
    return "Invalid catapult ammo order";
  return undefined;
};

/** Per-kind shot multipliers (owner CAT-AMMO table, 2026-11-08). Frozen: every consumer is read-only. */
export interface CatapultAmmoProfile {
  readonly damage: number;
  readonly flightTime: number;
  readonly impactRadius: number;
  readonly range: number;
}
const BASE_PROFILE: CatapultAmmoProfile = Object.freeze({ damage: 1, flightTime: 1, impactRadius: 1, range: 1 });
const AMMO_PROFILES: Readonly<Record<CatapultAmmoKind, CatapultAmmoProfile>> = Object.freeze({
  basalt: Object.freeze({ ...BASE_PROFILE, impactRadius: 1.5, range: .8 }),
  granite: BASE_PROFILE,
  limestone: Object.freeze({ ...BASE_PROFILE, damage: .6, range: 1.3 }),
  marble: Object.freeze({ ...BASE_PROFILE, flightTime: .65, impactRadius: .35 }),
  stone: BASE_PROFILE
});
/** The single lookup point for kind-dependent shot values (range, flight, impact radius, damage). */
export const catapultAmmoProfile = (kind: CatapultAmmoKind | undefined): CatapultAmmoProfile =>
  AMMO_PROFILES[kind ?? DEFAULT_CATAPULT_AMMO] ?? BASE_PROFILE;

/** A finished Catapult Tower's ammunition goes through its ground pile and roof rack, never plain input. */
export const isCatapultAmmoStock = (
  building: { construction: number; typeId: number }, ware: string
): ware is CatapultAmmoKind =>
  building.typeId === 16 && building.construction === 1 && isCatapultAmmoKind(ware);

interface GroundAmmo {
  drops?: readonly { kind?: CatapultAmmoKind }[];
  ground: number;
  groundKinds?: readonly CatapultAmmoKind[];
}
const addKind = (goods: Record<string, number>, kind: CatapultAmmoKind | undefined) => {
  const ware = kind ?? DEFAULT_CATAPULT_AMMO;
  goods[ware] = (goods[ware] ?? 0) + 1;
};
/** A tower's ground pile and casualty drops per kind (salvage, holdings and plausibility accounting). */
export const catapultGroundGoods = (supply: GroundAmmo | undefined) => {
  const goods: Record<string, number> = {};
  if (!supply) return goods;
  for (let slot = 0; slot < supply.ground; slot++) addKind(goods, supply.groundKinds?.[slot]);
  for (const drop of supply.drops ?? []) addKind(goods, drop.kind);
  return goods;
};

interface AmmoChoiceSite {
  catapultAmmo?: CatapultAmmoKind; construction: number; militaryFaction?: number; typeId: number;
}
/**
 * Replayable player command: the player's Catapult Tower accepts a known kind, also while the site
 * is under construction. Stock already delivered keeps its kind and fires first; only new requests
 * use the new choice.
 */
export const setCatapultAmmo = (building: AmmoChoiceSite | undefined, kind: unknown) => {
  if (!building || building.typeId !== 16) return false;
  if (!isOwnBuilding(building) || !isCatapultAmmoKind(kind)) return false;
  if (kind === DEFAULT_CATAPULT_AMMO) delete building.catapultAmmo;
  else building.catapultAmmo = kind;
  return true;
};
