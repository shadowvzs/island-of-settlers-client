import { BAMBOO_CONTENT_IDS, bambooBudget,
  type BambooGroveVariant } from "../../render-common/plants/bamboo-grove-species";
import type { RoadDecorationDefinition } from "./road-decoration-catalog";
import { ROAD_DECORATION_OPENING } from "./road-decoration-openings";

/** The authored climbing frames keep all low growth outside this narrow clear passage. */
const CLIMBER_OPENING = Object.freeze({ width: 1.55, height: 2.1 });

/** Additive content keeps every original portal/arch and its saved item identity intact. */
export const ADDITIONAL_ROAD_DECORATIONS: readonly RoadDecorationDefinition[] = [
  ...(["roman-doric-column", "roman-ionic-column"] as const).map((id, index): RoadDecorationDefinition => ({
    id, nation: "roman", family: "roman-column", variant: index as 0 | 1,
    placement: "terrain", cost: { stone: 0, planks: 0 }, triangles: [6500, 1800], wind: 0,
    stone: { defaultFamily: "limestone", families: ["limestone", "marble"] }
  })),
  ...(["japanese", "chinese"] as const).map((nation): RoadDecorationDefinition => ({
    id: `${nation}-wooden-lantern`, nation, family: "wooden-lantern", variant: 0,
    placement: "roadside", cost: { stone: 0, planks: 2 }, triangles: [3500, 1000], wind: 0
  })),
  { id: "japanese-hanging-lantern-torii", nation: "japanese", family: "torii", variant: 1,
    placement: "across-road", cost: { stone: 2, planks: 10 }, opening: ROAD_DECORATION_OPENING,
    triangles: [7000, 1800], wind: 0, hangingLanterns: true },
  { id: "chinese-hanging-lantern-pailou", nation: "chinese", family: "pailou", variant: 1,
    placement: "across-road", cost: { stone: 8, planks: 14 }, opening: ROAD_DECORATION_OPENING,
    triangles: [7000, 1800], wind: 0, hangingLanterns: true },
  ...([["curved", 0], ["lattice", 1], ["pergola", 2]] as const).map(([frame, variant]): RoadDecorationDefinition => ({
    id: `wisteria-${frame}`, nation: "indigenous", family: "pergola", variant,
    placement: "across-road", cost: { stone: 0, planks: 10 }, opening: { width: 1.55, height: 2.1 },
    triangles: [24000, 6000], wind: 0, wisteriaFrame: frame
  })),
  ...([0, 1, 2] as const).map((variant): RoadDecorationDefinition => ({
    id: `wisteria-tree-${variant}`, nation: "japanese", family: "tree", variant,
    placement: "terrain", cost: { stone: 0, planks: 1 }, triangles: [24000, 6000], wind: 0,
    wisteriaTreeVariant: variant
  })),
  ...BAMBOO_CONTENT_IDS.map((id, variant): RoadDecorationDefinition => {
    const budget = bambooBudget(variant as BambooGroveVariant);
    return { id, nation: "chinese", family: "tree", variant: 0, placement: "terrain", cost: { stone: 0, planks: 0 },
      triangles: [budget.high, budget.minimal], wind: 0, bambooVariant: variant as BambooGroveVariant };
  }),
  { id: "japanese-bamboo-stand", nation: "japanese", family: "plant", variant: 0, placement: "terrain",
    cost: { stone: 0, planks: 0 }, triangles: [3500, 1000], wind: 0, buildingBamboo: true },
  ...(["climbing-rose-white", "climbing-rose-red"] as const).map((climber, variant): RoadDecorationDefinition => ({
    id: climber, nation: "indigenous", family: "climber", variant: variant as 0 | 1,
    placement: "across-road", cost: { stone: 0, planks: 8 }, opening: CLIMBER_OPENING,
    triangles: [20000, 2600], wind: 0, climber
  })),
  { id: "ivy-lattice", nation: "roman", family: "climber", variant: 0,
    placement: "across-road", cost: { stone: 0, planks: 6 }, opening: CLIMBER_OPENING,
    triangles: [18000, 3500], wind: 0, climber: "ivy-lattice" }
];
