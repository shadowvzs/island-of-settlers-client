import { FOLIAGE_SEED } from "../app/asset-seeds";
import {
  ANIMAL_CHOICES,
  COVER_DOODAD_CHOICES,
  GROUND_CHOICES,
  HISTORY_ACTIONS,
  LOWER_TOGGLE,
  MAP_ACTIONS,
  ORE_CHOICES,
  PLANT_REMOVER,
  RELIEF_TOOLS,
  STONE_DOODAD_CHOICES,
  TERRAIN_TOOLS,
  toGroundDecorationIcon,
  type ToolChoice,
  TREE_CHOICES,
  TREE_REMOVER} from "../app/map-editor/editor-catalog";
import { loadBiomeGrassHeroPayload } from "../render-common/props/plants/biome-grass-hero-loader";
import { loadBiomeGrassMeshPayload } from "../render-common/props/plants/biome-grass-mesh-loader";
import { createFoliageAtlas } from "../render-common/trees/foliage-atlas";
import { loadHardwoodMeshPayload } from "../render-common/trees/hardwood-mesh-loader";
import { loadAnimalModels } from "../render-common/wildlife/model/animal-asset-loader";
import { listDecorationEntries } from "../shared/world/editing/decoration-registry";
import { MATERIAL_COUNT } from "../shared/world/world-data";
import { createAnimalIcons } from "./animal-icons";
import { renderTileIcon } from "./ground-icons";
import { renderHistoryIcon } from "./history-icons";
import { toIconFiles } from "./icon-fit";
import { createIconStudio, type IconStudio } from "./icon-studio";
import { renderMapIcon } from "./map-icons";
import { renderPropIcon } from "./prop-icons";
import {
  renderAlpineMountainIcon,
  renderEraserIcon,
  renderLakeIcon,
  renderLowerIcon,
  renderMountainIcon,
  renderResetIcon
} from "./relief-icons";
import { createStoneIcons } from "./stone-icons";
import { renderTerrainIcon } from "./terrain-icons";

declare global {
  interface Window {
    /** Every editor icon: name -> PNG data URLs [1x, 2x] (tools/assets/editor-icons.ts). */
    __editorIcons?: Record<string, string[]>;
  }
}

/** Eraser band colours: green for the plant remover, bark brown for the tree remover. */
const PLANT_BAND = "rgb(92 160 72)";
const TREE_BAND = "rgb(138 96 60)";

type Renderer = () => HTMLCanvasElement;

/** One icon per choice of a list, named by the catalog. */
const forChoices = (choices: readonly ToolChoice[], render: (value: number) => HTMLCanvasElement) =>
  choices.map(({ icon, value }): [string, Renderer] => [icon, () => render(value)]);

/** Ground decoration models of the palette registry that have no stone icon: the prop mesh as drawn. */
const forGroundDecorations = (studio: IconStudio) => {
  const stones = new Set(STONE_DOODAD_CHOICES.map(choice => choice.icon));
  return listDecorationEntries().flatMap((entry): [string, Renderer][] => {
    if (entry.source !== "ground") return [];
    const icon = toGroundDecorationIcon(entry.name);
    if (stones.has(icon)) return [];
    return [[icon, () => renderPropIcon(studio, entry.propKind)]];
  });
};

/** Every icon's renderer, in panel order. */
const listIcons = async (): Promise<[string, Renderer, boolean][]> => {
  const studio = createIconStudio(createFoliageAtlas(FOLIAGE_SEED));
  const stones = createStoneIcons(studio);
  const [animalModels] = await Promise.all([
    loadAnimalModels(),
    loadHardwoodMeshPayload(),
    loadBiomeGrassMeshPayload(),
    loadBiomeGrassHeroPayload()
  ]);
  const animals = createAnimalIcons(animalModels);
  const mountain = RELIEF_TOOLS.find(entry => entry.kind === "mountain" && entry.value !== 1)!.icon;
  const alpine = RELIEF_TOOLS.find(entry => entry.kind === "mountain" && entry.value === 1)!.icon;
  const lake = RELIEF_TOOLS.find(entry => entry.kind === "lake")!.icon;
  const reset = RELIEF_TOOLS.find(entry => entry.kind === "resetGround")!.icon;
  const trimmed: [string, Renderer][] = [
    [mountain, renderMountainIcon],
    [alpine, renderAlpineMountainIcon],
    [lake, renderLakeIcon],
    [LOWER_TOGGLE.icon, renderLowerIcon],
    ...forChoices(ORE_CHOICES, stones.renderOre),
    ...forChoices(STONE_DOODAD_CHOICES, stones.renderStone),
    ...forChoices(COVER_DOODAD_CHOICES, (kind) => renderPropIcon(studio, kind)),
    ...forGroundDecorations(studio),
    [PLANT_REMOVER.icon, () => renderEraserIcon(PLANT_BAND)],
    ...forChoices(TREE_CHOICES, (kind) => renderPropIcon(studio, kind)),
    [TREE_REMOVER.icon, () => renderEraserIcon(TREE_BAND)],
    ...forChoices(ANIMAL_CHOICES, animals.renderAnimal)
  ];
  const whole: [string, Renderer][] = [
    ...TERRAIN_TOOLS.map(({ icon, value }): [string, Renderer] => [icon, () => renderTerrainIcon(value!)]),
    [reset, renderResetIcon],
    // Variant tile icons are cut from their baked tiles (tools/assets/ground-variant-tiles.ts).
    ...forChoices(GROUND_CHOICES.filter(({ value }) => value < MATERIAL_COUNT), renderTileIcon),
    [MAP_ACTIONS.saveFile.icon, () => renderMapIcon("save")],
    [MAP_ACTIONS.loadFile.icon, () => renderMapIcon("load")],
    [MAP_ACTIONS.newSlot.icon, () => renderMapIcon("new")],
    [MAP_ACTIONS.deleteSlot.icon, () => renderMapIcon("delete")],
    [HISTORY_ACTIONS.undo.icon, () => renderHistoryIcon("undo")],
    [HISTORY_ACTIONS.redo.icon, () => renderHistoryIcon("redo")]
  ];
  return [
    ...trimmed.map(([name, render]): [string, Renderer, boolean] => [name, render, true]),
    ...whole.map(([name, render]): [string, Renderer, boolean] => [name, render, false])
  ];
};

/** Shows the icon on the page (a preview for people; the tool reads window.__editorIcons). */
const preview = (name: string, files: string[]) => {
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  image.src = files[files.length - 1]!;
  image.alt = name;
  const caption = document.createElement("figcaption");
  caption.textContent = name;
  figure.append(image, caption);
  document.getElementById("icons")!.append(figure);
};

const start = async () => {
  const icons: Record<string, string[]> = {};
  for (const [name, render, trim] of await listIcons()) {
    icons[name] = toIconFiles(render(), trim);
    preview(name, icons[name]);
  }
  window.__editorIcons = icons;
};

void start();
