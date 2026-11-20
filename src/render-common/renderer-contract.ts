import type { ExplorationWeatherAudioSink } from "../app/audio/exploration-weather";
import type { MilitaryArrow } from "../shared/settlement/military-projectiles";
import type { RoadPreview, RoadSegment } from "../shared/settlement/road-types";
import type { SettlementFieldFrame } from "../shared/settlement/settlement-field-cycles";
import type { TransportHorseFrame } from "../shared/settlement/settlement-horses";
import type { TerritoryBorderPoint } from "../shared/settlement/settlement-territory";
import type { CellRegion } from "../shared/world/grid-geometry";
import type { SunDirection, WorldData } from "../shared/world/world-data";
import type { AdventureCampFrame } from "./adventure/adventure-camp";
import type { BirdFrame } from "./birds/bird-pool";
import type { BuildingFrame } from "./buildings/building-catalog";
import type { ButterflyFrame } from "./butterflies/butterfly-pool";
import type { CameraState } from "./camera-state";
import type { CharacterDetailChoice } from "./character-detail";
import type { SurfaceMode } from "./chunk-sampling";
import type { CinematicFrame, DrawnCameraPose } from "./cinematic/cinematic-frame";
import type { ColorOutputSettings, ColorTone } from "./color-output";
import type { ContentBuilders, SharedContentBuilders } from "./content-builders";
import type { CritterFrame } from "./critters/sim/critter-pool";
import type { EnvironmentState } from "./environment";
import type { ExplorationFrame } from "./exploration/exploration-frame";
import type { FellingFrame } from "./felling/felling-simulation";
import type { FlyerAtlas } from "./flyers/flyer-atlas";
import type { GroundShaderRequest } from "./ground-shader-variant";
import type { GrowthFrame } from "./growth/tree-growth";
import type { ViewportPoint } from "./iso-projection";
import type { LiveFogDisplayProvider } from "./live-fog";
import type { HandcartFrame } from "./logistics/handcart-frame";
import type { RegionRebuild } from "./map-edit/region-rebuild";
import type { GroundLayerSet } from "./materials/material-textures";
import type { MicroDetailAtlas } from "./materials/micro-detail-atlas";
import type { MountAppearance, MountFrame } from "./mounts/mount-frame";
import type { PresentationScheduler } from "./presentation-scheduler";
import type { AmbientOcclusion, BloomQuality, QualityPreset, SceneTarget, WaterReflections } from "./quality";
import type { RendererChoice } from "./renderer-choice";
import type { ResolutionProfile } from "./resolution";
import type { RuinScorchState } from "./ruin-scorch";
import type { MilitaryDeathFrame } from "./settlement/death-smoke";
import type { FishingBoatFrame, ShipFrame, ShipSiteFrame, ShuttleBoatFrame } from "./ships/ship-frame";
import type { StressEntities } from "./stress/stress-world";
import type { ChunkKey } from "./terrain-chunks";
import type { TrafficWearField } from "./traffic-wear";
import type { PaintedTexture } from "./trees/atlas-canvas";
import type { AnimalModels } from "./wildlife/model/animal-asset-loader";
import type { AnimalFrame } from "./wildlife/sim/animal-pool";
import type {
  ExplorationHeroBody, WorkerAppearance, WorkerFrame, WorkerNation
} from "./workers/worker-unit";

/** iso: the fixed view (screen picking works); cinematic: the perspective comfort camera. */
export type ViewMode = "iso" | "cinematic";

/**
 * The building the player is about to place, snapped to its plot: on a valid plot drawn almost
 * like the real building with its signpost and planned road, on a refused plot a red ghost.
 */
export interface PlacementGhostFrame {
  nation: WorkerNation;
  /**
   * Valid plots: the planned dirt road from its flag to the nearest road (empty: the flag is
   * already on a road; null: no route found). The renderer redraws it only when the array changes.
   */
  road: readonly { x: number; z: number }[] | null;
  /** Radians, like BuildingFrame.rotation. */
  rotation: number;
  type: number;
  /** Near real when the plot passes the placement rules, a red ghost when not. */
  valid: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * Faint previews of the building being placed on valid plots (a non-overlapping, capped set
 * near the camera centre), drawn with the zoomed-out model through one ghost material. The
 * renderer re-uploads the instances only when `revision` changes.
 */
export interface PlacementPreviewFrame {
  count: number;
  nation: WorkerNation;
  /** x, ground y and z of each plot centre; the first `count * 3` floats. */
  positions: Float32Array;
  revision: number;
  /** Radians, like BuildingFrame.rotation (every preview shares it). */
  rotation: number;
  type: number;
}

/** The planted rally banner's ground point (the foot of its pole). */
export interface RallyBannerFrame { x: number; y: number; z: number }
export interface RoadDecorationGhostFrame {
  item: import("../../../island-of-settlers-shared/src/road-decoration-items").RoadDecorationItemId;
  position: readonly [number, number, number];
  yaw: number;
  valid: boolean;
}

export interface FrameState {
  roadDecorations?: readonly import("../shared/settlement/road-decoration-state").RoadDecorationFrame[];
  roadDecorationGhost?: RoadDecorationGhostFrame | null;
  militaryArrows?: readonly (MilitaryArrow & { visualWeapon?: "arrow" | "bolt" | "javelin" })[];
  /** The player's persistent rally banner (absent until one is planted). */
  rallyBanner?: RallyBannerFrame | null;
  militaryDeaths?: readonly MilitaryDeathFrame[];
  /** Exposed owned-territory boundary points, sampled on dry terrain by the simulation. */
  territoryBorders?: readonly TerritoryBorderPoint[];
  /** Changes only when ownership sources or sampled terrain change. */
  territoryRevision?: number;
  ships?: readonly ShipFrame[];
  /** Ephemeral debug bodies: renderer only; excluded from simulation, fog and runtime worker lists. */
  shipPreviewWorkers?: readonly WorkerFrame[];
  shipSites?: readonly ShipSiteFrame[];
  /** Rowing boats of the nearby harbour shuttle (render-only, derived from their saved jobs). */
  shuttleBoats?: readonly ShuttleBoatFrame[];
  /** Fishery skiffs parked at the shore or afloat (render-only, from the saved boat custody). */
  fishingBoats?: readonly FishingBoatFrame[];
  /** Neutral field-camp dressing; never enters the building or pathfinding graphs. */
  marbleDeposits?: readonly import("../shared/settlement/colony-marble-deposits").MarbleDeposit[];
  adventureCamps?: readonly AdventureCampFrame[];
  transportHorses?: readonly TransportHorseFrame[];
  /** Hand carts pulled along the roads or parked. */
  handcarts?: readonly HandcartFrame[];
  fields?: readonly SettlementFieldFrame[];
  roads?: RoadSegment[];
  roadRevision?: number;
  roadPreview?: RoadPreview | null;
  /** Builder sites of bridges: their staged art is presentation-only until completion adds deck edges. */
  bridgeSites?: readonly import("../shared/settlement/bridge-construction").BridgeConstructionSnapshot[];
  /** The bridge whose panel is open: it keeps the hover outline (like a focused building). */
  selectedBridge?: number | null;
  placementGhost?: PlacementGhostFrame | null;
  placementPreviews?: PlacementPreviewFrame | null;
  /** Roman buildings, with construction and activity from the simulation. */
  buildings?: readonly BuildingFrame[];
  /** The player's workers (absent before they are placed). */
  workers?: readonly WorkerFrame[];
  /** Horses with riders (only the `?horse=1` dev trial). */
  mounts?: readonly MountFrame[];
  /** Mounted battlefield soldiers, keyed by their real soldier actor ID. */
  cavalryMounts?: readonly MountFrame[];
  /** Wandering land animals near the view (empty while animals are off). */
  animals: AnimalFrame;
  /** Ambient birds in flight (empty while birds are off). */
  birds: BirdFrame;
  /** Near-camera butterflies (empty while off, zoomed out, at night or in rain). */
  butterflies: ButterflyFrame;
  camera: CameraState;
  /**
   * CIN2 campaign cinematic overrides (camera, shake, area glints); absent in ordinary play. The RTS
   * `camera` above stays the untouched gameplay camera while a sequence plays.
   */
  cinematic?: CinematicFrame;
  /** Decorative wildlife near the view (ducks, herons, gulls, leaping fish) and water ripples. */
  critters: CritterFrame;
  /** EXPLORE-01 render-only overrides; absent in ordinary play. */
  exploration?: ExplorationFrame;
  environment: EnvironmentState;
  /** Low-resolution traffic wear from visible walking/cart actors; presentation-only. */
  trafficWear?: TrafficWearField;
  /** Scorched ground around fresh ruins (ruin-scorch.ts); presentation-only. */
  ruinScorch?: RuinScorchState;
  /** Trees being felled, stumps and falling leaves. */
  felling: FellingFrame;
  /** Growing and grown (mature) trees (empty while growth is off). */
  growth: GrowthFrame;
  /** Seconds since start; drives every animation (water, wind, clouds). */
  time: number;
}

export interface RendererStats {
  /** Renderer specific extras shown in the overlay (for example instance counts). */
  details: Record<string, number | string>;
}

export interface RendererInput {
  /** Appearance of each of the player's workers. */
  workers?: readonly WorkerAppearance[];
  /** Horses with riders (only the `?horse=1` dev trial). */
  mounts?: readonly MountAppearance[];
  /** Loaded animal models per species (null: that species is not drawn). */
  animals: AnimalModels;
  /** Nation of the island's buildings (its surface maps are painted ahead); none without a settlement. */
  buildingNation?: WorkerNation;
  /** Heavy CPU builds (rocks, terrain chunks, field cover, sprite bakes) off the main thread. */
  builders: ContentBuilders;
  canvas: HTMLCanvasElement;
  /** Player setting Character detail (C12): a live cap and cadence floor on the crowd. */
  characterDetail?: CharacterDetailChoice;
  /** Development only (?tonemap=, ?exposure=): overrides the Tone setting (decision D2). */
  colorOutput?: Partial<ColorOutputSettings>;
  /** Player setting Tone (Auto by default); presentation only. */
  colorTone?: ColorTone;
  /** Painted bird feathers and butterfly wings. */
  flyerAtlas: FlyerAtlas;
  /** Plays the thunder clap for a storm flash (absent in headless tools). */
  onLightning?: () => void;
  /** Painted foliage atlas of every leafy prop (tree sprays, palm fronds, bushes). */
  foliageAtlas: PaintedTexture;
  /** Player setting Highlights / glare 0..1 (render-common/highlights.ts); absent: 1 (tools, showcases). */
  highlights?: number;
  /** Ground shader variant (?ground=); default "auto": from the GPU's limits and build result. */
  groundShader?: GroundShaderRequest;
  /** Development only (?depth=1): requests the compositor's resolved depth texture (R12a timing). */
  sceneDepth?: boolean;
  /** Development only (?bloom=off|low|on): overrides QualityPreset.bloom (R11b A/B). */
  bloom?: BloomQuality;
  /** Development only (?ao=off|soft|strong|dramatic): overrides QualityPreset.ambientOcclusion (R12b A/B). */
  ambientOcclusion?: AmbientOcclusion;
  /** Development only (?hdr=off|rgba8|rgba16f): overrides QualityPreset.sceneTarget (R10 A/B). */
  sceneTarget?: SceneTarget;
  /** Development only (?ssr=off|on): overrides QualityPreset.waterReflections (R18b A/B). */
  waterReflections?: WaterReflections;
  /** Painted ground layers (texture array source, uploaded at QualityPreset.groundTileSize). */
  materials: GroundLayerSet;
  /** Near-band micro detail (T06a): CPU levels of the baked atlas. */
  microDetail: MicroDetailAtlas;
  /** Tileable stone detail of the sculpted rocks (triplanar). */
  rockTexture: PaintedTexture;
  quality: QualityPreset;
  /**
   * The global season can show snow (T1): the GPU snow cover ramp (uSeasonCover.w) is compiled, and the prepared
   * CPU winter assets of visualWinter are not used (they remain the fallback without it).
   */
  seasonSnow?: boolean;
  /** Cosmetic server season; selects cached CPU asset variants without changing the world. */
  visualWinter?: boolean;
  /**
   * Leftover-time scheduler of the render loop (R23) for presentation warm-up (impostor uploads).
   * Without one the renderer runs its own after each frame.
   */
  presentation?: PresentationScheduler;
  /** WG-0 renderer switch (dev/admin): the product default is the current WebGL2 renderer. */
  rendererMode?: RendererChoice;
  /** WG-0 measurement baseline: skip the offscreen shadow/refraction/post passes too. */
  spikeNoOffscreen?: boolean;
  /** Pixel ratio cap and MSAA (Resolution setting). */
  resolution: ResolutionProfile;
  /** Units, buildings and fish of the stress scenario (null when off). */
  stress: StressEntities | null;
  world: WorldData;
  /** EXPLORE: renderer-only display fog; never a gameplay visibility source. */
  explorationFog?: LiveFogDisplayProvider;
  /** EXPLORE: optional presentation thunder sink; borrowed, never a simulation input. */
  explorationAudio?: ExplorationWeatherAudioSink;
}

/**
 * Map editor hooks: after an edit changed the world data, the renderer rebuilds only what the
 * edit touched (gameplay never depends on it).
 */
export interface RendererMapEdit {
  /** Surface modes of the terrain chunks (the first is the ground): terrain edit rebuilds. */
  readonly surfaceModes: SurfaceMode[];
  /** Swaps in a terrain edit's rebuild: chunk meshes, rocks, water field (worker built). */
  applyRegion(rebuild: RegionRebuild): void;
  /** Shows edited heights at once on these chunks (main thread, before the worker rebuild). */
  previewRegion(chunks: readonly ChunkKey[], omitRockBand?: boolean): void;
  /** Re-reads these terrain chunks' ground (splat, ore, canopy); optionally their mine stones. */
  refreshChunks(chunks: readonly ChunkKey[], mineStones: boolean): void;
  /**
   * Stops drawing removed world props; `rockCells`: where meadow stones were removed or placed
   * (their stones are rebuilt there).
   */
  removeProps(sourceIndices: readonly number[], rockCells: CellRegion): void;
  /**
   * Removed rock props that came back (a respawned quarry boulder): each grows in at its spot, then
   * the meadow stones of `rockCells` are rebuilt with it.
   */
  growProps?(sourceIndices: readonly number[], rockCells: CellRegion): void;
  /** Regrows the field cover (grass, flowers, shells) on the cells' ground (after a stroke). */
  refreshFieldCover(cells: CellRegion): void;
  /** Remove newly covered procedural rocks, rebuilding only chunks that lost a rock. */
  refreshRockClearance?(): void;
  /** Clear grass, flowers and shore details under a reserved construction plot. */
  reserveConstructionGround?(cells: CellRegion): void;
  releaseConstructionGround?(cells: CellRegion): void;
  /** Clear only physical building coverage, preserving eligible grass in empty yard pockets. */
  reserveBuildingGroundCover?(uid: number, cells: readonly number[], region: CellRegion): void;
  /** Register several restored buildings' physical coverage and rebuild their cover once. */
  reserveBuildingGroundCovers?(
    entries: readonly { cells: readonly number[]; region: CellRegion; uid: number }[]
  ): void;
  releaseBuildingGroundCover?(uid: number, region: CellRegion): void;
  reserveRoadGround?(segments: readonly import("../shared/settlement/road-types").RoadSegment[]): void;
  /**
   * Re-reads the props the editor placed (world.props from `firstIndex` to its end) and the
   * removed world props an undo brought back (the static layers keep those hidden).
   */
  refreshPlacedProps(firstIndex: number): void;
}

/** What every terrain renderer offers; the app loop, input and benchmark only use this. */
/** What the soldiers' hover target outlines: at most one building, ship or soldier (none over plain ground). */
export interface ArmyTargetHoverOutline {
  buildingId?: string;
  shipId?: string;
  soldierId?: number;
}

export interface TerrainRenderer {
  /** The WebGL context, instrumented by the frame statistics. */
  readonly gl: WebGL2RenderingContext;
  /** Map editor rebuilds (incremental, per touched chunk). */
  readonly mapEdit: RendererMapEdit;
  prepareBuildings?(frames: readonly BuildingFrame[], environment: EnvironmentState, zoom: number): Promise<void>;
  /**
   * Loads the critter models of the species the island spawns (`CritterManager.presentSpecies`); the first
   * frame waits for them. Later calls (map edits) build the new species in leftover frame time.
   */
  prepareCritters?(species: readonly number[]): Promise<void>;
  /** Load visible actors and draw their GPU assets behind the loading screen. */
  prepareFrame?(frame: FrameState): Promise<void>;
  /** Adds a transient exploration visual root to the island scene; returns its idempotent removal. */
  addTransient?(object: object): () => void;
  /** EXPLORE: stable loader resolving the live worker crowd's body pool (opaque here). */
  createExplorationBodyLoader?(): unknown;
  /** Nearby placed structural undersides only; never called by idle exploration. */
  explorationCeilingHeight?(x: number, z: number, floor: number, radius: number, reach: number): number;
  /**
   * Prepare entry shaders/textures and the hero bodies before moving the camera; release with the
   * exploration lease. A release may defer GPU disposal past the return transition (C11).
   */
  prepareExplorationView?(heroes?: readonly ExplorationHeroBody[]): Promise<() => void>;
  /** Actual rig eye relative to actor render base; a supplied mount frame is posed before sampling. */
  militaryEyeOffset?(actor: number, mounted: boolean, drawnMount?: MountFrame): { x: number; y: number; z: number } | undefined;
  /** EXPLORE: the renderer-owned FPS weather adapter (opaque to the common contract). */
  explorationWeather?(): unknown;
  dispose(): void;
  getStats(): RendererStats;
  /** On-demand diagnostics only; ownership stays with the renderer, no polling/validation loop. */
  getResourceStats?(): { geometries: number; programs: number; textures: number };
  getViewMode(): ViewMode;
  /**
   * CIN2: the camera pose drawn by the last frame (null before the first frame); an iso view reports its
   * perspective equivalent. Cinematic shots record from it and the first transition starts from it.
   */
  currentCameraPose?(): DrawnCameraPose | null;
  /**
   * CIN2: one lightning bolt at a world point, also in clear weather (its flash is not cleared by the dry
   * sky), with the thunder clap. Presentation only.
   */
  strikeLightning?(x: number, z: number): void;
  /**
   * Walking surface of completed bridge decks and their shore ramps (undefined elsewhere): the one
   * B01 deck height shared by actors, carts, picking, the camera and the possessed body.
   */
  bridgeHeight?(x: number, z: number): number | undefined;
  /** Ground under a CSS-pixel map click, with the active renderer camera. */
  /** Sea-level surface under the pointer, rejecting land occlusion and points outside the map. */
  pickWater?(x: number, y: number): { x: number; y: number; z: number } | null;
  pickGround(x: number, y: number): { x: number; y: number; z: number } | null;
  pickBuilding?(x: number, y: number): string | null;
  /**
   * R16b: whether the building frame `id` draws its Detailed recipe now (per building in the possessed
   * view); undefined while it is not drawn. Presentation only (garrison window slots follow it).
   */
  isBuildingDetailed?(id: string): boolean | undefined;
  /** The bridge (completed or under construction) under a CSS-pixel point, nearer than any building. */
  pickBridge?(x: number, y: number): number | null;
  pickRoadDecoration?(x: number, y: number): number | null;
  pickShip?(x: number, y: number): string | null;
  /**
   * The soldiers' hover target (military controls P3), outlined through the existing hover outlines instead of
   * the renderer's own hover pick while set; null hands the hover back. A hostile building may be outlined.
   */
  setArmyTargetHover?(target: ArmyTargetHoverOutline | null): void;
  /** Whether this preset draws the shore shells (field cover; Minimal does not: nothing to collect). */
  drawsShoreShells?(): boolean;
  /** Where a world point is on screen with the camera of the last frame (picking). */
  projectToViewport(x: number, y: number, z: number): ViewportPoint;
  render(frame: FrameState): void;
  /** Resizes the drawing buffer and every resolution-dependent target (the pixel ratio may change). */
  resize(width: number, height: number, pixelRatio: number): void;
  setViewMode(mode: ViewMode): void;
  /**
   * C13 CPU lever of the budget controller: coarser pose cadence of small, distant characters
   * (0 = authored cadence). Presentation only; near, selected and fighting actors keep full cadence.
   */
  setAnimationCadenceBias?(bias: number): void;
  /**
   * Player setting Character detail, applied live: the LOD cap and the cadence floor of the crowd
   * (presentation only; the Detail level still sets the finest models it loads).
   */
  setCharacterDetail?(choice: CharacterDetailChoice): void;
  /** Player setting Tone, applied live from the next frame (presentation only). */
  setColorTone(tone: ColorTone): void;
  /** The Critters setting for the decorative fish schools (presentation only; none on Minimal). */
  setFishSchoolsEnabled?(enabled: boolean): void;
  /** Player setting Highlights / glare 0..1, applied live through the shared uniform (no recompile). */
  setHighlights(strength: number): void;
  /** The Critters setting for the rare decorative whales (off ends a running surfacing at once). */
  setWhalesEnabled?(enabled: boolean): void;
  /** Tunic colour (hex) of every worker, kept when their appearances are replaced. */
  setWorkerColor(color: string): void;
  /** Replace the workers' appearances without resetting movement or exploration. */
  setWorkerAppearances(appearances: readonly WorkerAppearance[]): Promise<boolean>;
  /** Prepare assets without showing them; a successful paid nation change commits synchronously. */
  prepareWorkerAppearances?(appearances: readonly WorkerAppearance[]): Promise<{
    commit: () => boolean;
    dispose: () => void;
  } | null>;
}

export type CreateRenderer = (input: RendererInput) => Promise<TerrainRenderer>;

/** What a renderer may start before the world exists: its world independent builds. */
export interface RendererPrefetch {
  buildingNation?: WorkerNation;
  builders: SharedContentBuilders;
  foliageAtlas: Promise<PaintedTexture>;
  quality: QualityPreset;
  sun: SunDirection;
}

/** A renderer chunk: its factory and an optional prefetch run while the island generates. */
export interface RendererModule {
  create: CreateRenderer;
  prefetch?: (input: RendererPrefetch) => void;
}
