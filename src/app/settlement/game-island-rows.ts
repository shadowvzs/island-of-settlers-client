import type { IslandKey } from "../../shared/settlement/game-save-rows";

/**
 * Dirty-row writes of the browser game database (research 12, S07). An island row (map delta,
 * settlement, runtime...) is rewritten only when its content changed: every save signs the rows it is
 * about to write (a SHA-256 of their JSON, taken before the expensive map compaction) and an island
 * whose signature is already stored under the same key is neither compacted nor written again. The
 * island on screen is always rewritten (its tick state moves); filed islands (colonies, adventures, the
 * home island while away) usually stay unchanged between saves.
 */
export const ISLAND_SIGNATURE_INDEX = "signature";

/** The signature index orders rows by [slotId, islandId, signature]: one key lookup tells a row is current. */
export const islandSignatureKey = (slotId: string, id: IslandKey, signature: string) => [slotId, id, signature];

/** Stable content signature of a row's save document (SHA-256 hex of its JSON text). */
export const islandSignature = async (save: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
};

export interface SignedIsland { id: IslandKey; signature: string }

/** Islands whose current signature is already stored: they are neither compacted nor written. */
export const keptIslands = (signed: readonly SignedIsland[], stored: ReadonlySet<IslandKey>) =>
  new Map(signed.filter(island => stored.has(island.id)).map(island => [island.id, island.signature]));

/** Row ids stored for the slot that the new game no longer has (an expired colony): they are deleted. */
export const staleIslandIds = (storedIds: readonly IslandKey[], nextIds: readonly IslandKey[]) =>
  storedIds.filter(id => !nextIds.includes(id));

/** The write failed because a row the save relied on was gone: the caller rewrites every island. */
export class KeptIslandMissing extends Error {
  constructor() {
    super("A kept island row disappeared during the save");
    this.name = "KeptIslandMissing";
  }
}
