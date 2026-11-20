import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";

export const roadDecorationModelReady = (definition: RoadDecorationDefinition) =>
  ["roman-arch", "torii", "stone-lantern", "maya-portal", "pailou", "persian-portal", "nubian-portal",
    "timber-portal", "pergola", "flower-pot", "plant", "tree", "wooden-lantern", "roman-column",
    "climber"].includes(definition.family);
