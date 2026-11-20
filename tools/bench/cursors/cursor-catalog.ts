import type * as THREE from "three";

import {
  addBadge, boardBadge, enterBadge, invalidBadge, moveBadge, retreatBadge, sailBadge, siegeBadge, storeBadge,
  targetBadge, unloadBadge
} from "./cursor-badge-models";
import type { CursorMaterials } from "./cursor-kit";
import { arrowModel } from "./cursor-pointer-models";
import { gauntletModel, standardModel, swordModel } from "./cursor-tool-models";

export interface CursorEntry {
  /** File name without extension (`assets/ui-icons/cursors/<name>.png` and `<name>@2x.png`). */
  name: string;
  /** Render layers, bottom first; each gets its own contour. One layer holds the hotspot marker. */
  layers: (materials: CursorMaterials) => THREE.Object3D[];
}

type BadgeModel = (materials: CursorMaterials) => THREE.Object3D;

/** The game arrow with an order badge at its lower right. */
const badged = (name: string, badge: BadgeModel): CursorEntry =>
  ({ layers: materials => [arrowModel(materials), badge(materials)], name });

/**
 * Every cursor of the game set. game-* are applied by src/app/cursors/game-cursors.css; the army-* names and
 * hotspots are referenced by src/app/settlement/army-order-cursor.css.
 */
export const CURSOR_CATALOG: readonly CursorEntry[] = [
  { layers: materials => [arrowModel(materials)], name: "game-default" },
  { layers: materials => [arrowModel(materials, "highlight")], name: "game-pointer" },
  { layers: materials => [gauntletModel(materials, false)], name: "game-grab" },
  { layers: materials => [gauntletModel(materials, true)], name: "game-grabbing" },
  badged("game-not-allowed", invalidBadge),
  badged("army-move", moveBadge),
  { layers: materials => [swordModel(materials)], name: "army-attack" },
  { layers: materials => [swordModel(materials), targetBadge(materials)], name: "army-target" },
  badged("army-siege", siegeBadge),
  badged("army-enter", enterBadge),
  badged("army-board", boardBadge),
  badged("army-store", storeBadge),
  badged("army-retreat", retreatBadge),
  { layers: materials => [standardModel(materials)], name: "army-rally" },
  badged("army-add", addBadge),
  badged("army-sail", sailBadge),
  badged("army-unload", unloadBadge)
];
