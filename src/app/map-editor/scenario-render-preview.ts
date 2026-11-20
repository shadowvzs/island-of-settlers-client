import type { BuildingFrame } from "../../render-common/buildings/building-catalog";
import type { FrameState, PlacementGhostFrame } from "../../render-common/renderer-contract";
import { playerColorFromHex } from "../../render-common/settlement/player-color";
import { adventureBanditStyle } from "../../render-common/workers/adventure-bandit-style";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type { RoadSegment } from "../../shared/settlement/road-types";
import { militaryArmourRank } from "../../shared/settlement/settlement-military-ranks";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { ScenarioBuilding } from "../../shared/world/map-scenario";
import { getAuthoredDeposits } from "../../shared/world/marble-deposit";
import type { WorldData } from "../../shared/world/world-data";
import { createEnemyAppearances } from "../settlement/enemy-appearances";

interface PreviewFrame {
  buildings: BuildingFrame[];
  workers: WorkerFrame[];
  roads: RoadSegment[];
  roadRevision: number;
  placementGhost: PlacementGhostFrame | null;
  marbleDeposits: NonNullable<WorldData["scenario"]>["marbleDeposits"];
  roadDecorations: NonNullable<FrameState["roadDecorations"]>;
  roadDecorationGhost: FrameState["roadDecorationGhost"];
}

/** The editor state the preview reads: visibility, authored decoration models and the placement ghost. */
interface PreviewEditor {
  decorationFrames: () => PreviewFrame["roadDecorations"];
  decorationGhost: () => PreviewFrame["roadDecorationGhost"];
  isEnabled: () => boolean;
}

const ENEMY_COLOR = playerColorFromHex("#c62828");

/** Read-only renderer input, never a simulation: no actors, recruitment, combat or world edits. */
export const createScenarioRenderPreview = (world: WorldData, editor: PreviewEditor) => {
  const empty: PreviewFrame = { buildings: [], workers: [], roads: [], roadRevision: 0, placementGhost: null,
    marbleDeposits: [], roadDecorations: [], roadDecorationGhost: null };
  let definition = world.scenario, revision = -1, nation = "", theme = "";
  let cached = empty, depositSource = world.colonyStoneDeposits;
  const height = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  /** Decoration models change with the palette (and the ghost with the hover), not with the cached layout. */
  const withDecorations = (frame: PreviewFrame) => {
    if (frame === empty) return frame;
    frame.roadDecorations = editor.decorationFrames();
    frame.roadDecorationGhost = editor.decorationGhost();
    return frame;
  };
  const update = () => withDecorations(updateLayout());
  const updateLayout = () => {
    if (!editor.isEnabled()) { cached = empty; revision = -1; return empty; }
    const scenario = world.scenario;
    const deposits = scenario?.marbleDeposits ?? world.colonyStoneDeposits;
    if (!scenario) {
      if (definition !== undefined || revision !== (world.buildRevision ?? 0) || depositSource !== deposits) {
        definition = undefined; revision = world.buildRevision ?? 0; depositSource = deposits;
        cached = { ...empty, marbleDeposits: structuredClone([...getAuthoredDeposits(world)]) };
      }
      return cached;
    }
    if (definition === scenario && revision === (world.buildRevision ?? 0) &&
      nation === scenario.nation && theme === (scenario.theme ?? "forest") && depositSource === deposits) return cached;
    depositSource = deposits; definition = scenario; revision = world.buildRevision ?? 0; nation = scenario.nation; theme = scenario.theme ?? "forest";
    const building = (entry: Pick<ScenarioBuilding, "bandit" | "catapult" | "enclosure" | "faction" |
      "id" | "rotation" | "type" | "x" | "z">): BuildingFrame => ({
      id: `editor-scenario-building-${entry.id}`, type: entry.type, x: entry.x, y: height(entry.x, entry.z), z: entry.z,
      rotation: entry.rotation * Math.PI / 2, construction: 1, working: false, door: 0,
      nation: scenario.nation, owner: entry.faction, playerColor: entry.faction ? ENEMY_COLOR : [0.13, 0.32, 0.7],
      bandit: entry.bandit, enemyCampEnclosure: entry.enclosure, enemyCatapultVariant: entry.catapult?.variant,
      enemyStyle: { theme: scenario.theme ?? "forest" },
      ...(entry.catapult ? { inputStock: { stone: entry.catapult.roofStones ?? Math.min(2, entry.catapult.stones) },
        catapultSupply: { ground: entry.catapult.stones - (entry.catapult.roofStones ?? Math.min(2, entry.catapult.stones)) } } : {})
    });
    const buildings = scenario.buildings.map(building);
    if (scenario.headquarters) buildings.unshift(building({ ...scenario.headquarters, id: 0, type: 0, faction: 0 }));
    const appearances = createEnemyAppearances(world.seed)(scenario.nation);
    const workers: WorkerFrame[] = scenario.units.map(unit => ({
      ...appearances[unit.id % appearances.length]!, actorId: unit.id,
      x: unit.x, y: height(unit.x, unit.z), z: unit.z, heading: unit.heading,
      selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, target: null,
      armourRank: militaryArmourRank(unit.rank),
      combat: { type: unit.type, faction: unit.faction, attackProgress: null,
        bandit: adventureBanditStyle(unit.id, scenario.theme ?? "forest") }
    }));
    const plot = scenario.harbourPlot;
    const placementGhost: PlacementGhostFrame | null = plot ? { ...plot, type: 39, nation: scenario.nation,
      rotation: plot.rotation * Math.PI / 2, y: height(plot.x, plot.z), road: [], valid: true } : null;
    cached = { buildings, workers, roads: structuredClone(scenario.roads ?? []), roadRevision: revision,
      placementGhost, marbleDeposits: structuredClone([...getAuthoredDeposits(world)]), roadDecorations: [],
      roadDecorationGhost: null };
    return cached;
  };
  return { update, dispose: () => { cached = empty; definition = undefined; revision = -1; } };
};
