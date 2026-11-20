import { propEntryByCode } from "@shared/catalog";

import type { ScriptEventActor } from "../../../../../island-of-settlers-shared/src/script/types/emission";
import type { ActorHandleValue } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { getMeshKind } from "../../../render-common/props/prop-mesh-layout";
import { listShoreShellSpots } from "../../../render-common/props/shore-shell-spots";
import type { SettlementContext } from "../../settlement/settlement-types";
import { getShoreShellPositions } from "../../settlement/shore-shell-collection";
import { describeAnimal, describeProp, describeShell, type NatureGenerations } from "./nature-actors";

/**
 * Nature members of the script's world view (TRG3b): living animals, standing ground props and the home island's
 * shore shells, each with its description and position. Lists are built lazily per catalog kind (a script that
 * never asks for trees never scans the props); a single handle resolves directly, without any list.
 */

/** Nature is never inside a building or aboard: a nature member is a plain visible spot. */
export interface NatureMember {
  actor: ScriptEventActor;
  contained: false;
  hidden: false;
  x: number;
  z: number;
}

const OPEN = { contained: false, hidden: false } as const;

const PROP_KINDS = new Set(["tree", "stone", "plant"]);
export const NATURE_KINDS = new Set(["animal", "shell", ...PROP_KINDS]);

export const createNatureMembers = (context: SettlementContext, generations: NatureGenerations) => {
  const { world } = context.options;
  const slots = () => context.options.scriptNature?.wildlife;
  let lists: Map<string, NatureMember[]> | null = null;

  const animal = (slot: number): NatureMember | undefined => {
    const wildlife = slots();
    if (!wildlife || slot < 0 || slot >= wildlife.capacity || !wildlife.isLiving(slot)) return undefined;
    const actor = describeAnimal(wildlife, generations, slot);
    return actor && { actor, ...OPEN, ...wildlife.position(slot) };
  };
  const prop = (id: number): NatureMember | undefined => {
    const actor = describeProp(world, generations, id);
    return actor && { actor, ...OPEN, x: world.props.x[id]!, z: world.props.z[id]! };
  };
  /** Shells lie only on a home island (its ledger); their place follows the collect moves. */
  const shells = (): NatureMember[] => {
    if (!context.shoreShells) return [];
    const positions = getShoreShellPositions(world, context.shoreShells);
    return listShoreShellSpots(world).flatMap((spot, index) => {
      const kind = propEntryByCode(getMeshKind(spot.meshId))?.key;
      const actor = kind === undefined ? undefined : describeShell(generations, index, kind);
      return actor ? [{ actor, ...OPEN, ...positions[index]! }] : [];
    });
  };
  const animals = (): NatureMember[] => {
    const wildlife = slots();
    if (!wildlife) return [];
    const found: NatureMember[] = [];
    for (let slot = 0; slot < wildlife.capacity; slot++) {
      const member = animal(slot);
      if (member) found.push(member);
    }
    return found;
  };
  const props = (kind: string): NatureMember[] => {
    const found: NatureMember[] = [];
    for (let id = 0; id < world.props.count; id++) {
      if (propEntryByCode(world.props.types[id]!)?.kind !== kind) continue;
      const member = prop(id);
      if (member) found.push(member);
    }
    return found;
  };
  const build = (kind: string) => {
    if (kind === "animal") return animals();
    if (kind === "shell") return shells();
    return PROP_KINDS.has(kind) ? props(kind) : [];
  };
  const shellMember = (index: number) => shells()[index];
  const lookup = (handle: ActorHandleValue) => {
    if (handle.space === "animal") return animal(handle.id);
    if (handle.space === "prop") return prop(handle.id);
    return handle.space === "shell" ? shellMember(handle.id) : undefined;
  };
  return {
    invalidate: () => { lists = null; },
    /** The live nature object a handle names; a stale generation or a removed object is gone. */
    member: (handle: ActorHandleValue) => {
      const found = lookup(handle);
      return found?.actor.handle.generation === handle.generation ? found : undefined;
    },
    pool: (kind: string) => {
      lists ??= new Map();
      let list = lists.get(kind);
      if (!list) lists.set(kind, list = build(kind));
      return list;
    }
  };
};

export type NatureMembers = ReturnType<typeof createNatureMembers>;
