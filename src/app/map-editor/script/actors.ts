import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { TranslatableText } from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { actorDisplayName } from "../../../../../island-of-settlers-shared/src/script/actor-names";
import { scriptReferences, scriptUsersOf } from "../../../../../island-of-settlers-shared/src/script/references";
import type {
  ActorOwner, PlacedObjectFingerprint, ScriptActor
} from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScenarioPoint } from "../../../shared/world/map-scenario";
import { createPlacedObjectFingerprint } from "../../../shared/world/placed-object-fingerprint";
import type { WorldData } from "../../../shared/world/world-data";
import { HUMAN_FACTION, PICK_OBJECT_DISTANCE, PICKED_REGION_RADIUS } from "./constants";
import { allocateId } from "./script-document";

/**
 * The actor panel's model (ACT9, design §3.2, §13.1): spawn actors from a catalog type, placed actors bound to
 * authored map objects by fingerprint (pick on map), the "used by" list and delete refusal, and regions made by a
 * map click.
 */

type ScenarioWorld = Pick<WorldData, "cellsX" | "scenario">;

const DEFAULT_SPAWN_TYPE = "soldier:shield";

/** Authored objects with a map-file id: [id, position, owner]. */
const authoredObjects = (world: ScenarioWorld): [number, ScenarioPoint, ActorOwner][] => {
  const scenario = world.scenario;
  if (!scenario) return [];
  const slot = (faction: number): ActorOwner => ({ faction, kind: "slot" });
  return [
    ...scenario.units.map(unit => [unit.id, unit, slot(unit.faction)] as [number, ScenarioPoint, ActorOwner]),
    ...scenario.buildings.map(site => [site.id, site, slot(site.faction)] as [number, ScenarioPoint, ActorOwner]),
    ...(scenario.decorations ?? []).flatMap(row => (row.id === undefined ? []
      : [[row.id, row, { kind: "neutral" }] as [number, ScenarioPoint, ActorOwner]]))
  ];
};

/** The nearest authored object (unit, building, decoration) within the pick distance, like the Units selection. */
export const nearestAuthoredObject = (world: ScenarioWorld, point: ScenarioPoint) => {
  let best: { id: number; owner: ActorOwner } | null = null;
  let bestDistance = PICK_OBJECT_DISTANCE;
  for (const [id, position, owner] of authoredObjects(world)) {
    const distance = Math.hypot(position.x - point.x, position.z - point.z);
    if (distance < bestDistance) { best = { id, owner }; bestDistance = distance; }
  }
  return best;
};

/** A spawn actor with a default type at a region; the author then picks the type, owner and look. */
export const addSpawnActor = (script: MapScript, name: string, region: string) => {
  const { id, script: next } = allocateId(script, "actor");
  const actor: ScriptActor = {
    binding: "spawn", count: 1, id, lifetime: "keepIncarnation", look: { kind: "ownerNation" }, name,
    owner: { faction: HUMAN_FACTION, kind: "slot" }, place: { region: { id: region, k: "ref", kind: "region" } },
    respawn: "refuse", spawnAtStart: false, type: { type: { id: DEFAULT_SPAWN_TYPE, k: "ref", kind: "content" } }
  };
  return { actor, script: { ...next, actors: [...next.actors, actor] } };
};

/** A placed actor bound to one authored object; null when the map has no such object. */
export const addPlacedActor = (script: MapScript, world: ScenarioWorld, objectId: number, name: string) => {
  const fingerprint = createPlacedObjectFingerprint(world, objectId);
  const object = authoredObjects(world).find(([id]) => id === objectId);
  if (!fingerprint || !object) return null;
  const { id, script: next } = allocateId(script, "actor");
  const actor: ScriptActor = { binding: "placed", hiddenAtStart: false, id, lifetime: "keepIncarnation", name,
    objects: [fingerprint], owner: object[2] };
  return { actor, script: { ...next, actors: [...next.actors, actor] } };
};

export type AddObjectResult = { actor: ScriptActor; kind: "added" } | { kind: "otherContent" | "missing" };

/** Adds another object of the same content to a placed actor (one actor = 1–N objects of one type, owner 3). */
export const addObjectToActor = (actor: ScriptActor, world: ScenarioWorld, objectId: number): AddObjectResult => {
  if (actor.binding !== "placed") return { kind: "missing" };
  const fingerprint = createPlacedObjectFingerprint(world, objectId);
  if (!fingerprint) return { kind: "missing" };
  if (actor.objects.some(object => object.objectId === objectId)) return { actor, kind: "added" };
  if (actor.objects[0] && actor.objects[0].content.id !== fingerprint.content.id) return { kind: "otherContent" };
  return { actor: { ...actor, objects: [...actor.objects, fingerprint] }, kind: "added" };
};

export const removeObjectFromActor = (actor: ScriptActor, objectId: number): ScriptActor =>
  (actor.binding === "placed"
    ? { ...actor, objects: actor.objects.filter((object: PlacedObjectFingerprint) => object.objectId !== objectId) }
    : actor);

/**
 * The display name the actor card edits: a stored name, else the default of a pirate or bandit look (stored only
 * once the map maker changes it, so a later look change keeps following the default). Null: no name field.
 */
export const editedDisplayName = (actor: ScriptActor): TranslatableText | null =>
  actor.displayName ?? actorDisplayName(actor);

/**
 * The actor with the display name the language inputs hold (one string per language); a name emptied in every
 * language is removed, so the default shows again.
 */
export const withDisplayName = (actor: ScriptActor, text: QuestText): ScriptActor => {
  const names = Object.entries(text).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  if (names.some(([, name]) => name.trim())) {
    return { ...actor, displayName: { en: "", ...Object.fromEntries(names) } as TranslatableText };
  }
  const { displayName: _removed, ...unnamed } = actor;
  return unnamed as ScriptActor;
};

export const replaceActor = (script: MapScript, actor: ScriptActor): MapScript =>
  ({ ...script, actors: script.actors.map(item => (item.id === actor.id ? actor : item)) });

/** Script owners that reference an actor (the "used by" list). */
export const actorUsers = (script: MapScript, actorId: string) =>
  scriptUsersOf(scriptReferences(script), "actor", actorId).filter(owner => owner !== `actor:${actorId}`);

/** Removes an unused actor; refused (with its users) while referenced. */
export const removeActor = (script: MapScript, actorId: string) => {
  const users = actorUsers(script, actorId);
  if (users.length) return { removed: false as const, users };
  return { removed: true as const, script: { ...script, actors: script.actors.filter(item => item.id !== actorId) } };
};

/** A new circular region at a map point (pick on map). */
export const addRegionAt = (script: MapScript, point: ScenarioPoint, name: (number: number) => string) => {
  const { id, script: next } = allocateId(script, "region");
  const region: MapRegion = { id, name: name(next.nextIds.region),
    shape: { centerX: point.x, centerZ: point.z, kind: "circle", radius: PICKED_REGION_RADIUS } };
  return { region, script: { ...next, regions: [...next.regions, region] } };
};
