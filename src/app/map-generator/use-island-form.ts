import type { I18n } from "@lingui/core";
import { useRef, useState } from "react";

import type { IslandTheme } from "../../shared/world/generation/island-themes";
import type { Landform } from "../../shared/world/generation/landforms";
import type { ThemeLayoutKind } from "../../shared/world/generation/theme-field";
import {
  cliffBandsFor,
  createIslandFormDraft,
  fluvialErosionFor,
  getIslandFormState,
  type IslandChoice,
  type IslandDraft,
  type Peaks,
  peaksOf,
  peakUpliftFor,
  readSeedField,
  type Relief,
  reliefOf,
  updateIslandDraft
} from "./helpers";

export interface IslandFormOptions {
  /** Optional translator owner; absent keeps the English source strings (tests/helpers). */
  i18n?: I18n;
  initial: IslandChoice;
  /** Receives the chosen options and the seed (undefined: random); the map generator reloads. */
  onRecreate: (choice: IslandChoice, seed?: number) => void;
}

/** The form's own draft: settings, map data and editor history stay untouched until Recreate. */
export const useIslandForm = ({ initial, onRecreate }: IslandFormOptions) => {
  const [choice, setChoice] = useState(() => createIslandFormDraft(initial));
  const seedInput = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<IslandDraft>) => setChoice(draft => updateIslandDraft(draft, patch));
  const recreate = () => {
    const seed = seedInput.current!;
    if (!seed.reportValidity()) return;
    onRecreate({ ...choice }, readSeedField(seed.value, seed.valueAsNumber));
  };
  return {
    ...getIslandFormState(choice),
    choice,
    cliffBands: Boolean(choice.cliffBands),
    peaks: peaksOf(choice),
    relief: reliefOf(choice),
    seedInput,
    onCliffBandsChange: (enabled: boolean) => update({ cliffBands: cliffBandsFor(enabled) }),
    onForestChange: (forest: number) => update({ forest }),
    onHarbourSpotsChange: (harbourSpots: boolean) => update({ harbourSpots }),
    onTreeSpacingChange: (treeSpacing: number) => update({ treeSpacing }),
    onHeightChange: (height: number) => update({ height }),
    onIslandCountChange: (islandCount: number) => update({ islandCount }),
    onLandformChange: (landform: Landform | null) => update({ landform }),
    onMountainsChange: (mountains: number) => update({ mountains }),
    onPeaksChange: (peaks: Peaks) => update({ peakUplift: peakUpliftFor(peaks) }),
    onTerrainVariationChange: (terrainVariation: number) => update({ terrainVariation }),
    onRecreate: recreate,
    onReliefChange: (relief: Relief) => update({ fluvialErosion: fluvialErosionFor(relief) }),
    onRiversChange: (rivers: number) => update({ rivers }),
    onSimilarSizesChange: (similarIslandSizes: boolean) => update({ similarIslandSizes }),
    onThemeChange: (theme: IslandTheme) => update({ theme }),
    onThemeLayoutChange: (themeLayout: ThemeLayoutKind) => update({ themeLayout }),
    onWidthChange: (width: number) => update({ size: width, width })
  };
};
