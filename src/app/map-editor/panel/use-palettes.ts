import { useState } from "react";

import { isShallowEqual } from "../../components/ui-store";
import type { EditorState, EditorStore } from "../editor-store";
import { getTimberAppearance, isLocalBiomeTree } from "./palette-helpers";
import { useDraftNumber, useEditorState } from "./use-editor-store";

const isBiomeTool = (state: EditorState) => state.tool?.kind === "biome";

/** The biome to paint (a local choice) and the paint toggle; a new choice repicks an active biome tool. */
export const useBiomeControls = (store: EditorStore) => {
  const [biome, setBiome] = useState("0");
  return {
    biome,
    pressed: useEditorState(store, isBiomeTool),
    onBiomeChange: (value: string) => {
      setBiome(value);
      if (store.getState().tool?.kind === "biome") store.toggleTool("biome", Number(value));
    },
    onPaint: () => store.toggleTool("biome", Number(biome))
  };
};

const selectTreePalette = (state: EditorState) => ({
  ...getTimberAppearance(state),
  age: String(state.treeAge),
  localBiome: isLocalBiomeTree(state.tool)
});
const isSameTreePalette = (left: ReturnType<typeof selectTreePalette>, right: ReturnType<typeof selectTreePalette>) =>
  isShallowEqual({ ...left, options: left.options.length }, { ...right, options: right.options.length });

/** Initial age, timber appearance (hardwood family only) and the local-biome tree. */
export const useTreePalette = (store: EditorStore) => ({
  ...useEditorState(store, selectTreePalette, isSameTreePalette),
  onAgeChange: (value: string) => store.setTreeAge(Number(value)),
  onAppearanceChange: (value: string) => store.setHardwoodForm(Number(value)),
  onLocalBiome: () => store.toggleTool("tree", -1)
});

const selectAnimalAge = (state: EditorState) => String(state.animalAge);
const selectPopulation = (state: EditorState) => state.animalPopulation;

/** Initial age and population per placement of the animal tools. */
export const useAnimalAuthoring = (store: EditorStore) => {
  const population = useDraftNumber(useEditorState(store, selectPopulation), String, text => {
    store.setAnimalPopulation(Number(text));
    return store.getState().animalPopulation;
  });
  return {
    age: useEditorState(store, selectAnimalAge),
    population,
    onAgeChange: (value: string) => store.setAnimalAge(Number(value))
  };
};
