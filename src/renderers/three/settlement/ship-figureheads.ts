import { type BufferGeometry,Group, Mesh, MeshStandardMaterial } from "three";

import type { ShipLivery } from "../../../render-common/ships/ship-frame";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { dressDragonCarving } from "./ship-dragon-carving";
import { createShipDragonFigurehead } from "./ship-dragon-figurehead";
import { createShipEagleSculpt } from "./ship-eagle-sculpt";
import { createShipSerpentFigurehead, createShipStemPost } from "./ship-serpent-figurehead";

type Own = (geometry: BufferGeometry) => BufferGeometry;
export type ShipFigureheadKind = "dragon" | "eagle" | "none" | "serpent" | "stem";

/** The player's figurehead per nation: Japanese and Nubian hulls carry their own carved ends instead. */
const NATION_FIGUREHEADS: Readonly<Record<WorkerNation, ShipFigureheadKind>> = {
  maya: "none",
  persian: "none",
  chinese: "none",
  indigenous: "none",
  japanese: "none", nubian: "none", roman: "eagle", viking: "dragon"
};

/**
 * Raiders carry a carved serpent on their galley and neutral merchant ships a plain stem post (the hull
 * follows the same rule, `shipStyleFor`). The player's ships carry their
 * nation's figurehead: the gold eagle for Romans, a carved dragon for Vikings; the Japanese stem and
 * the Nubian papyrus finials are part of their hulls.
 */
export const shipFigureheadKind = (livery?: ShipLivery, nation: WorkerNation = "roman"): ShipFigureheadKind => {
  if (livery === "enemy") return "serpent";
  if (livery === "neutral") return "stem";
  return NATION_FIGUREHEADS[nation];
};

const createMaterials = (detailed: boolean) => ({
  bone: new MeshStandardMaterial({ color: 0xe6dcc2, roughness: .55 }),
  carved: dressDragonCarving(new MeshStandardMaterial({ metalness: .08, roughness: .62, vertexColors: true }),
    detailed),
  dragonEye: new MeshStandardMaterial({ color: 0x3a1a02, emissive: 0xffa02a, emissiveIntensity: 1.4, roughness: .3,
    vertexColors: false }),
  paint: new MeshStandardMaterial({ color: 0x9c1f18, roughness: .62 }),
  serpentEye: new MeshStandardMaterial({ color: 0x3a0603, emissive: 0xc0281a, emissiveIntensity: .9, roughness: .3 }),
  serpentWood: new MeshStandardMaterial({ color: 0x2c2018, roughness: .78 })
});

const serpentMeshes = (detailed: boolean, own: Own, materials: ReturnType<typeof createMaterials>) => {
  const { eyes, paint, teeth, wood } = createShipSerpentFigurehead(detailed, own);
  const meshes = [
    new Mesh(wood, materials.serpentWood), new Mesh(paint, materials.paint), new Mesh(eyes, materials.serpentEye)
  ];
  if (teeth) meshes.push(new Mesh(teeth, materials.bone));
  return meshes;
};

/**
 * Shared figurehead geometries; each craft clones the meshes (geometry stays shared) and shows the
 * one its livery and the player's nation ask for.
 */
export const createShipFigureheads = (
  detailed: boolean, own: Own, materials: { bronze: MeshStandardMaterial; dark: MeshStandardMaterial;
    gold?: MeshStandardMaterial }
) => {
  const figureheadMaterials = createMaterials(detailed);
  const dragon = createShipDragonFigurehead(detailed);
  const sources: Record<ShipFigureheadKind, Mesh[]> = {
    dragon: [
      new Mesh(own(dragon.carving), figureheadMaterials.carved),
      new Mesh(own(dragon.eyes), figureheadMaterials.dragonEye)
    ],
    eagle: createShipEagleSculpt(detailed, own, materials.gold ?? materials.bronze, materials.dark),
    none: [],
    serpent: serpentMeshes(detailed, own, figureheadMaterials),
    stem: [new Mesh(createShipStemPost(detailed, own), materials.dark)]
  };
  /** One craft's figureheads: a group per kind, all but one hidden. */
  const createFor = () => {
    const root = new Group(); root.name = "ship_figurehead";
    const kinds = new Map<ShipFigureheadKind, Group>();
    for (const [kind, meshes] of Object.entries(sources) as [ShipFigureheadKind, Mesh[]][]) {
      const group = new Group(); group.name = `ship_figurehead_${kind}`;
      for (const mesh of meshes) {
        const copy = mesh.clone(); copy.castShadow = true; group.add(copy);
      }
      kinds.set(kind, group); root.add(group);
    }
    const show = (livery?: ShipLivery, nation?: WorkerNation) => {
      const shown = shipFigureheadKind(livery, nation);
      for (const [kind, group] of kinds) group.visible = kind === shown;
    };
    show();
    return { root, show };
  };
  return { createFor, dispose: () => Object.values(figureheadMaterials).forEach(material => material.dispose()) };
};
