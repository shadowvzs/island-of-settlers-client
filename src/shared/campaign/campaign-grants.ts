import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import type { Goods } from "../settlement/settlement-types";

/**
 * A home-bound grant from a campaign run (level-up coins, later rewards) into `archipelago.rewards`. Its id is
 * unique within the run (for example `level-7`), so writing it twice never credits it twice: the run's marker keeps
 * the ids already written, and the run's save keeps the grants not written yet (owner decision 2026-11-11, point 1).
 */
export interface CampaignGrant {
  goods: Goods;
  id: string;
}

/** The run's side: grants waiting for their archipelago write. */
export interface CampaignGrantHolder {
  pendingGrants?: CampaignGrant[];
}

/** The marker's side: ids of the grants already written into `archipelago.rewards`. */
export interface CampaignGrantLedger {
  appliedGrants?: string[];
}


/** Ware counts: non-negative safe integers. */
export const isGoodsRecord = (value: unknown): value is Goods => isPlainObject(value) &&
  Object.values(value).every(count => Number.isSafeInteger(count) && (count as number) >= 0);

const isGrantId = (value: unknown) => typeof value === "string" && value.length > 0;
const isGrant = (value: unknown) => isPlainObject(value) && isGrantId(value.id) && isGoodsRecord(value.goods);

/** Why a run's stored pending grants are invalid; null when they are valid or absent. */
export const pendingGrantsError = (value: unknown) => {
  if (value === undefined) return null;
  return Array.isArray(value) && value.every(isGrant) ? null : "Invalid campaign grants";
};

/** Why a marker's stored applied grant ids are invalid; null when they are valid or absent. */
export const appliedGrantsError = (value: unknown) => {
  if (value === undefined) return null;
  return Array.isArray(value) && value.every(isGrantId) ? null : "Invalid campaign marker";
};

export const isGrantPending = (holder: CampaignGrantHolder, id: string) =>
  Boolean(holder.pendingGrants?.some(grant => grant.id === id));

/** Adds a grant to the pending list once; a pending id keeps its first goods. */
export const withPendingGrant = <T extends CampaignGrantHolder>(holder: T, grant: CampaignGrant): T => {
  if (isGrantPending(holder, grant.id)) return holder;
  const copy = { goods: { ...grant.goods }, id: grant.id };
  return { ...holder, pendingGrants: [...holder.pendingGrants ?? [], copy] };
};

/** Drops the written grants; an empty list is removed from the save. */
export const withoutPendingGrants = <T extends CampaignGrantHolder>(holder: T, ids: readonly string[]): T => {
  const written = new Set(ids);
  const pendingGrants = holder.pendingGrants?.filter(grant => !written.has(grant.id));
  if (pendingGrants?.length === holder.pendingGrants?.length) return holder;
  const { pendingGrants: _written, ...rest } = holder;
  return (pendingGrants?.length ? { ...rest, pendingGrants } : rest) as T;
};

/** The grants the ledger has not recorded yet, each id once. */
export const unappliedGrants = (ledger: CampaignGrantLedger | undefined, grants: readonly CampaignGrant[]) => {
  const seen = new Set(ledger?.appliedGrants);
  return grants.filter(grant => {
    if (seen.has(grant.id)) return false;
    seen.add(grant.id);
    return true;
  });
};

/** The ledger with the given ids recorded. */
export const withAppliedGrants = <T extends CampaignGrantLedger>(ledger: T, ids: readonly string[]): T =>
  ids.length ? { ...ledger, appliedGrants: [...ledger.appliedGrants ?? [], ...ids] } : ledger;
