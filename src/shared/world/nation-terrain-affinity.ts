import {
  type ContentText,
  entryByKey,
  type NationTerrainAffinity,
  nationTerrainAffinity,
  splitContentId,
  type TerrainGroundMaterial,
  type TerrainGroundVariant
} from "@shared/catalog";

import { type Nation,NATIONS } from "../../../../island-of-settlers-shared/src/nations";
import type { GenerationProvenance } from "./generation/generation-provenance";

/**
 * NATION-TERRAIN (owner 2026-11-18): reads of the nation content data's homeland landscape affinity. The map editor
 * derives its tile/grass/palette tooltips from here; the world generator and the field cover read the same table.
 */
export type TerrainPaletteField = "rock" | "sand" | "soil";

const PALETTE_TYPICAL_FIELD = {
  rock: "rockTypical",
  sand: "sandTypical",
  soil: "soilTypical"
} as const;

/** The typical-palette list of one field (strings: the editor value is not yet narrowed to a palette id). */
const typicalPalettes = (affinity: NationTerrainAffinity, field: TerrainPaletteField): readonly string[] =>
  affinity.palette[PALETTE_TYPICAL_FIELD[field]];

/** The homeland affinity of a nation (catalog data); undefined keeps the temperate defaults. */
export const getNationTerrainAffinity = (
  nation: string | undefined
): NationTerrainAffinity | undefined => (nation ? nationTerrainAffinity(nation) : undefined);

const affinityNations = (): readonly Nation[] =>
  NATIONS.filter(nation => nationTerrainAffinity(nation) !== undefined);

const nationsMatching = (matches: (affinity: NationTerrainAffinity) => boolean): readonly Nation[] =>
  NATIONS.filter(nation => {
    const affinity = nationTerrainAffinity(nation);
    return affinity !== undefined && matches(affinity);
  });

/** Nations whose homeland typically shows a ground material (map editor tile tooltip). */
export const nationsTypicalOfGround = (ground: TerrainGroundMaterial): readonly Nation[] =>
  nationsMatching(affinity => affinity.ground.includes(ground));

/** Nations whose homeland typically shows a ground variant (map editor variant tooltip). */
export const nationsTypicalOfVariant = (variant: TerrainGroundVariant): readonly Nation[] =>
  nationsMatching(affinity => affinity.variants.includes(variant));

/**
 * Nations whose homeland is typical of a palette choice; `auto` means the climate chooses, so every nation with an
 * affinity is typical. The palette's default id is always listed in its typical list by the data validator.
 */
export const nationsTypicalOfPalette = (field: TerrainPaletteField, value: string): readonly Nation[] => {
  if (value === "auto") return affinityNations();
  return nationsMatching(affinity => typicalPalettes(affinity, field).includes(value));
};

/** Nations whose homeland typically grows a cover kind (catalog `plant:*` id; map editor grass tooltip). */
export const nationsTypicalOfCover = (plantId: string): readonly Nation[] =>
  nationsMatching(affinity => affinity.cover.includes(plantId));

/** One grass/cover kind with the nations it is typical of (catalog id order). */
export interface CoverKindAssociation {
  id: string;
  name: ContentText;
  nations: readonly Nation[];
}

/** Every cover kind named by the affinity table, with its catalog name and typical nations (editor help). */
export const coverKindAssociations = (): readonly CoverKindAssociation[] => {
  const ids = [...new Set(affinityNations().flatMap(nation => nationTerrainAffinity(nation)!.cover))].sort();
  return ids.flatMap(id => {
    const parts = splitContentId(id);
    const name = parts ? entryByKey("plant", parts.key)?.text.name : undefined;
    if (!name) return [];
    return [{ id, name, nations: nationsTypicalOfCover(id) }];
  });
};

/** Numeric cover kinds the homeland favours (catalog plant codes); undefined without an affinity. */
export const favoredCoverKinds = (
  affinity: NationTerrainAffinity | undefined
): ReadonlySet<number> | undefined => {
  const codes = (affinity?.cover ?? []).flatMap(id => {
    const parts = splitContentId(id);
    const code = parts ? entryByKey("plant", parts.key)?.code : undefined;
    return code === undefined ? [] : [code];
  });
  return codes.length ? new Set(codes) : undefined;
};

/** The affinity of a generated world, from its recorded options (map files keep the generation provenance). */
export const getWorldNationAffinity = (
  world: { generationProvenance?: GenerationProvenance }
): NationTerrainAffinity | undefined => getNationTerrainAffinity(world.generationProvenance?.options.nation);
