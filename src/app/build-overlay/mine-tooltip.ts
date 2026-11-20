import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { displayFogAt } from "../../shared/world/fog-display";
import {
  FOG,
  type MineZone,
  NO_MINE_ZONE,
  ORE,
  type WorldData
} from "../../shared/world/world-data";
import { clampBoxCorner, createMapTooltip, getViewportPoint } from "../helpers";

const ORE_NAMES: Partial<Record<number, string>> = {
  [ORE.coal]: "Coal",
  [ORE.iron]: "Iron",
  [ORE.gold]: "Gold",
  [ORE.granite]: "Granite"
};
/** Richness words from the poorest up (richness 0..1, each word up to its limit). */
const RICHNESS_WORDS = [
  { limit: 0.34, word: "poor" },
  { limit: 0.67, word: "medium" },
  { limit: Infinity, word: "rich" }
] as const;
/** Tooltip offset from the pointer (CSS px), so the cursor does not cover it. */
const POINTER_OFFSET = 14;

const getRichnessWord = (richness: number) =>
  RICHNESS_WORDS.find(({ limit }) => richness < limit)!.word;

/**
 * Tooltip text of a mine field: nothing is told before a survey (owner rule: the ore stays
 * hidden), then either the ore with its richness or that the field is barren.
 */
export const getMineFieldLabel = (zone: Pick<MineZone, "ore" | "richness" | "surveyed">) => {
  if (!zone.surveyed) return "Unsurveyed mine field";
  const ore = ORE_NAMES[zone.ore];
  if (!ore) return "Barren mine field (no ore)";
  const percent = Math.round(zone.richness * 100);
  return `${ore} deposit, ${getRichnessWord(zone.richness)} (${percent} %)`;
};

/** The mine zone of a world point, or null off the mine land. */
export const findMineZoneAt = (world: WorldData, x: number, z: number) => {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  if (cellX < 0 || cellZ < 0 || cellX >= world.cellsX || cellZ >= world.cellsZ) return null;
  const id = world.mineZone[cellZ * world.cellsX + cellX]!;
  if (displayFogAt(world, cellZ * world.cellsX + cellX) === FOG.hidden) return null;
  if (id === NO_MINE_ZONE) return null;
  return world.mineZones[id - 1] ?? null;
};

/**
 * Hover tooltip of the build overlay over a mine field. Picks the ground only when the pointer
 * or the camera moved (at most once a frame), with the renderer's camera, so it fits every view.
 */
export const createMineTooltip = (
  viewport: HTMLElement,
  renderer: Pick<TerrainRenderer, "pickGround">,
  world: WorldData
) => {
  const tooltip = createMapTooltip(viewport, "build-overlay__tooltip");
  const events = new AbortController();
  const mapCanvas = viewport.querySelector("canvas");
  let pointer: { x: number; y: number } | null = null;
  let pending = false;

  viewport.addEventListener(
    "pointermove",
    (event) => {
      pointer = event.target === mapCanvas ? getViewportPoint(viewport, event) : null;
      pending = true;
    },
    { signal: events.signal }
  );
  viewport.addEventListener(
    "pointerleave",
    () => {
      pointer = null;
      pending = true;
    },
    { signal: events.signal }
  );

  const showAt = (text: string, x: number, y: number) => {
    if (tooltip.element.textContent !== text) tooltip.element.textContent = text;
    const corner = { x: x + POINTER_OFFSET, y: y + POINTER_OFFSET };
    tooltip.moveTo(clampBoxCorner(corner, tooltip.measure(), tooltip.bounds()));
  };

  const refresh = () => {
    if (!pointer) return tooltip.hide();
    const ground = renderer.pickGround?.(pointer.x, pointer.y);
    const zone = ground ? findMineZoneAt(world, ground.x, ground.z) : null;
    if (!zone) return tooltip.hide();
    showAt(getMineFieldLabel(zone), pointer.x, pointer.y);
  };

  return {
    dispose: () => {
      events.abort();
      tooltip.dispose();
    },
    /** Called every frame while the overlay shows; `viewMoved` re-picks under a still pointer. */
    update: (viewMoved: boolean) => {
      if (!pending && !viewMoved) return;
      pending = false;
      refresh();
    },
    hide: () => {
      tooltip.hide();
      pending = true;
    }
  };
};
