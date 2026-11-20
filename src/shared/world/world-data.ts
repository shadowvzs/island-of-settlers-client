import type { AdventureTheme } from "../settlement/adventure-themes";
import type { ExpeditionTheme } from "../settlement/island-discovery-policy";
import type { ThemeWeights } from "./generation/theme-field";

/** Ground materials, blended per vertex (splat weights). Small decorations are props instead. */
export const MATERIAL = {
  grass: 0,
  lushGrass: 1,
  forestFloor: 2,
  dirt: 3,
  sand: 4,
  rock: 5,
  snow: 6,
  gravel: 7,
  /** Pale mine gravel of the mine zones (mine-zones.ts). */
  mine: 8
} as const;

export const MATERIAL_COUNT = 9;

export const PROP = {
  broadleafTree: 0,
  coniferTree: 1,
  palmTree: 2,
  bush: 3,
  smallRock: 4,
  largeRock: 5,
  flowers: 6,
  mushrooms: 7,
  reeds: 8,
  cattail: 9,
  riverShrub: 10,
  willowShrub: 11,
  sedge: 12,
  berryBush: 13,
  fern: 14,
  sapling: 15,
  broadleafShrub: 16,
  fieldShrub: 17,
  birchTree: 18,
  /** Floating pads (and flowers) on calm fresh water (generation/water-plants.ts). */
  waterLily: 19,
  /** A patch of loose pebbles (map editor doodad): drawn by the rock layer, blocks nothing. */
  pebbles: 20,
  /** Colony timber; distinct from ordinary oak/birch through save, growth and felling. */
  hardwoodTree: 21,
  cedarTree: 22,
  walnutTree: 23,
  mahoganyTree: 24
} as const;

export const PROP_TYPE_COUNT = 25;

/**
 * Type of a prop entry that was removed while playing (map editor): the entry keeps its index, so
 * every id held elsewhere (felling, growth, renderer instances) stays valid; nothing draws,
 * blocks or counts it.
 */
export const PROP_REMOVED = 255;

export const SLOPE = { flat: 0, gentle: 1, steep: 2, cliff: 3 } as const;

/** Building quality per cell (largest building that fits). */
export const BUILD = { none: 0, flag: 1, small: 2, medium: 3, large: 4, mine: 5 } as const;

export const BLOCKING = { free: 0, water: 1, cliff: 2, prop: 3 } as const;

export const FOG = { hidden: 0, discovered: 1, visible: 2 } as const;

/**
 * Ore of a mine zone (one per zone). Granite is the stone the miners break; a barren zone
 * (none) is grey mine ground without ore.
 */
export const ORE = { none: 0, coal: 1, iron: 2, gold: 3, granite: 4 } as const;

export type Ore = (typeof ORE)[keyof typeof ORE];

/** Cell value of `mineZone` outside every zone; zone ids start at 1. */
export const NO_MINE_ZONE = 0;

/** A contiguous mine field at a mountain foot (or on a knoll), see mine-zones.ts. */
export interface MineZone {
  cellCount: number;
  /** Mean cell position (world units). */
  centreX: number;
  centreZ: number;
  id: number;
  ore: Ore;
  /** 0..1: how rich the deposit is (scales `oreAmount`). */
  richness: number;
  /** A geologist found the ore: its nonblocking ore signpost shows (the reveal setting reveals all). */
  surveyed: boolean;
}

export const NO_SECTOR = 0xffff;

/** Height of one discrete cliff level (gameplay), in world units. */
export const HEIGHT_LEVEL_STEP = 1.1;

/** Struct of arrays: one entry per prop instance, positions in world units. */
export interface PropSet {
  count: number;
  /**
   * Structural form per prop (one byte, 0 for props without forms): trees store their
   * archetype and competition form there (see tree-forms.ts).
   */
  form: Uint8Array;
  phase: Float32Array;
  rotation: Float32Array;
  scale: Float32Array;
  types: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/**
 * A river fall: the water surface drops from `top` to `bottom` over a short, steep step. (x, z)
 * is the middle of the drop, the direction (normalised) points downstream.
 */
export interface Waterfall {
  bottom: number;
  directionX: number;
  directionZ: number;
  /** Plunge pool below the fall: centre and radius (cells); the bed is widened and deepened. */
  poolRadius: number;
  poolX: number;
  poolZ: number;
  top: number;
  /** Width (cells) of the falling sheet across the flow. */
  width: number;
  x: number;
  z: number;
}

export interface SunDirection {
  /** Horizontal direction towards the sun, normalised (x, z). */
  azimuthX: number;
  azimuthZ: number;
  /** Elevation angle above the horizon, radians. */
  elevation: number;
}

/**
 * The generated island. Vertex layers have (cellsX + 1) * (cellsZ + 1) entries (row major, z rows),
 * cell layers cellsX * cellsZ. One cell is one world unit; y is up.
 */
/**
 * HARBOUR-SPOTS (owner 2026-11-09): a harbour plot the generator validated on the final coast with
 * the native placement rules and pre-levelled. `land`/`water`/`yaw` are its shore workpoint, berth
 * water point and hull heading at generation; runtime re-checks them before trusting the spot.
 */
export interface HarbourSpot {
  x: number;
  z: number;
  rotation: number;
  land: { x: number; z: number };
  water: { x: number; z: number };
  yaw: number;
}

export interface PlayableIslandLayout {
  minimumBuildingArea: { width: number; depth: number };
  channelWidth: number;
  sites: {
    x: number; z: number; radius: number; phase: number; spaceWidth: number; spaceDepth: number;
    buildingCount: number; headquarters: { x: number; z: number };
    harbour: { x: number; z: number; rotation: number };
    /** Stored only when the generator's 'Potential harbour spots' option is on. */
    harbourSpots?: HarbourSpot[];
  }[];
}

export interface WorldData {
  /** Unsaved presentation override; never replaces exploration/permanent sight layers. */
  fogDisplayDisabled?: boolean;
  environmentDefaults?: import("./environment-defaults").EnvironmentDefaults;
  /**
   * Editor-painted ground variants (render only, ground-variants.ts): GROUND_VARIANT_COUNT bytes per vertex;
   * absent on generated islands (their variants come from the procedural masks alone).
   */
  groundVariants?: Uint8Array;
  /** Explicit sand/soil colour family of the island (render only); absent fields are automatic. */
  groundPalette?: import("./ground-palette").GroundPalette;
  /**
   * Map-editor painted grass per cell (cover-paint.ts): 0 keeps the island's biome mix, 1..6 force
   * a cover kind. Render only; absent on generated islands.
   */
  coverPaint?: Uint8Array;
  /** Initial age in seconds of editor-authored trees; elapsed growth belongs to runtime saves. */
  authoredTreeAges?: Record<number, number>;
  authoredRivers?: import("./editing/authored-rivers").AuthoredRiver[];
  generatedRivers?: import("./editing/generated-river-types").GeneratedRiver[];
  generatedFeatureIdentities?: import("./generation/generated-feature-identities").GeneratedFeatureIdentity[];
  scenario?: import("./map-scenario").MapScenario;
  /**
   * The map script of the map file header (TRG1): triggers, quests, regions, cinematics and actors. Deep-frozen
   * once read (its hash is cached); an editor clones it to change it. Runs execute their start snapshot.
   */
  script?: import("../../../../island-of-settlers-shared/src/script/types/script").MapScript;
  /**
   * Audio the author uploaded with the map (AUDIO-CATALOG): stored in the map file header beside the script, which
   * references it by id (`playSound` / `playMusic`). Presentation only; the simulation never reads it.
   */
  audioAssets?: import("../../../../island-of-settlers-shared/src/script/audio").MapAudioAsset[];
  /** Generation proof sites and minimum dimensions, retained in exported maps. */
  playableIslands?: PlayableIslandLayout;
  /** Permanent exploration sources; temporary worker sight is saved separately. */
  permanentFog?: Uint8Array;
  /** Boot repaired road elevations before terrain and rock meshes were built. Consumed on simulation restore. */
  settlementRoadTerrainPrepared?: boolean;
  /** Stable road-grading source and last result; external edits replace only changed source vertices. */
  roadGradeBase?: Float32Array;
  roadGradeApplied?: Float32Array;
  /** Derived road/building clearance for procedural rock generation and editor rebuilds. */
  settlementGroundClearance?: Uint8Array;
  /** Permanently cleared stone footprints, including invisible quarry seams. */
  clearedStoneGround?: Uint8Array;
  cellsX: number;
  cellsZ: number;
  seaLevel: number;
  seed: number;
  start: { x: number; z: number };
  sun: SunDirection;

  // vertex layers
  ambientOcclusion: Uint8Array;
  /**
   * Lake water per vertex (1: a fresh, still lake the map editor dug; absent on generated
   * islands): still water for the water plants, weeds and the water shading.
   */
  lakeWater?: Uint8Array;
  /** Explicit editor-captured baseline; optional legacy maps make no provenance claim. */
  restoreBaselineName?: string;
  restoreBaselineHeights?: Float32Array;
  restoreBaselineWater?: Float32Array;
  restoreBaselineLake?: Uint8Array;
  coastDistance: Float32Array;
  flow: Float32Array;
  heightLevels: Uint8Array;
  heights: Float32Array;
  moisture: Uint8Array;
  normals: Float32Array;
  /** Distance (cells) to the nearest river bed vertex (channels, estuaries, plunge pools). */
  riverDistance: Float32Array;
  splat: Uint8Array;
  sunShadow: Uint8Array;
  /**
   * Theme weights per vertex (THEME_COUNT bytes, ISLAND_THEMES order, sum 255): the local theme
   * mix. Renderers read the local cover and rock tints from it (createThemeSampler).
   */
  themeWeights: ThemeWeights;
  /** Adventure presentation metadata; restored from the persisted island offer on game load. */
  adventureTheme?: AdventureTheme;
  /** Transient expedition rendering metadata; restored from its saved island record on load. */
  expeditionKind?: "adventure" | "colony";
  expeditionTheme?: ExpeditionTheme;
  /** Committed discovery pair; absent preserves legacy islands. */
  colonyResourceTier?: import("./colony-resource-tiers").ColonyResourceTier;
  /** Exact built-in generator inputs, when the map has an available reproducible seed baseline. */
  generationProvenance?: import("./generation/generation-provenance").GenerationProvenance;
  /** Stable existing surface-rock props promoted to finite specialist deposits. */
  colonyStoneDeposits?: import("./marble-deposit").MarbleDeposit[];
  waterDepth: Float32Array;
  waterSurface: Float32Array;
  /**
   * Wet ground 0..255: spray around waterfalls and plunge pools, splash along steep channels
   * (gorges). Rock and ground darken and gloss by it.
   */
  wetRock: Uint8Array;
  // cell layers
  blocking: Uint8Array;
  /**
   * The most the terrain alone allows per cell (BUILD value, build-class.ts); the build class
   * adds the props on top, so a felled tree frees its surroundings again.
   */
  buildCap: Uint8Array;
  buildClass: Uint8Array;
  /** Changes whenever the build class changes while playing (a felled tree). */
  buildRevision?: number;
  /** Derived height/water edit revision; independent of trees and construction. */
  terrainRevision?: number;
  fog: Uint8Array;
  /** Changes when units update visibility; not part of terrain generation. */
  fogRevision?: number;
  /**
   * Changes only when a hidden cell becomes explored (discovered or visible): charting and other
   * exploration readers follow it instead of every live-sight change of `fogRevision`. Runtime only.
   */
  exploredRevision?: number;
  /**
   * Runtime only (restored from the settlement save): collected shore shells that reappeared
   * elsewhere, flat [shell index, x, z, ...] (render-common/props/shore-shell-spots.ts order).
   */
  shoreShellMoves?: number[];
  /** Runtime-only survey flags before Development's reveal-ore override; never serialized. */
  surveyedBeforeReveal?: [number, boolean][];
  /** Mine zone id per cell (NO_MINE_ZONE outside); `mineZones[id - 1]` holds the zone. */
  mineZone: Uint16Array;
  /** Ore left per cell, 0..255 (0 outside the zones or once mined out). */
  oreAmount: Uint8Array;
  sector: Uint16Array;
  slopeClass: Uint8Array;
  /** Unit walking cost per cell: 0 impassable, 10 open flat ground, more on slopes, forest. */
  walkCost: Uint8Array;
  // objects
  mineZones: MineZone[];
  props: PropSet;
  waterfalls: Waterfall[];
}

/** Every typed array buffer of the world, for zero copy transfer out of the worker. */
export const getWorldTransferables = (world: WorldData): ArrayBuffer[] => {
  const { props } = world;
  const arrays: ArrayBufferView[] = [
    world.ambientOcclusion,
    world.coastDistance,
    world.flow,
    world.heightLevels,
    world.heights,
    world.normals,
    world.riverDistance,
    world.splat,
    world.sunShadow,
    world.themeWeights,
    world.waterDepth,
    world.waterSurface,
    world.wetRock,
    world.blocking,
    world.buildCap,
    world.buildClass,
    world.fog,
    world.mineZone,
    world.moisture,
    world.oreAmount,
    world.sector,
    world.slopeClass,
    world.walkCost,
    props.form,
    props.phase,
    props.rotation,
    props.scale,
    props.types,
    props.x,
    props.y,
    props.z
  ];
  if (world.clearedStoneGround) arrays.push(world.clearedStoneGround);
  if (world.coverPaint) arrays.push(world.coverPaint);
  if (world.settlementGroundClearance) arrays.push(world.settlementGroundClearance);
  if (world.roadGradeBase) arrays.push(world.roadGradeBase);
  if (world.roadGradeApplied) arrays.push(world.roadGradeApplied);
  return arrays.map((array) => array.buffer as ArrayBuffer);
};
