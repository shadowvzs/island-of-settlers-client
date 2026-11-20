import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { MAX_ANIMAL_STAMP_POPULATION } from "../../../shared/world/authored-animals";
import { MATERIAL, PROP } from "../../../shared/world/world-data";
import {
  ANIMAL_CHOICES, COVER_DOODAD_CHOICES, GROUND_CHOICES, MINE_REMOVER, ORE_CHOICES, PLANT_REMOVER,
  STONE_DOODAD_CHOICES, TREE_CHOICES, TREE_REMOVER
} from "../editor-catalog";
import type { EditorStore } from "../editor-store";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { ActionButton, ActionRow, AuthoringControls, ChoiceField, EditorSection, NumberField } from "./fields";
import { toChoiceSpecs, toEntrySpec } from "./helpers";
import { ANIMAL_AGE_OPTIONS, BIOME_OPTIONS, getCoverNationsInfo, TREE_AGE_OPTIONS } from "./palette-helpers";
import { ToolGrid } from "./tool-grid";
import { useAnimalAuthoring, useBiomeControls, useTreePalette } from "./use-palettes";

const TILE_SPECS = toChoiceSpecs("ground", GROUND_CHOICES);
const PEBBLE_SPECS = toChoiceSpecs("stone", STONE_DOODAD_CHOICES.filter(choice => choice.value !== PROP.largeRock));
const GRASS_SPECS = toChoiceSpecs("cover", COVER_DOODAD_CHOICES);
const ORE_SPECS = [
  ...toChoiceSpecs("ground", GROUND_CHOICES.filter(choice => choice.value === MATERIAL.mine)),
  ...toChoiceSpecs("ore", ORE_CHOICES),
  toEntrySpec(MINE_REMOVER)
];
const OBJECT_ERASER_SPECS = [toEntrySpec(PLANT_REMOVER)];
const TREE_SPECS = [...toChoiceSpecs("tree", TREE_CHOICES), toEntrySpec(TREE_REMOVER)];
const ANIMAL_SPECS = toChoiceSpecs("animal", ANIMAL_CHOICES);

interface StoreProps {
  store: EditorStore;
}

export const TilesSection = ({ store }: StoreProps) => {
  const { i18n } = useLingui();
  return (
    <EditorSection info={getCoverNationsInfo(i18n)} title={M.sections.tiles}>
      <ToolGrid specs={TILE_SPECS} store={store} />
    </EditorSection>
  );
};

/** Local biome blends painted with the brush. */
export const BiomeSection = ({ store }: StoreProps) => {
  const { biome, pressed, onBiomeChange, onPaint } = useBiomeControls(store);
  return (
    <EditorSection info={M.help.biome} title={M.sections.biome}>
      <AuthoringControls>
        <ChoiceField label={M.fields.biome} options={BIOME_OPTIONS} value={biome} onChange={onBiomeChange} />
        <ActionButton caption={M.captions.paintBiome} icon="tile-lush-grass" label={M.actions.paintBiome}
          pressed={pressed} onClick={onPaint} />
      </AuthoringControls>
    </EditorSection>
  );
};

/** Decorative small stones and pebbles (the quarry boulder lives with the stone deposits). */
export const PebbleSection = ({ store }: StoreProps) => (
  <EditorSection title={M.sections.pebbles}><ToolGrid specs={PEBBLE_SPECS} store={store} /></EditorSection>
);

/** Hand-painted grass: the biome kinds and the existing meadow tufts; the brush follows grass rules. */
export const GrassSection = ({ store }: StoreProps) => (
  <EditorSection info={M.help.grassCover} title={M.sections.grass}>
    <ToolGrid specs={GRASS_SPECS} store={store} />
  </EditorSection>
);

export const MineSection = ({ store }: StoreProps) => {
  const { i18n } = useLingui();
  return (
    <EditorSection title={M.sections.mine}>
      <h3 className="map-editor__subheading">{translateMessage(i18n, M.fields.oreHeading)}</h3>
      <ToolGrid specs={ORE_SPECS} store={store} />
    </EditorSection>
  );
};

export const ObjectEraserSection = ({ store }: StoreProps) => (
  <EditorSection title={M.sections.objectEraser}>
    <ToolGrid specs={OBJECT_ERASER_SPECS} store={store} />
  </EditorSection>
);

const TreePalette = ({ store }: StoreProps) => {
  const { age, hidden, localBiome, options, value, onAgeChange, onAppearanceChange, onLocalBiome } =
    useTreePalette(store);
  return (
    <AuthoringControls>
      <ChoiceField label={M.fields.treeAge} options={TREE_AGE_OPTIONS} value={age} onChange={onAgeChange} />
      <ChoiceField
        hidden={hidden}
        label={M.fields.timberAppearance}
        options={options}
        value={value}
        onChange={onAppearanceChange}
      />
      <ActionRow>
        <ActionButton caption={M.captions.localBiomeTree} icon="tree-oak" label={M.actions.localBiomeTree}
          pressed={localBiome} onClick={onLocalBiome} />
      </ActionRow>
    </AuthoringControls>
  );
};

/** Tree species, the tree eraser, initial age and timber appearance. */
export const TreesSection = ({ store }: StoreProps) => (
  <EditorSection info={M.help.tree} title={M.sections.trees}>
    <ToolGrid specs={TREE_SPECS} store={store} />
    <TreePalette store={store} />
  </EditorSection>
);

const AnimalAuthoring = ({ store }: StoreProps) => {
  const { age, population, onAgeChange } = useAnimalAuthoring(store);
  return (
    <AuthoringControls>
      <ChoiceField label={M.fields.animalAge} options={ANIMAL_AGE_OPTIONS} value={age} onChange={onAgeChange} />
      <NumberField
        ariaLabel={M.fields.animalPopulation}
        label={M.fields.population}
        max={MAX_ANIMAL_STAMP_POPULATION}
        min="1"
        size="narrow"
        step="1"
        value={population.text}
        onBlur={population.onBlur}
        onChange={population.onChange}
      />
    </AuthoringControls>
  );
};

/** Animal species with their initial age and group size. */
export const AnimalsSection = ({ store }: StoreProps) => (
  <EditorSection info={M.help.animals} title={M.sections.animals}>
    <ToolGrid specs={ANIMAL_SPECS} store={store} />
    <AnimalAuthoring store={store} />
  </EditorSection>
);
