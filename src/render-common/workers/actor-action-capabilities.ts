import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import config from "./actor-action-capabilities.json";

/** Existing worker jobs, troop profiles and the existing commander ownership marker; not a new roster. */
export type PossessedActorType = "Scout" | "Soldier" | MilitaryTroopType | "commander";
export type ActorActionCapability = keyof typeof config.Scout;
export type ActorActionCapabilities = Readonly<Record<ActorActionCapability, 0 | 1>>;
const keys = Object.keys(config.Scout) as ActorActionCapability[];
const normalized = Object.fromEntries(Object.entries(config).map(([actor, values]) => [actor,
  Object.freeze(Object.fromEntries(keys.map(key => [key, values[key] === 1 ? 1 : 0]))) ])) as
  Readonly<Record<PossessedActorType, ActorActionCapabilities>>;
const aliases: Readonly<Record<string, ActorActionCapability>> = { possessedJump: "jumping" };
const prerequisites: Partial<Record<ActorActionCapability, ActorActionCapability>> = {
  backward: "move", forward: "move", turnLeft: "look", turnRight: "look", zoomIn: "spyglass", zoomOut: "spyglass"
};

/** Unknown actors/actions deny. Configuration availability is separate from the player's saved key bindings. */
export const actorActionFlag = (actorType: unknown, action: unknown): 0 | 1 => {
  if (typeof actorType !== "string" || typeof action !== "string" || !Object.hasOwn(normalized, actorType)) return 0;
  const key = Object.hasOwn(aliases, action) ? aliases[action]! : action;
  const flags = normalized[actorType as PossessedActorType];
  if (!Object.hasOwn(flags, key)) return 0;
  const capability = key as ActorActionCapability, parent = prerequisites[capability];
  return flags[capability] === 1 && (!parent || flags[parent] === 1) ? 1 : 0;
};
/** Back is a global emergency route, deliberately outside configurable actor capabilities. */
export const actorActionEnabled = (actorType: unknown, action: unknown) =>
  action === "back" || actorActionFlag(actorType, action) === 1;
