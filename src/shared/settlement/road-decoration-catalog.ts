import {
  ROAD_DECORATION_ITEM_DEFINITIONS, type RoadDecorationItemDefinition
} from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { MAPLE_MODEL_TRIANGLE_COST, ornamentalPlantModel } from "../../../../island-of-settlers-shared/src/road-plant-models";
import type { BambooGroveVariant } from "../../render-common/plants/bamboo-grove-species";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { ADDITIONAL_ROAD_DECORATIONS } from "./road-decoration-additions";
import { ROAD_DECORATION_OPENING, ROAD_DECORATION_TIMBER_OPENING } from "./road-decoration-openings";

export { ROAD_DECORATION_OPENING, ROAD_DECORATION_TIMBER_OPENING } from "./road-decoration-openings";

export type RoadDecorationFamily = "roman-arch" | "torii" | "stone-lantern" | "pailou" |
  "persian-portal" | "maya-portal" | "timber-portal" | "pergola" | "flower-pot" | "nubian-portal" |
  "plant" | "tree" | "wooden-lantern" | "roman-column" | "climber";
export type RoadDecorationStoneFamily = "limestone" | "granite" | "marble";
export type RoadClimberKind = "climbing-rose-white" | "climbing-rose-red" | "ivy-lattice";
export const ROAD_DECORATION_POT_FOOT = Object.freeze({ radius: .095, height: .045 });

export interface RoadDecorationDefinition {
  id: string;
  nation: WorkerNation;
  family: RoadDecorationFamily;
  variant: 0 | 1 | 2;
  placement: "across-road" | "roadside" | "terrain";
  /** SUPERSEDED historical prototype cost. Current owner flow uses inventory custody, never goods payment. */
  cost: Readonly<{ stone: number; planks: number }>;
  /** Both LODs share these guaranteed world-space opening dimensions. */
  opening?: Readonly<{ width: number; height: number }>;
  triangles: readonly [high: number, minimal: number];
  wind: 0;
  stone?: Readonly<{ defaultFamily: RoadDecorationStoneFamily; families: readonly RoadDecorationStoneFamily[] }>;
  plant?: Readonly<PlantDecorationAsset>;
  /** Original additive botanical frames use the canonical K geometry and physical graph. */
  wisteriaFrame?: "curved" | "lattice" | "pergola";
  wisteriaTreeVariant?: 0 | 1 | 2;
  /** Original parametric bamboo grove (render-common/plants/bamboo-grove-species). */
  bambooVariant?: BambooGroveVariant;
  /** The Japanese buildings' bamboo stand recipe (building/editor use only). */
  buildingBamboo?: boolean;
  /** ROAD-PLANTS-37 rose and ivy frames share the authored wooden arch joinery only. */
  climber?: RoadClimberKind;
  /** Keeps the unadorned national portal as a distinct existing model. */
  hangingLanterns?: boolean;
}

const portal = (id: string, nation: WorkerNation, family: RoadDecorationFamily, variant: 0 | 1,
  stone: number, planks: number): RoadDecorationDefinition => ({ id, nation, family, variant,
  placement: "across-road", cost: { stone, planks },
  opening: ["timber-portal", "pergola"].includes(family) ? ROAD_DECORATION_TIMBER_OPENING : ROAD_DECORATION_OPENING,
  triangles: [7000, 1800], wind: 0,
  stone: ["roman-arch", "persian-portal", "maya-portal", "nubian-portal"].includes(family)
    ? { defaultFamily: "limestone", families: family === "roman-arch" ? ["limestone", "granite", "marble"] : ["limestone"] }
    : undefined });
const roadside = (id: string, nation: WorkerNation, family: RoadDecorationFamily,
  variant: 0 | 1, stone: number, planks: number): RoadDecorationDefinition => ({ id, nation, family, variant,
  placement: "roadside", cost: { stone, planks }, triangles: [3500, 1000], wind: 0,
  stone: family === "stone-lantern" ? { defaultFamily: "granite", families: ["granite"] } : undefined });

/** Stable content IDs; production picker exposure waits for accepted models and authoritative commands. */
export const ROAD_DECORATIONS: readonly RoadDecorationDefinition[] = [
  portal("roman-rusticated-arch", "roman", "roman-arch", 0, 12, 0),
  portal("roman-ceremonial-arch", "roman", "roman-arch", 1, 20, 2),
  portal("japanese-timber-torii", "japanese", "torii", 0, 2, 10),
  roadside("japanese-stone-lantern", "japanese", "stone-lantern", 0, 6, 0),
  portal("chinese-pailou", "chinese", "pailou", 0, 8, 14),
  roadside("chinese-stone-lantern", "chinese", "stone-lantern", 1, 8, 0),
  portal("persian-pointed-portal", "persian", "persian-portal", 0, 16, 2),
  portal("persian-relief-portal", "persian", "persian-portal", 1, 22, 4),
  portal("maya-corbelled-portal", "maya", "maya-portal", 0, 14, 0),
  portal("maya-triangle-portal", "maya", "maya-portal", 1, 20, 0),
  portal("viking-timber-portal", "viking", "timber-portal", 0, 2, 12),
  portal("viking-carved-portal", "viking", "timber-portal", 1, 4, 18),
  portal("indigenous-flowering-pergola", "indigenous", "pergola", 0, 0, 10),
  roadside("indigenous-flower-pot", "indigenous", "flower-pot", 0, 2, 2),
  portal("nubian-carved-portal", "nubian", "nubian-portal", 0, 16, 2),
  roadside("nubian-flower-pot", "nubian", "flower-pot", 1, 3, 2)
];

type PlantItem = RoadDecorationItemDefinition & { plant: Readonly<PlantDecorationAsset> };
const isPlantItem = (item: RoadDecorationItemDefinition): item is PlantItem => item.plant !== undefined;

/** Ornamental plant models of the catalog's plant decorations (one native item each); custody and rendering. */
export const STAGED_PLANT_DECORATIONS: readonly RoadDecorationDefinition[] =
  Object.values(ROAD_DECORATION_ITEM_DEFINITIONS).filter(isPlantItem).map(item => ({
    id: item.decoration, nation: item.nation, family: item.category === "trees" ? "tree" : "plant",
    variant: item.plant.variant, placement: "terrain", cost: { stone: 0, planks: 0 },
    triangles: ornamentalPlantModel(item.plant) === "maple-tree"
      ? [MAPLE_MODEL_TRIANGLE_COST.high, MAPLE_MODEL_TRIANGLE_COST.minimal] : [24000, 6000],
    wind: 0, plant: item.plant
  }));
const plantDefinitions = new Map(STAGED_PLANT_DECORATIONS.map(definition => [definition.id, definition]));
export const ALL_ROAD_DECORATIONS = [...ROAD_DECORATIONS, ...ADDITIONAL_ROAD_DECORATIONS];
export const getRoadDecoration = (id: string) => ALL_ROAD_DECORATIONS.find(entry => entry.id === id) ?? plantDefinitions.get(id);
