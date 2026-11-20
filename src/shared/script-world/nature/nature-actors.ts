import { entryByCode, entryByKey, propEntryByCode } from "@shared/catalog";

import type { ScriptEventActor } from "../../../../../island-of-settlers-shared/src/script/types/emission";
import type {
  ActorHandleSpace, ActorHandleValue
} from "../../../../../island-of-settlers-shared/src/script/types/values";
import type { WorldData } from "../../world/world-data";
import type { ScriptWildlifeSlots } from "./nature-source";

/**
 * How the map script sees nature (trigger design §5.1.5, §6.7, lane TRG3b): ground props (trees, stones, plants)
 * in the `prop` space by prop index, wildlife in the `animal` space by pool slot, shore shells in the `shell` space
 * by spot index. Slots that are reused (a dead animal's slot, a respawned boulder, a shell that reappears
 * elsewhere) carry a generation (`NatureGenerations`), so an old handle resolves to gone, never to the successor.
 * Nature is ownerless (`owner: null`): the event `player` filter of neutral subjects matches `any`/`neutral`.
 */

export type NatureSpace = Extract<ActorHandleSpace, "animal" | "prop" | "shell">;

/** Sparse per-slot generations of each reused nature space (absent = 0); saved with the script state. */
export type NatureGenerations = Record<NatureSpace, Map<number, number>>;

export const NATURE_SPACES: readonly NatureSpace[] = ["animal", "prop", "shell"];

export const isNatureSpace = (space: ActorHandleSpace): space is NatureSpace =>
  (NATURE_SPACES as readonly string[]).includes(space);

/** Saved form: flat `[slot, generation, …]` pairs per space; present only when a slot was reused. */
export type SavedNatureGenerations = Partial<Record<NatureSpace, number[]>>;

const pairsToMap = (pairs: readonly number[] = []) => {
  const map = new Map<number, number>();
  for (let index = 0; index + 1 < pairs.length; index += 2) map.set(pairs[index]!, pairs[index + 1]!);
  return map;
};

export const createNatureGenerations = (saved: SavedNatureGenerations = {}): NatureGenerations =>
  ({ animal: pairsToMap(saved.animal), prop: pairsToMap(saved.prop), shell: pairsToMap(saved.shell) });

/** Slots ascending; empty spaces are left out, so a script save without reuse stays byte-identical. */
export const saveNatureGenerations = (generations: NatureGenerations): { nature?: SavedNatureGenerations } => {
  const saved: SavedNatureGenerations = {};
  for (const space of NATURE_SPACES) {
    const map = generations[space];
    if (map.size) saved[space] = [...map].sort(([a], [b]) => a - b).flat();
  }
  return Object.keys(saved).length ? { nature: saved } : {};
};

export const natureHandle = (generations: NatureGenerations, space: NatureSpace, id: number): ActorHandleValue =>
  ({ generation: generations[space].get(id) ?? 0, id, space });

/** The slot's next incarnation is another object. */
export const bumpGeneration = (generations: NatureGenerations, space: NatureSpace, id: number) => {
  generations[space].set(id, (generations[space].get(id) ?? 0) + 1);
};

const entryActor = (
  entry: { family: string; id: string } | undefined, handle: ActorHandleValue
): ScriptEventActor | undefined => entry && { family: entry.family, handle, owner: null, type: entry.id };

/** A ground prop (tree, stone, plant, shell prop) by its prop index; undefined for a removed or unknown prop. */
export const describeProp = (world: WorldData, generations: NatureGenerations, id: number) => {
  if (id < 0 || id >= world.props.count) return undefined;
  return entryActor(propEntryByCode(world.props.types[id]!), natureHandle(generations, "prop", id));
};

/** A wildlife slot's animal (`animal:*` by the pool species code). */
export const describeAnimal = (slots: ScriptWildlifeSlots, generations: NatureGenerations, slot: number) =>
  entryActor(entryByCode("animal", slots.species(slot)), natureHandle(generations, "animal", slot));

/** A shore shell spot (`shell:<kind>`, the kind names are the catalog keys). */
export const describeShell = (generations: NatureGenerations, index: number, kind: string) =>
  entryActor(entryByKey("shell", kind), natureHandle(generations, "shell", index));

/** An ore deposit type (`deposit:*` by the mine zone's ore code). */
export const depositType = (ore: number) => entryByCode("deposit", ore)?.id;
