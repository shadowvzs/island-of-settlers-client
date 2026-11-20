import type { I18n } from "@lingui/core";
import type { RefObject } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import type { IslandTheme } from "../../shared/world/generation/island-themes";
import type { Landform } from "../../shared/world/generation/landforms";
import type { ThemeLayoutKind } from "../../shared/world/generation/theme-field";
import { Checkbox } from "../components/checkbox";
import type { SelectOption } from "../components/helpers";
import { RadioGroup } from "../components/radio-group";
import { Select } from "../components/select";
import { LevelSlider } from "../components/slider";
import type { IslandDraft, Peaks, Relief } from "./helpers";
import { MAP_GENERATOR_MESSAGES as M } from "./messages";
import {
  getAmountLevels,
  getLandformOptions,
  getPeakOptions,
  getReliefOptions,
  getRiverLevels,
  getTerrainVariationLevels,
  getThemeLayoutOptions,
  getThemeOptions,
  getTreeSpacingOptions,
  SIZE_OPTIONS
} from "./options";
import { type IslandFormOptions,useIslandForm } from "./use-island-form";

interface ArchipelagoFieldsProps {
  countOptions: readonly SelectOption<number>[];
  harbourSpots: boolean;
  i18n?: I18n;
  islandCount: number;
  showHarbourSpots: boolean;
  similarSizes: boolean;
  similarSizesDisabled: boolean;
  onHarbourSpotsChange: (enabled: boolean) => void;
  onIslandCountChange: (count: number) => void;
  onSimilarSizesChange: (similar: boolean) => void;
}
/** Islands landform only: similar sizes, island count, harbour spots (2+ islands) and the plot requirement. */
const ArchipelagoFields = ({
  countOptions, harbourSpots, i18n, islandCount, showHarbourSpots, similarSizes, similarSizesDisabled,
  onHarbourSpotsChange, onIslandCountChange, onSimilarSizesChange
}: ArchipelagoFieldsProps) => (
  <>
    <Checkbox
      checked={similarSizes}
      disabled={similarSizesDisabled}
      label={translateMessage(i18n, M.form.similarSizes)}
      onChange={onSimilarSizesChange}
    />
    <Select choices={countOptions} label={translateMessage(i18n, M.form.islandCount)} selected={islandCount} onChange={onIslandCountChange} />
    {showHarbourSpots && (
      <Checkbox
        checked={harbourSpots}
        label={translateMessage(i18n, M.form.harbourSpots)}
        title={translateMessage(i18n, M.form.harbourSpotsTitle)}
        onChange={onHarbourSpotsChange}
      />
    )}
    <p>{translateMessage(i18n, M.form.requirements)}</p>
  </>
);

interface IslandFormViewProps {
  choice: IslandDraft;
  cliffBands: boolean;
  countOptions: readonly SelectOption<number>[];
  harbourSpots: boolean;
  i18n?: I18n;
  islandCount: number;
  peaks: Peaks;
  relief: Relief;
  seedInput: RefObject<HTMLInputElement | null>;
  showHarbourSpots: boolean;
  showIslandOptions: boolean;
  similarSizes: boolean;
  similarSizesDisabled: boolean;
  onCliffBandsChange: (enabled: boolean) => void;
  onForestChange: (forest: number) => void;
  onHarbourSpotsChange: (enabled: boolean) => void;
  onTreeSpacingChange: (spacing: number) => void;
  onHeightChange: (height: number) => void;
  onIslandCountChange: (count: number) => void;
  onLandformChange: (landform: Landform | null) => void;
  onMountainsChange: (mountains: number) => void;
  onPeaksChange: (peaks: Peaks) => void;
  onTerrainVariationChange: (variation: number) => void;
  onRecreate: () => void;
  onReliefChange: (relief: Relief) => void;
  onRiversChange: (rivers: number) => void;
  onSimilarSizesChange: (similar: boolean) => void;
  onThemeChange: (theme: IslandTheme) => void;
  onThemeLayoutChange: (layout: ThemeLayoutKind) => void;
  onWidthChange: (width: number) => void;
}
const IslandFormView = ({
  choice, cliffBands, countOptions, harbourSpots, i18n, islandCount, peaks, relief, seedInput, showHarbourSpots,
  showIslandOptions, similarSizes, similarSizesDisabled,
  onCliffBandsChange, onForestChange, onHarbourSpotsChange, onTreeSpacingChange, onHeightChange, onIslandCountChange, onLandformChange, onMountainsChange, onPeaksChange, onRecreate,
  onReliefChange, onRiversChange, onSimilarSizesChange, onTerrainVariationChange, onThemeChange,
  onThemeLayoutChange, onWidthChange
}: IslandFormViewProps) => (
  <div className="settings-panel__island">
    <Select choices={getLandformOptions(i18n)} label={translateMessage(i18n, M.form.landform)}
      selected={choice.landform} onChange={onLandformChange} />
    {showIslandOptions && (
      <ArchipelagoFields
        countOptions={countOptions}
        harbourSpots={harbourSpots}
        i18n={i18n}
        islandCount={islandCount}
        showHarbourSpots={showHarbourSpots}
        similarSizes={similarSizes}
        similarSizesDisabled={similarSizesDisabled}
        onHarbourSpotsChange={onHarbourSpotsChange}
        onIslandCountChange={onIslandCountChange}
        onSimilarSizesChange={onSimilarSizesChange}
      />
    )}
    <Select choices={getThemeOptions(i18n)} label={translateMessage(i18n, M.form.theme)}
      selected={choice.theme} onChange={onThemeChange} />
    <Select
      choices={getThemeLayoutOptions(i18n)}
      label={translateMessage(i18n, M.form.themes)}
      selected={choice.themeLayout}
      onChange={onThemeLayoutChange}
    />
    <Select choices={SIZE_OPTIONS} label={translateMessage(i18n, M.form.width)}
      selected={choice.width} onChange={onWidthChange} />
    <Select choices={SIZE_OPTIONS} label={translateMessage(i18n, M.form.height)}
      selected={choice.height} onChange={onHeightChange} />
    <LevelSlider label={translateMessage(i18n, M.form.rivers)} level={choice.rivers}
      levels={getRiverLevels(i18n)} onInput={onRiversChange} />
    <LevelSlider label={translateMessage(i18n, M.form.forest)} level={choice.forest}
      levels={getAmountLevels(i18n)} onInput={onForestChange} />
    <Select choices={getTreeSpacingOptions(i18n)} label={translateMessage(i18n, M.form.forestDensity)}
      selected={choice.treeSpacing ?? 1.65} onChange={onTreeSpacingChange} />
    <LevelSlider label={translateMessage(i18n, M.form.mountains)} level={choice.mountains}
      levels={getAmountLevels(i18n)} onInput={onMountainsChange} />
    <RadioGroup choices={getReliefOptions(i18n)} label={translateMessage(i18n, M.form.relief)}
      selected={relief} onChange={onReliefChange} />
    <RadioGroup choices={getPeakOptions(i18n)} label={translateMessage(i18n, M.form.peaks)}
      selected={peaks} onChange={onPeaksChange} />
    <Checkbox checked={cliffBands} label={translateMessage(i18n, M.form.cliffBands)}
      title={translateMessage(i18n, M.form.cliffBandsTitle)} onChange={onCliffBandsChange} />
    <LevelSlider label={translateMessage(i18n, M.form.terrainVariation)} level={choice.terrainVariation ?? 2}
      levels={getTerrainVariationLevels(i18n)} onInput={onTerrainVariationChange} />
    <label>
      {translateMessage(i18n, M.form.seedLabel)}
      <input
        aria-label={translateMessage(i18n, M.form.seedLabel)}
        max="4294967295"
        min="0"
        placeholder={translateMessage(i18n, M.landform.random)}
        ref={seedInput}
        step="1"
        title={translateMessage(i18n, M.form.seedTitle)}
        type="number"
      />
    </label>
    <button title={translateMessage(i18n, M.form.recreateTitle)} type="button" onClick={onRecreate}>
      {translateMessage(i18n, M.button.recreate)}
    </button>
  </div>
);

/**
 * World generation options above the "Recreate island" button: landform (island count), theme, theme layout, width, height, rivers, forest, mountains and seed.
 */
export const IslandForm = (props: IslandFormOptions) =>
  <IslandFormView {...useIslandForm(props)} i18n={props.i18n} />;
