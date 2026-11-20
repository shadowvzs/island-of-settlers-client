import { DMath } from "../../shared/math/deterministic-math";
import { HARBOUR_TYPE_ID, MILL_TYPE_ID, WOODCUTTER_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { addTimberPlanks } from "../wares/ware-timber-recipe";
import { advancedMaterialBaseDefinition, withAdvancedMaterialStocks } from "./advanced-material-buildings";
import { authorBuildingArchitecture } from "./building-architecture";
import type { BuildingDefinition } from "./building-catalog";
import { withBuildingStock } from "./building-stock-parts";
import { withRomanMasonryTextureScale } from "./building-texture-scale";
import { createOpeningShadowDisk } from "./building-window-shadows";
import { createCatapultTowerRecipe } from "./catapult-tower-recipe";
import { createRomanFlaxWeaverRecipe, isFlaxWeaverBuilding } from "./flax-weaver-designs";
import { withHarbourTowerRoofOpenings } from "./harbour-tower-clearance";
import { MONUMENT_TYPE_ID, monumentRecipe } from "./monument-definition";
import { createDecorativeWeaponRack } from "./national-decorative-weapons";
import { applyRomanAlternativeRoof } from "./roman-alternative-roofs";
import { placeRomanBreweryInputs } from "./roman-brewery-detail";
import { addRomanGuardTower, type RomanMilitaryAnchors } from "./roman-civic-military";
import { addRomanDoorSpandrels, DEFAULT_ROMAN_DOOR, ROMAN_ARCHED_DOOR_IDS } from "./roman-door-profile";
import { addRomanFarmVisualDetail } from "./roman-farm-visual-detail";
import { addRomanFireboxCavity } from "./roman-firebox-cavity";
import { fitRomanFlourStock } from "./roman-flour-stock";
import { createRomanGableRoof } from "./roman-gable-roof";
import { fitRomanMillGrainStock } from "./roman-grain-stock";
import { addFisheryInterior,addHunterDetails } from "./roman-hunter-fishery-details";
import { addRomanMasonryRelief } from "./roman-masonry-relief";
import { romanStaticModelCenteringOffset, translateRomanBuildingRecipe } from "./roman-military-centering";
import { ROMAN_MILL_HUB_HEIGHT } from "./roman-mill-dimensions";
import { addRomanMillStructure } from "./roman-mill-structure";
import { addRomanOccupationPainting } from "./roman-occupation-paintings";
import { applyRomanOccupationRoofs } from "./roman-occupation-roofs";
import { addMissingRomanProductionStocks } from "./roman-production-stock";
import { addRomanRedesignedBuilding, ROMAN_REDESIGNED_LAYOUTS } from "./roman-redesigned-buildings";
import { type AddPart, addRomanResourceFacade, addRomanResourceWorkshop, addRomanSeedling } from "./roman-resource-workshops";
import { addRomanRoofTiles } from "./roman-roof-tiles";
import { fitRomanSawmillTimber } from "./roman-sawmill-timber";
import { addRomanSecondBatchDetails } from "./roman-second-batch";
import { addRomanThirdBatch, ROMAN_THIRD_BATCH_IDS } from "./roman-third-batch";
import { fitRomanWoodcutterTimber } from "./roman-woodcutter-timber";
import { withSawmillStockRecipes } from "./sawmill-stock-recipes";
import { STORAGE_DOUBLE_DOOR, usesStorageDoubleDoor } from "./storage-door-profile";
import { authorWorkyardAssembly } from "./workyard-assembly";

export type BuildingSurface =
  | "copper"
  | "feed-grain"
  | "feed-water"
  | "tanning-liquid"
  | "mosaic"
  | "rope"
  | "paint"
  | "plaster"
  | "stone"
  | "cut-stone"
  | "bread"
  | "wood"
  /** Upright boards with seams (nation stave walls, gables, skirting), mapped in recipe units. */
  | "planks"
  | "roof"
  | "roof-thatch"
  | "palm-thatch"
  | "palm-trunk"
  /** Roof geometry markers (flat tile courses, yagura skirts) drawn with the nation's roof material. */
  | "roof-shingles"
  | "roof-slate"
  | "steel"
  | "iron"
  | "cloth"
  | "cloth-water"
  | "cloth-council"
  | "leaf"
  | "dark"
  | "gold"
  | "bark"
  | "endgrain"
  | "fish"
  | "sacking"
  | "straw"
  | "amber"
  /** Raw animal hide: flesh fibres on the texture's left half, fur on the right (stretched-hide). */
  | "hide"
  | NationDecorSurface
  | import("./indigenous-textile-styles").IndigenousTextileSurface;
/**
 * Atlas surfaces only the nation's own material pack provides: Nubian woven wall hangings (dyed
 * palm-fibre designs, swaying in the wind on High) and painted jars, hide shields, hats and skulls.
 */
export type NationDecorSurface = "nubian-textile" | "nubian-decor" | "japanese-bamboo" | "japanese-white-stone" | "japanese-catapult-stone" | "indigenous-rubble" | "chinese-red-brick";
export type Point3 = [number, number, number];
/** Vertical cylindrical roof opening in recipe (building) coordinates. */
export interface RoofOpening { radius: number; x: number; z: number; }
/** Lathe-turned drink chain bodies: casks, jars, gourds, honey pots, rice bales, skeps, nuts. */
export type DrinkVesselShape = "barrel" | "bowl" | "straight-cup" | "clay-jar" | "coconut" | "gourd" | "honey-pot" | "rice-bale"
  | "skep";
export interface BuildingPart {
  /** Keep the top or complementary faces of an actual room-bearing primitive, without adding faces. */
  interiorFloorFaces?: "top" | "sides";
  yaguraOpenings?: readonly import("./yagura-wall-openings").YaguraWallOpening[];
  /** Actual architectural culms: round posts, flat-backed wall facing or hollow split roof channels. */
  bambooSection?: "round" | "facing" | "split";
  bambooPhase?: number;
  bambooConcave?: boolean;
  bambooUpgrade?: true;
  bambooDoorJamb?: true;
  indigenousPigment?: import("./indigenous-building-motifs").IndigenousBuildingMotif;
  indigenousPigmentRegion?: import("./indigenous-building-motifs").IndigenousPigmentRegion;
  /** Front-facing projection still follows the original textile triangles. */
  indigenousPigmentProjection?: "front";
  /** Pigment on an existing planar reed wall; never a new physical board. */
  indigenousPigmentFlat?: boolean;
  /** Existing masonry faces carrying one projected painting; never a new placard or wall. */
  indigenousPigmentCarriers?: readonly {
    masonry?: true; position: Point3; size: Point3; variant?: number;
  }[];
  catapultShellNation?: import("./catapult-national-shell-profile").CatapultShellNation;
  /** Fitted tower-only timber frame and its actual shaped reveal; never a whole-roster retrofit. */
  catapultWindowStyle?: import("./catapult-window-profiles").CatapultWindowStyle;
  catapultPart?: "arm" | "loaded" | "crank" | "frame" | "trigger" | "hatch";
  /** Non-operational, grounded national yard ornament; never inventory or a placeable building. */
  yardDecoration?: "shrine" | "totem" | "figurine";
  /** Inherited shell/frame authoring; national models may replace it without removing work equipment. */
  architecture?: true;
  /** Productive equipment group; redesigns replace or relocate the whole assembly exactly once. */
  workyardAssembly?: string;
  /** Decorative rack group only; independent from all operational stock tags. */
  decorativeRack?: number;
  /** Small occupation tablet and its pictogram, never a wall painting or stored ware. */
  occupationSign?: true;
  /** Small decorative assemblies retain their silhouette with fewer hidden/profile segments. */
  compactGeometry?: boolean;
  /** An open tube (no end caps): a proud painted band or ring, never a shelf or a capped volume. */
  openEnded?: true;
  /** Explicit ground-contact box underside omission; only Minimal rendering drops these hidden faces. */
  omitGroundBottom?: true;
  /** Explicit local box caps proven entirely buried inside a support or the ground, both LODs. */
  buriedBoxFaces?: readonly import("./buried-box-face").BuriedBoxFace[];
  /** Explicit roof-only LOD policy; general prop compaction must never silently simplify authored roofs. */
  roofCompactGeometry?: true;
  campWallSide?: number;
  occupationRoof?: "hip" | "half-hip" | "barrel" | "gable" | "pyramid";
  roofOculus?: boolean;
  /** Individually modelled Chinese concave pans and rounded overlapping cover tiles. */
  roofTiles?: "pan-cover";
  /** Ceramic piece size multiplier, allowing ornate buildings to retain the shared triangle budget. */
  roofTileSpacing?: number;
  /** Restrained curved eaves/corners on national occupation roofs, in unit roof height. */
  roofSweep?: number;
  /** Concavity of the roof pitches, preserving the original ridge and eave contacts. */
  roofCurve?: number;
  indigenousRoof?: import("./indigenous-roof-profile").IndigenousRoofProfile;
  /** Normalized x bounds and roof height of the open entrance into a full-height lodge. */
  indigenousEntrance?: [number, number, number];
  indigenousRearEntrance?: [number, number, number];
  indigenousCutout?: boolean;
  /** Sewn quadrilateral normalized to the shared position/size bounds. */
  clothPanelCorners?: import("./indigenous-tipi-portal").ClothPanelCorners;
  chineseRoofBearingProfile?: import("./chinese-roof-bearing-profile").ChineseRoofBearingProfile;
  /** Optional rounded-rectangle corner radius for a fortress textile sleeve; default .065. */
  indigenousFrameRadius?: number;
  /** Normalized clear doorway in a hollow curved Persian chamber. */
  persianOpening?: [number, number, number];
  roofInfillRatio?: [number, number];
  campDecoration?: import("../adventure/adventure-camp").CampDecorationKind;
  campTheme?: import("../adventure/adventure-camp-style").AdventureCampTheme;
  campTentVariant?: import("../adventure/adventure-camp-style").CampTentVariant;
  radialSegments?: number;
  /** Explicit rough-stone facet budget; ordinary well stones retain their existing LOD default. */
  rockFacets?: 8 | 20 | 80;
  /** Front-only stone faces are bonded into opaque mortar; their buried backs are never rendered. */
  rockBuriedBack?: true;
  /** Close-packed Indigenous workshop masonry has broad clipped faces and narrow mortar joints. */
  indigenousMasonryStone?: true;
  /** Fitted rubble is cut around the conserved tower entry and window apertures at model creation. */
  catapultRubble?: true;
  /** Actual wall-height interval of an attached national Catapult string course. */
  catapultShellBand?: [number, number];
  catapultWallOrnament?: true;
  /** Decorative hardware bonded to an existing wall; the wall already supplies its collision. */
  wallMountedDecoration?: true;
  /** Elliptical load-bearing plan of a closed Persian vaulted room, relative to roof size. */
  persianRoofPlan?: [number, number];
  persianAwningWall?: import("../props/persian-striped-awning").PersianAwningWall;
  plantRoofStyle?: import("./maya-plant-roof-profile").MayaPlantRoofStyle;
  /** Local unit-plan ellipses of round towers pierced by this thatch surface. */
  roofPlanCuts?: readonly import("./maya-plant-roof-profile").MayaRoofPlanCut[];
  /** Cheap inward-facing wall/reveal tint; preserves geometry and uses the existing vertex colours. */
  interiorShade?: Point3;
  /** Maya limestone walls share world courses; individual modeled stones never repeat wall joints. */
  mayaMasonryUv?: "block" | "course" | "wall";
  /** Retained civic shaft with the HQ's aged gilding, drawn with its own metal detail map. */
  mayaGildedColumn?: true;
  /** A load-bearing portico shaft; national recipes may retheme it without losing the column role. */
  civicPorticoColumn?: true;
  /** One visual-only recessed alpha-black window plane; never a closed box or physical wall. */
  windowShadow?: true;
  /** A real lamp pane (amber glass): warm emissive at night, its ordinary surface by day. */
  nightLamp?: true;
  /** Visual backing of an OPEN doorway, never a solid moving door leaf. */
  doorwayShadow?: true;
  windowShadowContour?: readonly (readonly [number, number])[];
  /** Original opening contract remains fixed when its visual shadow plane moves inside the reveal. */
  windowOpeningPosition?: Point3;
  windowOpeningSize?: Point3;
  windowShadowSite?: string;
  /** A new visual shadow must not invent a soldier slot on a previously ungarrisoned aperture. */
  windowShadowDecorative?: true;
  /** Explicit semantic window insert; unrelated dark doors/hearth mouths are never alpha windows. */
  windowOpening?: true;
  /** Actual rounded-wall window voids, independent of dark-pane presentation and garrison metadata. */
  persianWindows?: readonly import("./persian-window-profile").PersianWallWindow[];
  roofProfile?: "viking" | "japanese" | "japanese-pyramid";
  /** Japanese roofs: the tiled top (default), the soffit board underneath, or its rafters. */
  roofLayer?: "soffit" | "rafters";
  /** Real roof opening around a rising tower; the renderer clips the marked roof geometry. */
  roofOpening?: RoofOpening;
  /** Exposed structural roof support that can carry level additions, such as a ridge log. */
  roofSupport?: boolean;
  /** Full-footprint roof deck shown as timber during construction, then as the finished ceiling. */
  constructionDeck?: true;
  shape:
    | "indigenous-pigment"
    | "maya-headquarters-textile"
    | "indigenous-floor-hide"
    | "catapult-shell-band"
    | "catapult-national-shell"
    | "catapult-window-frame" | "catapult-window-reveal" | "catapult-window-glass"
    | "yagura-wall" | "yagura-window-frame"
    | "architectural-bamboo"
    | "forester-tree-sign"
    | "window-shadow"
    | "lookout-spyglass-sign"
    | "national-yard-sculpture"
    | "nation-roof"
    | "indigenous-palm-roof" | "indigenous-roof"
    | "persian-striped-awning"
    | "persian-room"
    | "lean-thatch-roof"
    | "occupation-roof"
    | "roof-infill"
    | "camp-dressing"
    | "pig-residents"
    | "pig-feeding-water"
    | "pig-feeding-grain"
    | "paint-ellipse"
    | "paint-triangle"
    | "indigenous-rubble-masonry"
    | "chinese-wall-fan"
    | "cloud-paint"
    | "paint-stroke"
    | "civic-hipped-roof"
    | "civic-statue"
    | "civic-column-shaft"
    | "dome"
    | "ogive-dome"
    | "persian-palmette-panel"
    | "persian-dome"
    | "persian-barrel"
    | "persian-barrel-end"
    | "persian-transition"
    | "box"
    | "cloth-panel"
    | "chinese-roof-bearing"
    | "cylinder"
    | "sphere"
    | "rock"
    | "structural-rock"
    | "catapult-rock" | "catapult-deck" | "catapult-scoop" | "iron-ingot"
    | "arch-spandrel"
    | "persian-arch-spandrel"
    | "persian-stucco-relief"
    | "maya-civic-mask"
    | "gable"
    | "tile"
    | "cone"
    | "cord"
    /** One continuous animal hide laced into a frame (stretched-hide-outline.ts), "hide" surface. */
    | "stretched-hide"
    | "ring"
    | "stone-arc"
    | "bevel-box"
    | "linen-bolt"
    | "anvil"
    | "workshop-stump"
    | "nursery-sapling"
    | "tea-bark"
    | "tea-leaves"
    | "berry-bark"
    | "berry-leaves"
    | "berry-fruit"
    | "harvested-tea-leaf"
    | "harvested-drink-berry"
    | "planting-soil"
    | "vat-liquid"
    | "pomegranate-bark"
    | "pomegranate-leaves"
    | "pomegranate-fruit"
    | "pomegranate-whole-fruit"
    | "cacao-bark"
    | "cacao-leaves"
    | "cacao-pods"
    | "open-sack"
    | "sack"
    | "fish"
    | "fish-tail"
    | "wheat-stalk"
    | "wheat-ear"
    | "stone-block"
    | "scythe-blade"
    | "axe-head"
    /** Viking ornaments: sculpts fitted to the part box (authoring boxes in viking-ornament-boxes.ts). */
    | "thor-statue"
    | "dragon-head"
    | "bearded-axe-head"
    | "double-axe-head"
    | "round-shield"
    | "viking-helmet"
    | "antler"
    | "feather-wing"
    | "longship-relief"
    | "rune-plinth"
    | "nubian-textile"
    | "nubian-vase"
    | "nubian-shield"
    | "nubian-skull"
    | "nubian-hat"
    /**
     * Japanese decorations (vertex-coloured): a ribbed paper lantern with black caps, a pleated
     * folding fan, a bamboo culm with nodes, a spray of bamboo leaves and a dragon coiled round a column.
     */
    | "paper-lantern"
    | "chinese-lantern"
    | "folding-fan"
    | "bamboo-culm"
    | "bamboo-leaves"
    | "dragon-coil"
    /** Turned vessels and produce (lathe profiles, drink-vessel-geometry.ts) in the unit box. */
    | DrinkVesselShape
    /** A grapevine's lobed leaf mass ("leaf" surface), vine-foliage-geometry.ts. */
    | "vine-foliage"
    /** Wall-following Roman Catapult ivy, with separately veined lobed leaves and rooted stems. */
    | "catapult-wall-ivy"
    /** A hanging grape bunch of shaded berries (stalk at +y), grape-bunch-geometry.ts. */
    | "grape-bunch"
    | "firebox-reveal";
  /** Which painted design of a decor shape (textile, jar, shield, skull, hat) the part shows. */
  decorVariant?: number;
  /** Linear upper-edge deformation for sloped masonry, in local asset coordinates. */
  topScale?: Point3;
  topOffset?: Point3;
  /** Inner radius in unit geometry for shaped masonry arches (default 0.38). */
  innerRadius?: number;
  /** Local unit-geometry half-spaces of a real arched fire chamber, preserving the outer oven shell. */
  fireboxCut?: readonly (readonly [number, number, number, number])[];
  /** Normalized spring height of the separate opaque refractory reveal. */
  fireboxSpring?: number;
  /** Occupational oven mouth; survives facade replacement along with its working furnace. */
  fireboxMouth?: true;
  /** Original furnace refractory reveal/back assembly, kept through national facade replacement. */
  fireboxInterior?: true;
  /** Clear pointed arch's width/rise as fractions of a Persian spandrel's full rectangle. */
  pointedArchOpening?: readonly [number, number];
  position: Point3;
  size: Point3;
  rotation?: Point3;
  surface: BuildingSurface;
  /**
   * Texture tiles per recipe unit, projected along each face (bricks, boards and shingles keep one
   * size whatever the box size). Unrotated parts share the recipe grid, so courses meet at corners.
   */
  worldUv?: number;
  tint?: Point3;
  /** An explicitly authored inventory display; permanent props are never tagged. */
  stock?: { ware: string; slot: number; kind?: "input" | "output"; wares?: readonly string[];
    handlingEdge?: "outward-x"; presentation?: "hanging" };
  /** Hunter rack rope, pinned at its top and weighted by this output slot. */
  windCordSlot?: number;
  /** Kept separate from static batches so the worker and tool share exact motion. */
  drinkTool?: import("../workers/worker-nation").BuildingFirstNation;
  /** A hanging decoration (lantern, cedar ball): on High it swings in the wind about this point. */
  swayPivot?: Point3;
  /** Nation decoration added on the finished building (lanterns, bamboo, fans, shrine details, trophies). */
  nationDecor?: boolean;
  /** Authored by a military tower recipe: each nation rebuilds these parts in its own tower form. */
  militaryTower?: boolean;
  stage: number;
}
export interface BuildingRecipe {
  /** Shared public-yard solids and real room/gate portals, in recipe coordinates. */
  navigation?: import("./building-navigation-types").BuildingNavigationMetadata;
  drinkNation?: import("../workers/worker-nation").BuildingFirstNation;
  /** Optional nation-authored location of the harbour beacon hearth. */
  harborBeacon?: Point3;
  /** Authoring translation shared by both LODs; already applied to all parts and anchors. */
  modelOriginOffset?: Point3;
  parts: BuildingPart[];
  door: Point3;
  doorProfile: "arched" | "flat";
  doorDimensions?: import("./roman-door-profile").RomanDoorDimensions;
  /** Real opposing-jamb entrance leaves; each may open independently from the actor frame. */
  doubleDoor?: boolean;
  balconyDoor?: RomanMilitaryAnchors["balconyDoor"];
  mechanism: Point3;
  workerExit: Point3;
  workPoint: Point3;
  flagAnchor?: Point3;
  /** Outlaw structures identify themselves through architecture and salvage, without flags. */
  hideFlag?: boolean;
  hideDoor?: boolean;
  /** Retain the service anchor while omitting a door leaf on an open upper platform. */
  hideBalconyDoor?: boolean;
  /** A retracting textile flap uses the established threshold and opening state. */
  tentDoor?: boolean;
  /** Explicit window contracts are metadata only: never rendered or used as physical geometry. */
  garrisonWindows?: readonly import("./military-window-slots").WindowGarrisonAnchor[];
  archerPositions?: Point3[];
}
const ROMAN_LAYOUTS: Record<
  number,
  { width?: number; depth?: number; height?: number; entryX?: number }
> = {
  1: { width: 1.8, depth: 1.3, height: 1.0 },
  17: { width: 1.64, depth: 1.15, height: 1.17 },
  22: { width: 1.14, depth: 1.1, height: 0.92 },
  33: { width: 1.92, depth: 1.1, height: 0.88 },
  2: { height: 1.42 },
  14: { width: 1.05 },
  18: { width: 1.4, depth: 1.62, height: 0.98, entryX: -0.35 },
  19: { width: 1.8, depth: 1.2, height: 1.08, entryX: 0.38 },
  20: { height: 1.16, entryX: -0.35 },
  21: { width: 1.9, height: 1.08, entryX: -0.52 },
  25: { entryX: -0.28 },
  26: { width: 1.72, height: 1.12 },
  31: { width: 1.16 * .9, depth: .85 * .9, height: 2.86 * .8 },
  32: { width: 1.9, height: 1.05, entryX: 0.28 },
  37: { width: 1.4 },
  // Provisional small producer shells (FLAX-P05 owns the final national models).
  60: { width: 1.1, depth: .8, height: .95 },
  61: { width: 1.5, depth: 1.1, height: 1.0 }
};
const ROMAN_STYLE_HEIGHTS: Partial<Record<BuildingDefinition["style"], number>> = {
  tower: 2.45,
  castle: 1.7,
  mill: 2.2
};

/** Roman vocabulary is shared by every occupation: terracotta, lime, dressed stone, porticoes. */
export const createRomanBuildingRecipe = (
  definition: BuildingDefinition,
  detailed = true,
  occupationRoofs = true
): BuildingRecipe => {
  if (definition.id === 16) return createCatapultTowerRecipe("roman", detailed);
  if (definition.id === MONUMENT_TYPE_ID) return monumentRecipe();
  const base = advancedMaterialBaseDefinition(definition);
  if (base !== definition)
    return withAdvancedMaterialStocks(createRomanBuildingRecipe(base, detailed, occupationRoofs), definition.id, detailed);
  const parts: BuildingPart[] = [];
  const part = (
    surface: BuildingSurface,
    position: Point3,
    size: Point3,
    stage = 2,
    shape: BuildingPart["shape"] = "box",
    rotation?: Point3,
    tint?: Point3,
    stock?: BuildingPart["stock"],
    windCordSlot?: number
  ) => {
    const soften =
      detailed &&
      shape === "box" &&
      stage === 3 &&
      ["wood", "iron", "steel"].includes(surface) &&
      Math.min(...size) >= 0.05;
    const added: BuildingPart = {
      position,
      rotation,
      shape: soften ? "bevel-box" : shape,
      size,
      stage,
      surface,
      tint,
      stock,
      windCordSlot
    };
    parts.push(added);
    return added;
  };
  const foundationWidth = definition.footprint * 0.82;
  const foundationDepth = definition.style === "mine" ? 1 : 0.6;
  const custom = ROMAN_REDESIGNED_LAYOUTS[definition.id] ?? ROMAN_LAYOUTS[definition.id];
  const redesigned = Boolean(ROMAN_REDESIGNED_LAYOUTS[definition.id]);
  let anchors: RomanMilitaryAnchors = {};
  const width = custom?.width ?? foundationWidth;
  const depth = custom?.depth ?? definition.footprint * 0.69;
  const height = custom?.height ?? ROMAN_STYLE_HEIGHTS[definition.style] ?? 0.98;
  const baseRoof = createRomanGableRoof(part, detailed);
  const architecture = <T>(author: () => T) => authorBuildingArchitecture(parts, author);
  const roof: typeof baseRoof = (...args) => architecture(() => baseRoof(...args));
  const doorDimensions = { ...DEFAULT_ROMAN_DOOR };
  if (usesStorageDoubleDoor(definition.id)) doorDimensions.width = STORAGE_DOUBLE_DOOR.width;
  const context: import("./roman-design-kit").RomanDesignContext = { part, parts, roof, detailed, doorDimensions };
  const column = (x: number, z: number, y = 0.18, h = 0.95) => {
    part("stone", [x, y + 0.045, z], [0.2, 0.09, 0.2], 2);
    part("stone", [x, y + h / 2, z], [0.12, h, 0.12], 2, "cylinder");
    part("stone", [x, y + h, z], [0.22, 0.09, 0.22], 2);
  };
  const front = depth / 2;
  const entryX = custom?.entryX ?? 0;
  const door: Point3 = [entryX - doorDimensions.width / 2, 0.18, front + 0.016];
  const mechanism: Point3 = [Math.max(width * 0.32, 0.66), 0.65, front + 0.26];
  if (definition.id === MILL_TYPE_ID) mechanism.splice(0, 3, 0, ROMAN_MILL_HUB_HEIGHT, (depth * 0.66) / 2 + 0.22);
  if (definition.id === 33) mechanism.splice(0, 3, width / 2 + 0.4, 0.8, -depth * 0.12 + 0.12);
  if (definition.id === 25) mechanism.splice(0, 3, width / 2 + 0.36, 0.58, 0.42);
  if (definition.id === 26) mechanism.splice(0, 3, width / 2 + 0.32, 0.55, -0.63);
  if (definition.id === 32) mechanism.splice(0, 3, width / 2 + 0.34, 0.49, -0.025);
  if (definition.id === 19) mechanism[0] = -width / 2 - 0.4;
  if (definition.style === "well") mechanism.splice(0, 3, 0, 1.04, -0.15);
  if (redesigned) {
    anchors = addRomanRedesignedBuilding(definition, context, mechanism);
  } else if (definition.style === "well") {
    architecture(() => addRomanWellStructure(part, roof, column, detailed, parts));
  } else if (definition.id === MILL_TYPE_ID) {
    // Nation mills rebuild the tower from this original: only the Roman finish has the window.
    architecture(() => addRomanMillStructure(part, parts, roof, width, depth, height, detailed, occupationRoofs));
  } else {
    architecture(() => addRomanDefaultStructure(definition, context, column, width, depth, height, entryX));
  }
  if (!redesigned) architecture(() => addRomanSilhouette(definition, part, roof, width, depth, height, detailed));
  const equipment = (group: string, author: () => void) => authorWorkyardAssembly(parts, group, author);
  if (!redesigned) equipment(`mechanism-${definition.id}`, () =>
    addMechanismSupports(definition, part, mechanism, front));
  if (definition.id === 2) anchors = architecture(() => addRomanGuardTower(context, width));
  equipment(`equipment-${definition.id}`, () => architecture(() =>
    addRomanSecondBatchDetails(definition.id, part, width, depth, height, detailed)));
  equipment(`production-${definition.id}`, () => addRomanThirdBatch(definition.id, part, width, depth, detailed));
  if (definition.id === 22) addHunterDetails(part, width, depth, detailed);
  if (definition.id === 18) addFisheryInterior(part, width, depth, detailed);
  equipment(`resource-${definition.id}`, () => addRomanResourceWorkshop(definition.id, part, width, depth, detailed));
  architecture(() => addRomanResourceFacade(definition.id, part, width, depth, height, detailed));
  if (definition.id === WOODCUTTER_TYPE_ID) {
    equipment("woodcutter", () => addCompactWoodcutterStock(part));
    addWoodcutterFantasyDetails(part, width, depth, height, detailed);
  }
  // Residences carry no occupation tablet; the Commander's Lodge has its own command plaque.
  if (![0, 4, 9, 57, 58, 59, 62].includes(definition.id)) {
    const signStart = parts.length;
    addRomanOccupationPainting(
      definition,
      part,
      width,
      definition.id === MILL_TYPE_ID ? depth * 0.66 : depth,
      redesigned ? Math.max(0.65, height - 0.2) : height,
      entryX,
      redesigned,
      detailed
    );
    for (const signPart of parts.slice(signStart)) signPart.occupationSign = true;
  }
  if (
    !redesigned &&
    detailed &&
    definition.id !== 22 &&
    !ROMAN_THIRD_BATCH_IDS.includes(definition.id)
  )
    addOccupationProps(definition, part, width, depth, parts, detailed);
  if (!detailed && [17, 33].includes(definition.id))
    addOccupationProps(
      {
        id: definition.id,
        props: definition.props.filter(
          (prop) =>
            (prop === "logs" && [17, 33].includes(definition.id)) ||
            (prop === "boards" && definition.id === 33)
        )
      },
      part,
      width,
      depth,
      parts,
      detailed
    );
  if (
    !redesigned &&
    !detailed &&
    ![1, 2, 14, 17, 18, 19, 20, 22, 33, 35, 62].includes(definition.id) &&
    !ROMAN_THIRD_BATCH_IDS.includes(definition.id)
  )
    part(
      "wood",
      [(entryX > 0 ? -1 : 1) * Math.max(width * 0.31, 0.5), 0.315, front + 0.18],
      [0.35, 0.27, 0.25],
      3
    );
  addMissingRomanProductionStocks(definition, parts, detailed);
  if (definition.id === 23) placeRomanBreweryInputs(parts);
  // Existing room slabs already fit each interior and stop short of its walls/door threshold.
  for (const floor of parts.filter(piece => piece.surface === "dark" && piece.stage === 0 &&
    piece.size[1] <= .04 && piece.size[0] > .4 && piece.size[2] > .4)) floor.surface = "mosaic";
  if (isFlaxWeaverBuilding(definition.id)) {
    const draft: BuildingRecipe = { doorProfile: "flat", door, doorDimensions: { ...DEFAULT_ROMAN_DOOR },
      mechanism, parts, workerExit: [entryX, 0, front + 0.95], workPoint: [width * 0.45, 0, front + 0.5] };
    const designed = createRomanFlaxWeaverRecipe(draft, definition, detailed);
    parts.length = 0;
    parts.push(...designed.parts);
  }
  architecture(() => addRomanMasonryRelief(context));
  if (detailed) architecture(() => addRomanRoofTiles(context));
  for (const buildingPart of parts) buildingPart.position[1] -= 0.18;
  door[1] -= 0.18;
  mechanism[1] -= 0.18;
  if (definition.id === 39) addRusticFootings(definition, part, width, depth, foundationDepth);
  if ([1, 2].includes(definition.id))
    anchors.flagAnchor = [
      0,
      height + 0.27 + (DMath.tan(0.54) * (width + (definition.id === 1 ? 0.27 : 0.33))) / 2 + 0.17,
      front - 0.04
    ];
  if (anchors.flagAnchor) anchors.flagAnchor[1] -= 0.18;
  for (const position of anchors.archerPositions ?? []) position[1] -= 0.18;
  if (anchors.balconyDoor) anchors.balconyDoor.position[1] -= 0.18;
  if (definition.id === 14) anchors.balconyDoor = {
    position: [-0.175, 1.785, door[2] - 0.051], width: 0.35, height: 0.5, yaw: 0
  };
  const recipe: BuildingRecipe = {
    ...anchors,
    doorProfile: ROMAN_ARCHED_DOOR_IDS.includes(definition.id) ? "arched" : "flat",
    door,
    doorDimensions,
    doubleDoor: usesStorageDoubleDoor(definition.id),
    mechanism,
    parts,
    workerExit: [entryX, 0, front + 0.95],
    workPoint: [width * 0.45, 0, front + 0.5]
  };
  fitRomanMillGrainStock(definition, recipe);
  fitRomanFlourStock(definition, recipe, detailed);
  fitRomanSawmillTimber(definition, recipe, detailed);
  fitRomanWoodcutterTimber(definition, recipe);
  // Preserve the authored house, doorway and connected roof proportions.
  // The withdrawn worker-fit pass stretched walls and separated attached roof assemblies.
  if ([2, 3, 8, 18, 21, 25, 26, 32, 33, 36].includes(definition.id)) {
    const offset = detailed ? romanStaticModelCenteringOffset(recipe)
      : createRomanBuildingRecipe(definition, true, false).modelOriginOffset!;
    translateRomanBuildingRecipe(recipe, offset);
  }
  addRomanFireboxCavity(recipe.parts, definition.id, detailed);
  if (occupationRoofs) {
    applyRomanOccupationRoofs(definition.id, recipe, detailed);
    applyRomanAlternativeRoof(definition.id, recipe, detailed);
    if (definition.id === 37) addRomanFarmVisualDetail(recipe, detailed);
    recipe.parts = withRomanMasonryTextureScale(recipe.parts);
  }
  const cleared = definition.id === HARBOUR_TYPE_ID
    ? { ...recipe, parts: withHarbourTowerRoofOpenings(recipe.parts) } : recipe;
  return definition.id === 33 ? withSawmillStockRecipes(cleared) : cleared;
};

const addRomanDefaultStructure = (
  definition: BuildingDefinition,
  { detailed, part, parts, roof }: import("./roman-design-kit").RomanDesignContext,
  column: (x: number, z: number, y?: number, h?: number) => void,
  width: number,
  depth: number,
  height: number,
  entryX: number
) => {
  const front = depth / 2;
  const tower = definition.style === "tower";
  const wallSurface: BuildingSurface = "stone";
  // Rear and side walls; real doorway opening at the front, with an interior floor.
  part(wallSurface, [0, height / 2 + 0.18, -front + 0.055], [width, height, 0.11], 1);
  for (const side of [-1, 1])
    part(wallSurface, [side * (width / 2 - 0.055), height / 2 + 0.18, 0], [0.11, height, depth], 1);
  const opening = 0.46;
  const openingTop = ROMAN_ARCHED_DOOR_IDS.includes(definition.id) ? 1.04 : 0.95;
  if (ROMAN_ARCHED_DOOR_IDS.includes(definition.id)) addRomanDoorSpandrels(part, entryX, front);
  for (const side of [-1, 1]) {
    const edge = entryX + (side * opening) / 2;
    const outer = (side * width) / 2;
    const sideWidth = Math.abs(outer - edge);
    if (definition.id === 18 && side === 1) {
      // The fishery has an open sorting bay, rather than another solid cottage facade.
      for (const x of [edge + 0.035, outer - 0.035])
        part("stone", [x, height / 2 + 0.18, front], [0.07, height, 0.11], 1);
      part("stone", [(edge + outer) / 2, height + 0.12, front], [sideWidth, 0.12, 0.11], 2);
      part("stone", [(edge + outer) / 2 + 0.075, 0.47, front], [sideWidth - 0.15, 0.1, 0.34], 3);
      for (const x of [edge + 0.08, outer - 0.08])
        part("stone", [x, 0.3, front], [0.06, 0.24, 0.24], 3);
    } else
      part(
        wallSurface,
        [(edge + outer) / 2, height / 2 + 0.18, front],
        [sideWidth, height, 0.11],
        1
      );
  }
  if (definition.id === 14) {
    // Upper doorway meets the balcony deck; the interior ladder reaches its landing.
    part("stone", [0, (openingTop + 1.965) / 2, front], [opening, 1.965 - openingTop, 0.11], 1);
    part(
      "stone",
      [0, (2.465 + height + 0.18) / 2, front],
      [opening, height + 0.18 - 2.465, 0.11],
      1
    );
    for (const side of [-1, 1]) part("stone", [side * 0.205, 2.215, front], [0.05, 0.5, 0.11], 1);
  } else
    part(
      wallSurface,
      [entryX, (height + 0.18 + openingTop) / 2, front],
      [opening, height + 0.18 - openingTop, 0.11],
      1
    );
  part("dark", [0, 0.19, 0], [width - 0.2, 0.025, depth - 0.2], 0);
  // A visible timber deck while the frame is open, then the finished stone ceiling: its bare
  // stone top otherwise reads as a cream stripe running along the top of every timber wall plate.
  parts.push({ constructionDeck: true, position: [0, height + 0.21, 0], shape: "box",
    size: [width + 0.05, 0.09, depth + 0.05], stage: 3, surface: "stone" });
  if ([17, 20, 21].includes(definition.id)) {
    const roofStart = parts.length;
    roof(0, height + 0.27, 0, depth + 0.32, width + 0.33);
    for (const p of parts.slice(roofStart)) {
      const [x, y, z] = p.position;
      p.position = [z, y, -x];
      // Mesh recipes apply X, then Y, then Z. Compose the parent yaw explicitly.
      const rz = p.rotation?.[2] ?? 0;
      p.rotation =
        rz === 0
          ? [p.rotation?.[0] ?? 0, Math.PI / 2, 0]
          : [
              (Math.sign(rz) * Math.PI) / 2,
              Math.PI / 2 - Math.abs(rz),
              (Math.sign(rz) * Math.PI) / 2
            ];
    }
  } else roof(0, height + 0.27, 0, width + (definition.id === 1 ? 0.27 : 0.33), depth + 0.32);
  if (detailed) addRomanWallDetails(definition, part, width, height, front, entryX);
  else if (MINIMAL_WINDOW_BUILDINGS.includes(definition.id)) addRomanSideWindows(definition, part, width, false);
  if (
    (definition.style === "hall" &&
      definition.id !== 33 &&
      !ROMAN_THIRD_BATCH_IDS.includes(definition.id)) ||
    definition.style === "castle"
  ) {
    for (const x of [-width * 0.4, width * 0.4]) column(x, front + 0.25);
    part("stone", [0, 1.19, front + 0.25], [width + 0.16, 0.13, 0.18], 2);
    roof(0, 1.23, front + 0.22, width + 0.2, 0.68);
  }
  if ((tower || definition.style === "castle") && definition.id !== 14) {
    const count = tower ? 4 : 7;
    for (let i = 0; i < count; i++)
      part(
        "stone",
        [-width / 2 + (i * width) / (count - 1), height + 0.38, -front],
        [0.17, 0.27, 0.2],
        3
      );
    if (definition.id !== 14) {
      part("wood", [width * 0.34, height + 0.72, 0], [0.035, 0.9, 0.035], 3);
      part("cloth", [width * 0.34 + 0.13, height + 0.85, 0], [0.24, 0.42, 0.024], 3);
      part("gold", [width * 0.34, height + 1.2, 0], [0.11, 0.16, 0.04], 3, "sphere");
    }
  }
  if (definition.style === "mine") {
    part("dark", [0, 0.55, -front + 0.01], [0.8, 0.7, 0.012], 1, "window-shadow");
    for (const x of [-0.38, 0.38]) part("wood", [x, 0.5, -front], [0.12, 0.72, 0.15], 2);
    for (const x of [-0.2, 0.2]) part("iron", [x, 0.2, -0.2], [0.025, 0.025, depth], 2);
  }
  if (
    ["forge", "smelt", "bake", "brew", "burn", "mint"].includes(definition.task) &&
    !ROMAN_THIRD_BATCH_IDS.includes(definition.id)
  ) {
    part("stone", [-width * 0.27, height + 0.35, -depth * 0.2], [0.24, 0.86, 0.25], 3);
    part("dark", [-width * 0.27, height + 0.79, -depth * 0.2], [0.16, 0.02, 0.17], 3, "window-shadow");
  }
};

const addRomanWellStructure = (
  part: AddPart,
  roof: ReturnType<typeof createRomanGableRoof>,
  column: (x: number, z: number, y: number, height: number) => void,
  detailed: boolean,
  parts: BuildingPart[]
) => {
  // A lengthwise, open granite shaft under a light canopy of real rough trunks.
  const centre = -0.15;
  for (let row = 0; row < (detailed ? 4 : 3); row++)
    for (let block = 0; block < 12; block++)
      part(
        "stone",
        [0, 0.17 + (row + 0.5) * (0.5 / (detailed ? 4 : 3)), centre],
        [0.76, 0.5 / (detailed ? 4 : 3) - 0.003, 0.76],
        1,
        "stone-arc",
        [0, ((block + (row % 2) * 0.5) * Math.PI) / 6, 0]
      );
  parts.push(createOpeningShadowDisk({ surface: "dark", position: [0, .205, centre],
    size: [.58, .018, .58], stage: 1, shape: "cylinder" }, detailed));
  for (const z of [-0.45, 0.45]) {
    part("bark", [0, 0.795, centre + z], [0.11, 1.23, 0.11], 2, "cylinder");
    parts.push({ position: [0, 1.39, centre + z], roofSupport: true, shape: "box", size: [0.92, 0.07, 0.1],
      stage: 2, surface: "wood" });
  }
  for (let i = 0; i < (detailed ? 9 : 7); i++) {
    const x = -0.4 + i * (0.8 / (detailed ? 8 : 6));
    part(
      "bark",
      [x, 1.46, centre],
      [detailed ? 0.115 : 0.14, 1.05, detailed ? 0.115 : 0.14],
      4,
      "cylinder",
      [Math.PI / 2, 0, 0]
    );
    if (detailed)
      for (const side of [-1, 1])
        part("endgrain", [x, 1.46, centre + side * 0.528], [0.108, 0.008, 0.108], 4, "cylinder", [
          Math.PI / 2,
          0,
          0
        ]);
  }
  part("wood", [0, 1.04, centre], [0.08, 0.055, 0.9], 2);
};

const addRomanWallDetails = (
  definition: BuildingDefinition,
  part: AddPart,
  width: number,
  height: number,
  front: number,
  entryX: number
) => {
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) {
    part("stone", [x, height / 2 + 0.18, front + 0.035], [0.065, height, 0.045], 2);
  }
  if (definition.id !== 18 && definition.id !== 19) {
    // Arched voussoirs over the door and stone jambs.
    for (const x of [-0.27, 0.27])
      part("stone", [x + entryX, 0.51, front + 0.08], [0.075, 0.65, 0.11], 2);
    for (let index = 0; index < 9; index++) {
      const angle = (index * Math.PI) / 8;
      part(
        "stone",
        [entryX + DMath.cos(angle) * 0.27, 0.81 + DMath.sin(angle) * 0.27, front + 0.08],
        [0.095, 0.09, 0.11],
        2,
        "box",
        [0, 0, angle - Math.PI / 2]
      );
    }
  } else {
    for (const side of [-1, 1])
      part("stone", [entryX + side * 0.27, 0.57, front + 0.07], [0.08, 0.78, 0.12], 2);
    part("stone", [entryX, 0.98, front + 0.07], [0.63, 0.1, 0.12], 2);
  }
  addRomanSideWindows(definition, part, width, true);
};

/** Garrisoned soldiers look out of these; Minimal keeps the plain openings on military halls. */
const MINIMAL_WINDOW_BUILDINGS: readonly number[] = [1, 2];
/** The guardhouse's tower doorway takes the middle of its right wall: that window moves behind it. */
const GUARDHOUSE_TOWER_SIDE_WINDOW_Z = -0.36;
const addRomanSideWindows = (
  definition: Pick<BuildingDefinition, "id">,
  part: AddPart,
  width: number,
  jambs: boolean
) => {
  for (const side of [-1, 1]) {
    // The bakery oven occupies the right wall; keep that masonry solid.
    if (definition.id === 32 && side === 1) continue;
    const centre = definition.id === 2 && side === 1 ? GUARDHOUSE_TOWER_SIDE_WINDOW_Z : 0;
    part("dark", [side * (width / 2 + 0.004), 0.78, centre], [0.018, 0.3, 0.23], 2, "window-shadow");
    if (!jambs) continue;
    for (const z of [-0.13, 0.13])
      part("stone", [side * (width / 2 + 0.025), 0.78, centre + z], [0.045, 0.37, 0.045], 2);
  }
};

const addOccupationProps = (
  definition: Pick<BuildingDefinition, "id" | "props">,
  part: AddPart,
  width: number,
  depth: number,
  parts: BuildingPart[],
  detailed: boolean
) => {
  definition.props.forEach((prop, index) => {
    let x =
      definition.id === 19 && prop === "cart"
        ? width / 2 + 0.42
        : (index === 0 ? -1 : 1) * Math.max(width * 0.34, 0.7);
    const fishBarrels = definition.id === 18 && prop === "barrels";
    if (fishBarrels) x = width / 2 + .26;
    const z = fishBarrels ? -.55 : depth / 2 + 0.27;
    // Generic hanging cloth was repeated across unrelated occupations and national façades.
    // Purposeful national art and animated ownership flags are authored in their own helpers.
    if (prop === "banner") return;
    if (definition.id === 35 && prop === "buckets") return;
    if (definition.id === WOODCUTTER_TYPE_ID && ["logs", "stump"].includes(prop)) return;
    if (["barrels", "vats", "buckets", "grain"].includes(prop)) {
      for (let i = 0; i < 2; i++) {
        const barrelX = fishBarrels ? x : x + i * .19;
        const barrelZ = fishBarrels ? z + i * .2 : z;
        part("wood", [barrelX, 0.35, barrelZ], [0.19, 0.34, 0.19], 3, "cylinder");
        for (const y of [0.24, 0.44])
          part("iron", [barrelX, y, barrelZ], [0.2, 0.023, 0.2], 3, "cylinder");
      }
      return;
    }
    if (prop === "logs") {
      for (let i = 0; i < (definition.id === WOODCUTTER_TYPE_ID ? 6 : 5); i++) {
        const outputPart = [17, 33].includes(definition.id)
          ? withBuildingStock(part, "logs", i, definition.id === 33 ? "input" : "output") : part;
        const y = 0.25 + Math.floor(i / 3) * 0.13,
          offset = z + ((i % 3) - 1) * 0.13;
        outputPart("bark", [x, y, offset], [0.14, 0.6, 0.14], 3, "cylinder", [0, 0, Math.PI / 2]);
        for (const side of [-1, 1])
          outputPart(
            "endgrain",
            [x + side * 0.302, y, offset],
            [0.13, 0.005, 0.13],
            3,
            "cylinder",
            [0, 0, Math.PI / 2]
          );
      }
      return;
    }
    if (prop === "stump") {
      part("bark", [x, 0.33, z], [0.26, 0.3, 0.26], 3, "cylinder");
      part("endgrain", [x, 0.485, z], [0.25, 0.015, 0.25], 3, "cylinder");
      addStumpAxe(part, x, z);
      return;
    }
    if (prop === "boat") {
      part("wood", [x, 0.225, z], [0.7, 0.09, 0.32], 3);
      for (const side of [-1, 1]) part("wood", [x, 0.35, z + side * 0.145], [0.7, 0.21, 0.03], 3);
      for (const side of [-1, 1]) part("wood", [x + side * 0.335, 0.35, z], [0.03, 0.21, 0.28], 3);
      return;
    }
    if (prop === "boards") {
      if (definition.id === 33) {
        for (let i = 0; i < 6; i++)
          addTimberPlanks(withBuildingStock(part, "planks", i), {
            position: [x, 0.21 + i * 0.065, z + .12], length: 0.64, width: 0.14,
            thickness: 0.0216666667, yaw: Math.PI / 2, tied: false, detailed: false
          });
        return;
      }
      for (let i = 0; i < (definition.id === 33 ? 6 : 5); i++)
        (definition.id === 33 ? withBuildingStock(part, "planks", i) : part)(
          "wood",
          [x, 0.21 + i * 0.065, z],
          definition.id === 33 ? [0.64, 0.06, 0.14] : [0.46, 0.06, 0.09],
          3,
          "box"
        );
      return;
    }
    if (["saplings", "vines"].includes(prop)) {
      if (definition.id === 20) return; // The compact nursery shelf already holds six complete seedlings.
      for (let i = 0; i < 4; i++) {
        const seedX = definition.id === 20 ? width / 2 + 0.18 : x + i * 0.13;
        const seedZ = definition.id === 20 ? -depth * 0.28 + i * 0.13 : z;
        if (definition.id === 20) addRomanSeedling(part, seedX, 0.27, seedZ, true);
        else {
          part("wood", [x + i * 0.13, 0.32, z], [0.016, 0.28, 0.016], 3);
          part("leaf", [x + i * 0.13, 0.45, z], [0.11, 0.19, 0.1], 3, "sphere");
        }
        part("roof", [seedX, 0.225, seedZ], [0.095, 0.09, 0.095], 3, "cylinder");
      }
      return;
    }
    if (prop === "weapons") {
      parts.push(...createDecorativeWeaponRack("roman", definition.id, [x, 0, z], detailed));
      return;
    }
    if (prop === "tools") {
      part("wood", [x, 0.61, z], [0.45, 0.025, 0.09], 3);
      for (const side of [-1, 1]) part("wood", [x + side * 0.2, 0.44, z], [0.035, 0.52, 0.045], 3);
      for (let i = 0; i < 3; i++) {
        const offset = x - 0.16 + i * 0.14;
        part("wood", [offset, 0.47, z], [0.018, 0.47, 0.018], 3);
        part("iron", [offset, 0.68, z], [0.09, 0.13, 0.017], 3);
      }
      return;
    }
    if (prop === "net" && definition.id === 18) return;
    if (prop === "rack" && definition.id === 20) {
      part("wood", [x, 0.48, z], [0.025, 0.6, 0.025], 3);
      part("iron", [x, 0.25, z], [0.12, 0.14, 0.025], 3);
      return;
    }
    if (["hides", "net", "rack", "pen"].includes(prop)) {
      for (const side of [-1, 1]) part("wood", [x + side * 0.21, 0.51, z], [0.035, 0.66, 0.035], 3);
      part("wood", [x, 0.8, z], [0.48, 0.035, 0.035], 3);
      part("wood", [x, 0.735, z], [0.45, 0.025, 0.03], 3);
      part("cloth", [x, 0.56, z], [0.3, 0.35, 0.025], 3);
      return;
    }
    let surface: BuildingSurface = "stone";
    if (prop === "coal") surface = "dark";
    if (prop === "gold") surface = "gold";
    if (prop === "crates" || prop === "cart" || prop === "stump") surface = "wood";
    for (let i = 0; i < 3; i++)
      part(surface, [x + i * 0.12, 0.25 + i * 0.035, z], [0.17, 0.15, 0.19], 3);
  });
};

/** Occupational silhouettes stay readable even at the distant LOD. */
const addRomanSilhouette = (
  definition: BuildingDefinition,
  part: AddPart,
  roof: (x: number, y: number, z: number, w: number, d: number) => void,
  width: number,
  depth: number,
  height: number,
  detailed: boolean
) => {
  if (definition.id === 37) {
    const siloX = definition.footprint * 0.36;
    part("stone", [siloX, 0.23, -depth * 0.16], [0.72, 0.11, 0.72], 0, "cylinder");
    part("stone", [siloX, 0.99, -depth * 0.16], [0.61, 1.43, 0.61], 1, "cylinder");
    part("roof", [siloX, 1.9, -depth * 0.16], [0.78, 0.39, 0.78], 4, "cone");
    for (const y of [0.35, 1.55])
      part("stone", [siloX, y, -depth * 0.16], [0.65, 0.065, 0.65], 2, "cylinder");
    part("wood", [siloX, 0.54, -depth * 0.16 + 0.31], [0.18, 0.42, 0.023], 3);
    if (detailed)
      for (const side of [-1, 1])
        part(
          "wood",
          [siloX + 0.1 + side * 0.075, 0.83, -depth * 0.16 + 0.31],
          [0.025, 1.3, 0.025],
          3
        );
    if (detailed)
      for (let i = 0; i < 7; i++)
        part("wood", [siloX + 0.1, 0.36 + i * 0.17, -depth * 0.16 + 0.31], [0.15, 0.018, 0.028], 3);
    return;
  }
  if (definition.style === "castle") {
    for (const x of [-width * 0.46, width * 0.46]) {
      part("stone", [x, 1.47, -depth * 0.28], [0.55, 2.58, 0.55], 1, "cylinder");
      part("stone", [x, 2.81, -depth * 0.28], [0.66, 0.14, 0.66], 3, "cylinder");
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        part(
          "stone",
          [x + DMath.cos(angle) * 0.25, 2.98, -depth * 0.28 + DMath.sin(angle) * 0.25],
          [0.13, 0.2, 0.13],
          3
        );
      }
    }
    return;
  }
  if (definition.style === "mill") {
    return;
  }
  if (definition.id === WOODCUTTER_TYPE_ID || definition.id === 22) return;
  if (definition.id === 36 || definition.id === 39) {
    part("wood", [width / 2 + 0.38, 0.23, depth / 2 + 0.32], [0.65, 0.12, 0.5], 0);
  }
  if (definition.id === 28 || definition.id === 5) {
    roof(width * 0.25, 1.22, -depth * 0.25, width * 0.57, depth * 0.95);
    if (detailed)
      for (let i = 0; i < 5; i++)
        part("wood", [-width / 2 - 0.55 + i * 0.1, 0.43, depth / 2 + 0.33], [0.04, 0.52, 0.04], 2);
  }
};

/** A parked axe remains physically joined at the eye and embedded in the chopping block. */
const addStumpAxe = (part: AddPart, x: number, z: number) => {
  // The cutting edge bites into the endgrain; the handle rises back from the head's eye.
  const angle = Math.PI / 3;
  const eyeX = x + 0.02 + 0.06 * DMath.cos(angle);
  const eyeY = 0.545 + 0.06 * DMath.sin(angle);
  part("wood", [eyeX - 0.18 * DMath.sin(angle), eyeY + 0.18 * DMath.cos(angle), z],
    [0.026, 0.36, 0.026], 3, "cord", [0, 0, angle]);
  part("steel", [x + 0.02, 0.545, z], [0.18, 0.14, 0.03],
    3, "axe-head", [0, 0, -2 * Math.PI / 3]);
};

/** Six full-size logs stack in the front-left bay, clear of the central door and axe block. */
const addCompactWoodcutterStock = (part: AddPart) => {
  for (let i = 0; i < 6; i++) {
    const output = withBuildingStock(part, "logs", i);
    const x = -0.705,
      z = i % 2 ? 0.93 : 0.74,
      y = 0.25 + Math.floor(i / 2) * 0.14;
    output("bark", [x, y, z], [0.14, 0.76, 0.14], 3, "cylinder", [0, 0, Math.PI / 2]);
    for (const side of [-1, 1])
      output("endgrain", [x + side * 0.383, y, z], [0.13, 0.005, 0.13], 3, "cylinder", [
        0,
        0,
        Math.PI / 2
      ]);
  }
  const x = 0.76,
    z = 0.88;
  part("bark", [x, 0.33, z], [0.25, 0.3, 0.25], 3, "cylinder");
  part("endgrain", [x, 0.485, z], [0.24, 0.015, 0.24], 3, "cylinder");
  addStumpAxe(part, x, z);
};

/** Roman oak-guild workshop: practical architecture with restrained mythic craft ornament. */
const addWoodcutterFantasyDetails = (
  part: AddPart,
  width: number,
  depth: number,
  height: number,
  detailed: boolean
) => {
  const front = depth / 2 + 0.14;
  if (!detailed) return;
  const lampX = width / 2 - 0.06;
  part("iron", [lampX, 0.91, front], [0.045, 0.055, 0.21], 3);
  part("iron", [lampX, 0.88, front + 0.11], [0.016, 0.09, 0.016], 3);
  const lamp = part("amber", [lampX, 0.77, front + 0.11], [0.07, 0.11, 0.07], 3, "sphere") as
    BuildingPart | undefined;
  if (lamp) lamp.nightLamp = true;
  for (const y of [0.69, 0.85]) part("iron", [lampX, y, front + 0.11], [0.12, 0.026, 0.12], 3);
  for (const side of [-1, 1])
    part("iron", [lampX + side * 0.046, 0.77, front + 0.11], [0.014, 0.16, 0.014], 3);
};

const addMechanismSupports = (
  definition: BuildingDefinition,
  part: AddPart,
  mechanism: Point3,
  _front: number
) => {
  const [x, y, z] = mechanism;
  if (definition.mechanism === "wheel" && definition.style !== "well") {
    let hubY = y,
      hubX = x,
      hubZ = z;
    if (definition.style === "mill") {
      hubX = 0;
      hubY = y;
      hubZ = z;
    }
    part("iron", [hubX, hubY, hubZ - 0.15], [0.055, 0.4, 0.055], 2, "cylinder", [
      Math.PI / 2,
      0,
      0
    ]);
    return;
  }
  if ([25, 26].includes(definition.id)) return;
  if (!["hammer", "press", "pump", "saw"].includes(definition.mechanism)) return;
  part("wood", [x, 0.38, z], [0.4, 0.4, 0.31], 2);
  for (const side of [-1, 1]) part("wood", [x + side * 0.18, 0.73, z], [0.045, 1.1, 0.045], 2);
  part("wood", [x, 1.28, z], [0.43, 0.05, 0.065], 2);
  for (const side of [-1, 1]) part("iron", [x + side * 0.16, 0.64, z], [0.038, 0.05, 0.14], 2);
};

/** Narrow, mostly buried wall footings; outdoor work happens on the natural terrain. */
/** Shore support piers are the sole foundation exception; village walls meet natural terrain. */
const addRusticFootings = (
  _definition: BuildingDefinition,
  part: AddPart,
  _width: number,
  _depth: number,
  buriedDepth: number
) => {
  const height = buriedDepth + 0.04,
    y = (0.04 - buriedDepth) / 2;
  for (const x of [-1.04, -0.4, 0.44, 1.48])
    for (const z of [-0.36, 0.32]) part("stone", [x, y, z], [0.12, height, 0.12], 0, "cylinder");
};
