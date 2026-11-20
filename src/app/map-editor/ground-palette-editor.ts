import {
  type GroundPalette,
  isRockPalette,
  isSandPalette,
  isSoilPalette
} from "../../shared/world/ground-palette";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore } from "./section-store";

/** Select value of an automatic (climate) palette field. */
export const AUTO_PALETTE = "auto" as const;

/** The island palette with one field set or cleared (`auto`); undefined when nothing is left. */
export const withPaletteField = (palette: GroundPalette | undefined, field: keyof GroundPalette,
  value: string): GroundPalette | undefined => {
  const next: GroundPalette = { ...palette };
  delete next[field];
  if (field === "sand" && isSandPalette(value)) next.sand = value;
  if (field === "soil" && isSoilPalette(value)) next.soil = value;
  if (field === "rock" && isRockPalette(value)) next.rock = value;
  return next.rock || next.sand || next.soil ? next : undefined;
};

/**
 * The island's sand, soil and rock palette (GROUND-PALETTE): each select applies at once as one undo step;
 * "auto" leaves the field to the climate (theme and nation). The renderer follows the world's value.
 */
export const createGroundPaletteEditor = (world: WorldData, history: EditorHistory, store: EditorStore,
  onEdit: () => boolean | void) => {
  const section = createSectionStore<{ rock: string; sand: string; soil: string }>({
    rock: AUTO_PALETTE, sand: AUTO_PALETTE, soil: AUTO_PALETTE
  });
  const render = () => section.update({
    rock: world.groundPalette?.rock ?? AUTO_PALETTE,
    sand: world.groundPalette?.sand ?? AUTO_PALETTE,
    soil: world.groundPalette?.soil ?? AUTO_PALETTE
  });
  const change = (field: keyof GroundPalette, value: string) => {
    if ((world.groundPalette?.[field] ?? AUTO_PALETTE) === value) return;
    if (onEdit() === false) { render(); return; }
    history.begin();
    const next = withPaletteField(world.groundPalette, field, value);
    if (next) world.groundPalette = next;
    else delete world.groundPalette;
    history.endStroke();
    render();
    store.setHint(M.hints.groundPaletteApplied);
  };
  history.subscribe(render);
  render();
  return {
    section,
    setRock: (value: string) => change("rock", value),
    setSand: (value: string) => change("sand", value),
    setSoil: (value: string) => change("soil", value)
  };
};

export type GroundPaletteEditor = ReturnType<typeof createGroundPaletteEditor>;
