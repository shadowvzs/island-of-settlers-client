import { DMath } from "../../shared/math/deterministic-math";
import type { WorkerNation } from "../workers/worker-unit";
import { banditSiteKey, type BanditSiteRef } from "./bandit-camp-plan";
import { getBuildingDefinition } from "./building-catalog";
import type { Point3 } from "./building-recipe";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import { CATAPULT_DECK_HEIGHT } from "./catapult-dimensions";
import {
  GARRISON_HEAD_REACH, projectWindowGarrisonSlots, windowGarrisonAnchors, type WindowSoldierFrame
} from "./military-window-slots";
import { createNationBuildingRecipe } from "./nation-building-recipe";
import { createThemedNeutralBuildingRecipe } from "./themed-neutral-building-recipe";

/** Where garrisoned soldiers are seen: archers on their posts, others leaning out of windows. */
export interface GarrisonSlot { kind: "archer" | "window" | "crew"; lean: number; position: Point3; yaw: number }

interface Placeable { rotation: number; x: number; y: number; z: number }

/**
 * Presentation-only window geometry, kept beside the shared slots: the simulation and its replay
 * hashes must see exactly the slot objects that `garrisonSlots` published before the drawn fit.
 */
const windowSoldierFrames = new WeakMap<GarrisonSlot, WindowSoldierFrame>();

const outwardYaw = (x: number, z: number) => DMath.atan2(x, z);

const calculateSlots = (
  typeId: number, nation: WorkerNation, detailed: boolean, enemySite?: BanditSiteRef, compound = false,
  enclosure?: "building"
): GarrisonSlot[] => {
  const definition = getBuildingDefinition(typeId), scale = compound?1:getRomanBuildingWorldSizing(definition).scale;
  // The drawn recipe: nation walls are thicker, and Minimal models have no window panels at all.
  const recipe = enemySite === undefined ? createNationBuildingRecipe(definition, nation, detailed)
    : createThemedNeutralBuildingRecipe(definition, { bandit: enemySite, enclosure, theme: "forest" }, detailed);
  const windows = projectWindowGarrisonSlots(recipe.garrisonWindows ?? windowGarrisonAnchors(recipe.parts), scale)
    .map(({ frame, slot }) => { windowSoldierFrames.set(slot, frame); return slot; });
  if (typeId === 16) return [
    { kind: "crew", lean: 0, position: [-.32 * scale, CATAPULT_DECK_HEIGHT * scale, -.28 * scale], yaw: 0 },
    ...windows
  ];
  const archers = (recipe.archerPositions ?? []).map((position): GarrisonSlot => ({ kind: "archer",
    lean: 0, position: position.map(value => value * scale) as Point3,
    yaw: outwardYaw(position[0], position[2]) }));
  return [...archers, ...windows];
};

const cache = new Map<string, GarrisonSlot[]>();
/**
 * `enemySite`: the bandit compound still held by its hostile garrison (its own camp recipe). `compound`: the plot
 * is a bandit site in world units, also after its capture, when the nation's recipe is drawn on it.
 */
export const garrisonSlots = (
  typeId: number, nation: WorkerNation = "roman", detailed = true, enemySite?: BanditSiteRef, compound = false,
  enclosure?: "building"
) => {
  const site = enemySite ? banditSiteKey(enemySite) : "player";
  const key = `${nation}:${typeId}:${detailed}:${site}:${compound}:${enclosure ?? "walled"}`;
  let slots = cache.get(key);
  if (!slots) { slots = calculateSlots(typeId, nation, detailed, enemySite, compound, enclosure); cache.set(key, slots); }
  return slots;
};

/** Presentation frame of a window slot: opening sill/lintel/width, window insert and wall faces. */
export const garrisonWindowFrame = (slot: GarrisonSlot) => windowSoldierFrames.get(slot);

/** A slot in the world for a placed building (quarter turns as Three.js positive Y turns). */
export const placeGarrisonSlot = (slot: GarrisonSlot, building: Placeable) => {
  const turn = ((building.rotation % 4) + 4) % 4, angle = turn * Math.PI / 2;
  const cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const x = slot.position[0], y = slot.position[1], z = slot.position[2];
  return { x: building.x + x * cosine + z * sine, y: building.y + y, yaw: slot.yaw + angle,
    z: building.z - x * sine + z * cosine };
};

/** The exposed figure of a placed slot: feet, head centre and outward facing (Three.js yaw). */
export const exposedGarrisonFigure = (
  slot: GarrisonSlot, building: Placeable
) => {
  const feet = placeGarrisonSlot(slot, building);
  const forward = DMath.sin(slot.lean) * GARRISON_HEAD_REACH, up = DMath.cos(slot.lean) * GARRISON_HEAD_REACH;
  const head = { x: feet.x + DMath.sin(feet.yaw) * forward, y: feet.y + up, z: feet.z + DMath.cos(feet.yaw) * forward };
  return { feet: { x: feet.x, y: feet.y, z: feet.z }, head, yaw: feet.yaw };
};

/**
 * Who stands where: archers take the tower posts first; spare archers, then melee, take the
 * windows; anyone beyond the slots stays inside. Shared by the garrison view and combat.
 */
export const assignGarrisonSlots = <Soldier extends { combat?: { type: string } }>(
  slots: readonly GarrisonSlot[], garrison: readonly Soldier[]
) => {
  const posts = slots.filter(slot => slot.kind === "archer"), windows = slots.filter(slot => slot.kind !== "archer");
  const archers = garrison.filter(soldier => soldier.combat?.type === "archer");
  const melee = garrison.filter(soldier => soldier.combat?.type !== "archer");
  if (slots.some(slot => slot.kind === "crew")) melee.sort((a, b) =>
    Number(b.combat?.type === "heavy") - Number(a.combat?.type === "heavy"));
  const queue = [...archers.slice(posts.length), ...melee];
  if (windows[0]?.kind === "crew" && queue[0]?.combat?.type !== "heavy") windows.shift();
  return [...archers.slice(0, posts.length).map((soldier, index) => ({ slot: posts[index]!, soldier })),
    ...queue.slice(0, windows.length).map((soldier, index) => ({ slot: windows[index]!, soldier }))];
};
