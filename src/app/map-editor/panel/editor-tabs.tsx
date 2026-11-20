import type { ReactNode } from "react";

import { ReplacementControls } from "../../map-generator/replacement-controls";
import { BuildingAvailabilitySection } from "../building-availability/building-availability-section";
import type { EditorTabId } from "../editor-catalog";
import type { EditorPanelControllers } from "../editor-panel";
import { MapRulesSection } from "../map-rules/map-rules-section";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { ScriptSection } from "../script/script-section";
import { ContourTransformControls, GeneratedContourSection, OriginalFeatureSection } from "./contour-sections";
import { DecorationPaletteSection } from "./decoration-palette-section";
import { FishingSection, OreSection, StoneDepositSection } from "./deposit-sections";
import { EditorSection } from "./fields";
import { NavigationSection, PatrolSection, ScenarioSpaceSection } from "./inspection-sections";
import { EnvironmentSection, GroundPaletteSection, MapLibrarySection, RoadsSection } from "./map-sections";
import { DecorationSection, VegetationSection } from "./object-sections";
import {
  AnimalsSection, BiomeSection, GrassSection, MineSection, ObjectEraserSection, PebbleSection, TilesSection,
  TreesSection
} from "./palette-sections";
import { CoastSection, ScopedRestoreSection } from "./reshape-sections";
import { ScenarioMapSection, ScenarioUnitsSection } from "./scenario-sections";
import { ReliefSection, TerrainBrushSection } from "./terrain-brush-sections";
import { RiverSection, TerrainFeatureSection } from "./terrain-feature-sections";
import { useSection } from "./use-section";

type TabProps = EditorPanelControllers;

const TerrainTab = ({ coast, generatedFeatures, generatedTransforms, originalFeatures, river, scopedRestore, store,
  terrainFeatures }: TabProps) => (
  <>
    <ReliefSection store={store} />
    <TerrainBrushSection store={store} />
    <TerrainFeatureSection editor={terrainFeatures} />
    <RiverSection editor={river} />
    <OriginalFeatureSection selector={originalFeatures} />
    <GeneratedContourSection inspector={generatedFeatures} />
    <ContourTransformControls controls={generatedTransforms} />
    <CoastSection editor={coast} />
    <ScopedRestoreSection editor={scopedRestore} />
  </>
);

const TilesTab = ({ store }: TabProps) => (
  <>
    <TilesSection store={store} />
    <BiomeSection store={store} />
  </>
);

const UnitsTab = ({ patrol, scenario }: TabProps) => {
  const { view } = useSection(scenario.unitsSection);
  return (
    <>
      <ScenarioUnitsSection editor={scenario} />
      {!view.enemiesBlocked && <PatrolSection editor={patrol} />}
    </>
  );
};

const DepositsTab = ({ fishing, marble, ore, store }: TabProps) => (
  <>
    <StoneDepositSection editor={marble} store={store} />
    <PebbleSection store={store} />
    <MineSection store={store} />
    <OreSection editor={ore} />
    <FishingSection editor={fishing} />
  </>
);

const TreesTab = ({ store, vegetation }: TabProps) => (
  <>
    <TreesSection store={store} />
    <VegetationSection editor={vegetation} />
  </>
);

const AnimalsTab = ({ store }: TabProps) => <AnimalsSection store={store} />;

const ObjectsTab = ({ decorationPalette, decorations, store }: TabProps) => (
  <>
    <DecorationPaletteSection editor={decorationPalette} />
    <GrassSection store={store} />
    <ObjectEraserSection store={store} />
    <DecorationSection editor={decorations} />
  </>
);

const MapTab = ({
  environment, groundPalette, library, navigation, replacement, roads, scenario, scenarioSpace, world
}: TabProps) => (
  <>
    <ScenarioMapSection editor={scenario} />
    <MapRulesSection controls={scenario.mapRules} />
    <BuildingAvailabilitySection controls={scenario.buildingAvailability} />
    <ScenarioSpaceSection editor={scenarioSpace} />
    <NavigationSection overlay={navigation} />
    <RoadsSection editor={roads} />
    <EnvironmentSection editor={environment} />
    <GroundPaletteSection editor={groundPalette} />
    <MapLibrarySection library={library} />
    <EditorSection info={M.replacement.help} title={M.sections.replacement}>
      <ReplacementControls world={world} onGenerate={replacement} />
    </EditorSection>
  </>
);

const ScriptTab = ({ script }: TabProps) => <ScriptSection script={script} />;

/** Each category's sections (created once; the panels only hide). */
export const createTabContents = (controllers: EditorPanelControllers): Record<EditorTabId, ReactNode> => ({
  animals: <AnimalsTab {...controllers} />,
  deposits: <DepositsTab {...controllers} />,
  map: <MapTab {...controllers} />,
  objects: <ObjectsTab {...controllers} />,
  script: <ScriptTab {...controllers} />,
  terrain: <TerrainTab {...controllers} />,
  tiles: <TilesTab {...controllers} />,
  trees: <TreesTab {...controllers} />,
  units: <UnitsTab {...controllers} />
});
