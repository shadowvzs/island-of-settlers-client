import {
  AnimationClip,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InterpolateDiscrete,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  QuaternionKeyframeTrack,
  SphereGeometry,
  Vector3,
  VectorKeyframeTrack} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import foresterTreeImage from "../../../../assets/editor-icons/tree-oak@2x.webp";
import type {
  BuildingDefinition,
  BuildingFrame
} from "../../../render-common/buildings/building-catalog";
import {
  type BuildingPart,
  type BuildingRecipe,
  type BuildingSurface,
  createRomanBuildingRecipe,
  type Point3
} from "../../../render-common/buildings/building-recipe";
import { withBuildingWindowShadows } from "../../../render-common/buildings/building-window-shadows";
import { getRomanBuildingWorldSizing } from "../../../render-common/buildings/building-world-sizing";
import { isCanonicalRomanWareStock } from "../../../render-common/buildings/roman-ware-stock";
import { WELL_CYCLE_SECONDS } from "../../../render-common/buildings/well-work-cycle";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { CATAPULT_HOME_YAW } from "../../../shared/settlement/catapult-cycle";
import { catapultRackCount } from "../../../shared/settlement/military-catapult-ammo";
import { createAdventureCampDecoration } from "../settlement/adventure-camp-model";
import { createIronIngotGeometry } from "../settlement/iron-ingot-geometry";
import { createIronIngotMaterial } from "../settlement/iron-ingot-material";
import { dressVikingShieldMaterial } from "../viking-round-shield";
import { createArchitecturalBamboo } from "./architectural-bamboo-geometry";
import { buildingSolidBoxes, removeHiddenBuildingTriangles } from "./building-hidden-triangles";
import { createBuildingImageSignMaterial } from "./building-image-sign-material";
import { applyBuildingInteriorShade } from "./building-interior-shade";
import { hasBuildingMaterialOwnership, ownBuildingMaterial } from "./building-material-ownership";
import { isDynamicBuildingGeometry } from "./building-runtime-props";
import { markStaticBatchMesh } from "./building-static-batch-geometry";
import { applyAshlarBlockUv, applyBuildingWorldUv } from "./building-world-uv";
import { createCacaoTreeGeometry } from "./cacao-tree-geometry";
import { tintCatapultObject } from "./catapult-ammo-material";
import { prepareCatapultMesh, updateCatapultMesh } from "./catapult-building-pose";
import { createCatapultDeckGeometry } from "./catapult-deck-geometry";
import { createCatapultGroundStock } from "./catapult-ground-stock";
import { createCatapultIvyGeometry } from "./catapult-ivy-geometry";
import { createCatapultIvyMaterial } from "./catapult-ivy-material";
import { createCatapultNationalShell } from "./catapult-national-shell-geometry";
import { applyCatapultOrnamentCurve } from "./catapult-ornament-curve";
import { createCatapultRockGeometry, createCatapultRockMaterial, disposeCatapultRockMaterial } from "./catapult-rock-geometry";
import { attachCatapultRoofBundles, presentCatapultShot } from "./catapult-roof-bundles";
import { clipCatapultRubbleOpenings } from "./catapult-rubble-opening-clip";
import { createCatapultScoopGeometry } from "./catapult-scoop-geometry";
import { applyCatapultAxeMetalUv, createCatapultAxeMetalMaterial, isCatapultEntryAxe } from "./catapult-viking-axe-metal";
import { createCatapultWindowFrame, createCatapultWindowGlass, createCatapultWindowGlassMaterial,
  createCatapultWindowReveal } from "./catapult-window-geometry";
import { createChineseLanternGeometry } from "./chinese-lantern-geometry";
import { createChineseRoofBearingGeometry } from "./chinese-roof-bearing-geometry";
import { createChineseWallFanGeometry, createChineseWallFanMaterial } from "./chinese-wall-fan";
import { createClothPanelGeometry } from "./cloth-panel-geometry";
import { createDrinkVesselGeometry, isDrinkVesselShape } from "./drink-vessel-geometry";
import { createExpansionDrinkTools } from "./expansion-drink-tools";
import { createFireboxRevealGeometry, cutFireboxCavityGeometry } from "./firebox-cavity-geometry";
import { omitBuriedBoxFaces } from "./geometry-buried-box-faces";
import { compactPrimitiveCaps } from "./geometry-compact-caps";
import { removeEmptyTriangles } from "./geometry-empty-triangles";
import { omitGroundBottom } from "./geometry-ground-bottom";
import { createGrapeBunchGeometry } from "./grape-bunch-geometry";
import { getSwayMaterial, setSwayPivot, updateHangingDecorSway } from "./hanging-decor-sway";
import { createIndigenousFloorHideGeometry } from "./indigenous-floor-hide-geometry";
import { createIndigenousFloorHideMaterial } from "./indigenous-floor-hide-material";
import { createIndigenousPalmRoofGeometry } from "./indigenous-palm-roof-geometry";
import { createIndigenousPigmentGeometry,createIndigenousPigmentMaterial } from "./indigenous-pigment-overlay";
import { createIndigenousQuarryStoneMaterial } from "./indigenous-quarry-stone-material";
import { createIndigenousRoofGeometry } from "./indigenous-roof-geometry";
import { createIndigenousRubbleMasonry, seatIndigenousMasonryOutsideCavity } from "./indigenous-rubble-masonry";
import { createIndigenousRubbleMaterial } from "./indigenous-rubble-material";
import { softenIndigenousRubbleNormals } from "./indigenous-rubble-normals";
import { createIndigenousWorkshopStoneGeometry } from "./indigenous-workshop-stone-geometry";
import { keepInteriorFloorFaces } from "./interior-floor-faces";
import {
  createBambooCulmGeometry, createBambooLeavesGeometry, createFoldingFanGeometry, createPaperLanternGeometry
} from "./japanese-decor-geometry";
import { createDragonCoilGeometry } from "./japanese-dragon-geometry";
import { createDragonLacquer } from "./japanese-dragon-texture";
import { createLeanThatchRoof } from "./lean-thatch-roof";
import { createLinenBoltGeometry } from "./linen-bolt-geometry";
import { createLookoutSpyglassMaterial } from "./lookout-spyglass-material";
import { createMayaCivicMaskGeometry } from "./maya-civic-mask-geometry";
import { createMayaHeadquartersTextileMaterial } from "./maya-headquarters-textile-material";
import { applyMayaMasonryUv } from "./maya-masonry-uv";
import { createMayaGildedColumnMaterial, createMayaYardFigurineMaterial } from "./maya-yard-detail-materials";
import { createNationOgiveDome } from "./nation-ogive-dome";
import { createNationRoofGeometry } from "./nation-roof-geometry";
import { createNationalMillMechanism } from "./national-mill-mechanism";
import { createNationalYardSculptureGeometry } from "./national-yard-sculpture";
import { createNubianDecorGeometry } from "./nubian-decor-geometry";
import { createPersianArchSpandrel } from "./persian-arch-spandrel";
import { createPersianAwningMaterial } from "./persian-awning-material";
import { createPersianPalmettePanelGeometry } from "./persian-palmette-panel-geometry";
import { applyPersianRoofUv } from "./persian-roof-uv";
import { createPersianRoomGeometry } from "./persian-room-geometry";
import { createPersianStripedAwningGeometry } from "./persian-striped-awning-geometry";
import { createPersianStuccoReliefGeometry } from "./persian-stucco-relief-geometry";
import { createPersianBarrel, createPersianBarrelEnd, createPersianDome, createPersianTransition } from "./persian-vault";
import { createPomegranateGeometry } from "./pomegranate-geometry";
import { createRomanAnvilGeometry } from "./roman-anvil";
import { createRomanBevelledBox } from "./roman-bevelled-box";
import { createRomanCivicColumn } from "./roman-civic-column";
import { createRomanCivicRoof } from "./roman-civic-roof";
import { createRomanCivicPaint, createRomanCivicStatue } from "./roman-civic-statue";
import { prepareRomanConstructionMesh, romanConstructionStage,romanConstructionTracks, updateRomanConstruction } from "./roman-construction";
import { createRomanCupola } from "./roman-cupola";
import { createRomanDoorSpandrel, createRomanGroundDoor, createWoodenDoorPanel } from "./roman-door";
import { createRomanEntranceAnimation } from "./roman-entrance-animation";
import { createRomanFish } from "./roman-fish";
import { createRomanFishTail } from "./roman-fish-tail";
import { createRomanFurnaceEffects } from "./roman-furnace-effects";
import { getRomanGridPlacement } from "./roman-grid-placement";
import { createRomanHarborBeacon } from "./roman-harbor-beacon";
import { createHollowRingGeometry } from "./roman-hollow-ring";
import { createRomanHunterCordWind } from "./roman-hunter-cords";
import {
  createIndustryMechanism,
  industryTracks,
  updateIndustry
} from "./roman-industry-mechanisms";
import { createRomanMineLight } from "./roman-mine-light";
import { clipRoofTowerOpening } from "./roof-opening-clip";
import { createRomanOccupationRoof, createRoofEndInfill } from "./roman-occupation-roof";
import {createRomanPigResidents} from "./roman-pig-residents";
import { createRomanPlayerFlag } from "./roman-player-flag";
import { createRomanRoofTile } from "./roman-roof-tile";
import { createRomanToolHead } from "./roman-shaped-tools";
import { createRomanBucketWater, createRomanStockBucket } from "./roman-stock-bucket";
import { createRomanOpenStockSack, createRomanStockSack } from "./roman-stock-sack";
import { createStretchedHideGeometry } from "./roman-stretched-hide";
import { createRomanTimberLog } from "./roman-timber-log";
import { createRomanWareStockModels } from "./roman-ware-stock-models";
import { createRomanWellMechanism } from "./roman-well-mechanism";
import { createRomanWheatEar } from "./roman-wheat-ear";
import { createStorageDoubleDoor, updateStorageDoubleDoor } from "./storage-double-door";
import { createStructuralRockGeometry } from "./structural-rock-geometry";
import { createTanningLiquidGeometry } from "./tanning-liquid";
import { createPlantingSoilGeometry, createTeaBerryGeometry } from "./tea-berry-geometry";
import { createTentDoor, updateTentDoor } from "./tent-door";
import { createVikingFeathers, createVikingHelmetIron } from "./viking-helmet-textures";
import { createVikingOrnamentGeometry, isVikingOrnamentShape } from "./viking-ornaments";
import { createRunePlinthStone, createThorBronze } from "./viking-statue-textures";
import { createVineFoliageGeometry } from "./vine-foliage-geometry";
import { createWindowShadowGeometry } from "./window-shadow-geometry";
import { windowShadowMaterial } from "./window-shadow-material";
import { createWorkshopPropGeometry } from "./workshop-prop-geometry";
import { createYaguraWallGeometry,createYaguraWindowFrame } from "./yagura-wall-geometry";

const getSphereHeightSegments = (radialSegments: number | undefined, fine: boolean) => {
  if (radialSegments) return Math.max(2, Math.ceil(radialSegments * .75));
  return fine ? 8 : 4;
};

/** Parts whose texture wraps round their sides (cylinder-geometry UVs). */
const ROUND_SHAPES = new Set<BuildingPart["shape"]>(["cylinder", "cone"]);
/**
 * Shapes drawn with their own material (one owned material per building): the worn polychrome
 * Caesar, the bronze Thor with its chainmail/knotwork relief and his rune-carved plinth, the hammered
 * iron Viking wall helmets and their feathered wings, and the stained-plank Viking round shield.
 */
const OWNED_MATERIAL_SHAPES: Partial<Record<BuildingPart["shape"],
  (source: MeshStandardMaterial, detailed: boolean) => MeshStandardMaterial>> = {
  "persian-striped-awning": createPersianAwningMaterial,
  "maya-headquarters-textile":(_source,detailed)=>createMayaHeadquartersTextileMaterial(detailed),
  "indigenous-floor-hide":(_source,detailed)=>createIndigenousFloorHideMaterial(detailed),
  "indigenous-rubble-masonry":(_source,detailed)=>createIndigenousRubbleMaterial(detailed),
  "chinese-wall-fan":()=>createChineseWallFanMaterial(),
  "catapult-window-glass":()=>createCatapultWindowGlassMaterial(),
  "indigenous-pigment":()=>createIndigenousPigmentMaterial(),
  "forester-tree-sign": () => createBuildingImageSignMaterial(foresterTreeImage),
  "lookout-spyglass-sign": () => createLookoutSpyglassMaterial(),
  "cloud-paint": source => {
    const material = source.clone();
    material.map = null; material.normalMap = null; material.roughnessMap = null;
    material.roughness = .94; material.metalness = 0;
    return material;
  },
  "persian-palmette-panel": source => {
    const material = source.clone();
    material.map = null; material.normalMap = null; material.roughnessMap = null;
    material.color.setHex(0xffffff); material.roughness = .94; material.metalness = 0;
    return material;
  },
  "maya-civic-mask": source => {
    const material = source.clone();
    material.roughness = .72; material.metalness = .32;
    return material;
  },
  "iron-ingot": source => createIronIngotMaterial(source),
  "catapult-rock": (_source, detailed) => createCatapultRockMaterial(detailed),
  "structural-rock": (_source, detailed) => createCatapultRockMaterial(detailed),
  "civic-statue": createRomanCivicPaint, "dragon-coil": createDragonLacquer, "feather-wing": createVikingFeathers,
  "rune-plinth": createRunePlinthStone,
  "round-shield": (source, detailed) => dressVikingShieldMaterial(source.clone(), detailed),
  "catapult-wall-ivy": createCatapultIvyMaterial,
  "thor-statue": createThorBronze, "viking-helmet": createVikingHelmetIron
};

const isMayaGildedColumn = (part: BuildingPart) => part.mayaGildedColumn === true;
const isMayaYardFigurine = (part: BuildingPart) =>
  part.shape === "national-yard-sculpture" && part.decorVariant === 1;

const ownedPartMaterial = (part: BuildingPart) => {
  if (part.indigenousMasonryStone) return createIndigenousQuarryStoneMaterial;
  if (isCatapultEntryAxe(part)) return createCatapultAxeMetalMaterial;
  if (isMayaGildedColumn(part)) return createMayaGildedColumnMaterial;
  if (isMayaYardFigurine(part)) return createMayaYardFigurineMaterial;
  return OWNED_MATERIAL_SHAPES[part.shape];
};

const createBuildingMesh = (geometry: BufferGeometry, material: MeshStandardMaterial) => {
  if (!geometry.getAttribute("color")) {
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3).fill(1),
        3
      )
    );
  }
  return new Mesh(geometry, material);
};

const compactSackSegments = (part: BuildingPart, detailed: boolean) => {
  if (!part.compactGeometry) return undefined;
  return detailed ? 8 : 3;
};

const partGeometry = (part: BuildingPart, detailed: boolean) => {
  let geometry: BufferGeometry;
  const decor = createNubianDecorGeometry(part, detailed);
  if (decor) geometry = decor;
  else if (part.shape === "cloth-panel" && part.clothPanelCorners)
    geometry = createClothPanelGeometry(part.clothPanelCorners, part.size, detailed);
  else if (part.shape === "chinese-roof-bearing" && part.chineseRoofBearingProfile)
    geometry = createChineseRoofBearingGeometry(part.chineseRoofBearingProfile);
  else if (part.shape === "national-yard-sculpture")
    geometry = createNationalYardSculptureGeometry(part.decorVariant ?? 0, detailed);
  else if (part.shape === "vine-foliage") geometry = createVineFoliageGeometry(detailed);
  else if (part.shape === "catapult-wall-ivy") geometry = createCatapultIvyGeometry(detailed);
  // Ware stock overrides set coarse round segments: those many pile bunches use the lean cluster.
  else if (part.shape === "grape-bunch") geometry = createGrapeBunchGeometry(detailed, part.radialSegments !== undefined);
  else if (isDrinkVesselShape(part.shape)) geometry = createDrinkVesselGeometry(part.shape, detailed,
    part.radialSegments !== undefined);
  else if (part.shape === "indigenous-palm-roof") geometry = createIndigenousPalmRoofGeometry(detailed);
  else if (part.shape === "indigenous-roof")
    geometry = createIndigenousRoofGeometry(part.indigenousRoof ?? "tipi", detailed,
      part.indigenousEntrance, part.indigenousRearEntrance, part.indigenousCutout, part.indigenousFrameRadius);
  else if (part.shape === "persian-striped-awning") geometry = createPersianStripedAwningGeometry(part, detailed);
  else if (part.shape === "persian-room") geometry = createPersianRoomGeometry(part, detailed);
  else if (part.shape === "lean-thatch-roof") geometry = createLeanThatchRoof(part, detailed);
  else if (part.shape === "architectural-bamboo") geometry = createArchitecturalBamboo(
    part.bambooSection ?? "round",detailed,part.bambooPhase,part.bambooConcave,part.radialSegments);
  else if(part.shape==="indigenous-pigment")geometry=createIndigenousPigmentGeometry(part,detailed,
    part.indigenousPigment!,part.indigenousPigmentRegion!);
  else if(part.shape==="indigenous-rubble-masonry")geometry=createIndigenousRubbleMasonry(detailed);
  else if(part.shape==="chinese-wall-fan")geometry=createChineseWallFanGeometry(detailed);
  else if(part.shape==="catapult-national-shell")geometry=createCatapultNationalShell(part.catapultShellNation!,detailed);
  else if(part.shape==="catapult-window-frame")geometry=createCatapultWindowFrame(part.catapultWindowStyle!,detailed);
  else if(part.shape==="catapult-window-reveal")geometry=createCatapultWindowReveal(part.catapultWindowStyle!,detailed);
  else if(part.shape==="catapult-window-glass")geometry=createCatapultWindowGlass();
  else if(part.shape==="catapult-shell-band")geometry=createCatapultNationalShell(part.catapultShellNation!,detailed,part.catapultShellBand);
  else if(part.shape==="yagura-wall")geometry=createYaguraWallGeometry(part);
  else if(part.shape==="yagura-window-frame")geometry=createYaguraWindowFrame();
  else if (part.shape === "occupation-roof") geometry = createRomanOccupationRoof(part, detailed && !part.roofCompactGeometry);
  else if (part.shape === "nation-roof") geometry = createNationRoofGeometry(part.roofProfile ?? "viking", detailed,
    part.size, part.roofLayer, part.compactGeometry);
  else if (part.shape === "lookout-spyglass-sign" || part.shape === "forester-tree-sign") geometry = new PlaneGeometry(1, 1);
  else if (part.shape === "paint-ellipse") {
    let segments = detailed ? 24 : 12;
    if (part.compactGeometry) segments = detailed ? 8 : 4;
    geometry = new CircleGeometry(.5, segments);
  }
  else if (part.shape === "chinese-lantern") geometry = createChineseLanternGeometry(detailed, part.decorVariant);
  else if (part.shape === "paper-lantern") geometry = createPaperLanternGeometry(detailed);
  else if (part.shape === "folding-fan") geometry = createFoldingFanGeometry(detailed);
  else if (part.shape === "bamboo-culm") geometry = createBambooCulmGeometry(part.size, detailed);
  else if (part.shape === "bamboo-leaves") geometry = createBambooLeavesGeometry(part.size, detailed);
  else if (part.shape === "dragon-coil") geometry = createDragonCoilGeometry(part.size, detailed);
  else if ((part.shape === "paint-triangle" || part.shape === "cloud-paint")) {
    geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,0,.5,0],3));
    geometry.setAttribute("uv", new Float32BufferAttribute([0,0,1,0,.5,1],2));
    geometry.setIndex([0,1,2]); geometry.computeVertexNormals();
  }
  else if (part.shape === "paint-stroke") geometry = new PlaneGeometry(1, 1);
  else if (part.shape === "maya-headquarters-textile")
    geometry = createClothPanelGeometry([[-.5,-.5,0],[.5,-.5,0],[.5,.5,0],[-.5,.5,0]],part.size,detailed);
  else if (part.shape === "indigenous-floor-hide") geometry = createIndigenousFloorHideGeometry(detailed);
  else if (part.shape === "stretched-hide") geometry = createStretchedHideGeometry(detailed);
  else if (part.shape === "linen-bolt") geometry = createLinenBoltGeometry(detailed);
  else if (part.shape === "civic-statue") geometry = createRomanCivicStatue(detailed);
  else if (isVikingOrnamentShape(part.shape)) geometry = createVikingOrnamentGeometry(part.shape, detailed);
  else if (part.shape === "civic-column-shaft") geometry = createRomanCivicColumn();
  else if (part.shape === "dome") geometry = createRomanCupola(detailed);
  else if (part.shape === "ogive-dome") geometry = createNationOgiveDome(detailed, part.radialSegments);
  else if (part.shape === "persian-dome") geometry = createPersianDome(detailed);
  else if (part.shape === "persian-barrel") geometry = createPersianBarrel(detailed);
  else if (part.shape === "persian-barrel-end") geometry = createPersianBarrelEnd(detailed);
  else if (part.shape === "persian-transition") geometry = createPersianTransition();
  else if (part.shape === "cylinder" && part.surface === "bark")
    geometry = createRomanTimberLog(detailed);
  else if (part.shape === "cylinder" && part.surface === "endgrain")
    geometry = new CylinderGeometry(0.5, 0.5, 1, detailed ? 12 : 8);
  else if (part.stock?.ware === "water" && part.shape === "ring" && part.surface === "wood")
    geometry = createRomanStockBucket(detailed);
  else if (part.stock?.ware === "water" && part.shape === "cylinder" && part.surface === "paint")
    geometry = createRomanBucketWater(detailed);
  else if (part.stock?.ware === "water" && part.shape === "ring" && part.surface === "iron" && !detailed)
    geometry = new CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
  else if (part.stock && detailed && part.shape === "sphere" && Math.max(...part.size) < 0.02)
    geometry = new SphereGeometry(0.5, 4, 2);
  else if (part.stock?.ware === "flour" && part.shape === "sack")
    geometry = createRomanStockSack(detailed, compactSackSegments(part, detailed));
  else if (part.stock && !detailed && ["sack", "fish", "sphere"].includes(part.shape))
    geometry = new SphereGeometry(0.5, part.radialSegments ?? (part.shape === "fish" ? 6 : 4),
      part.radialSegments === 3 ? 2 : 3);
  else if (part.stock && !detailed && part.shape === "cylinder")
    geometry = new CylinderGeometry(0.5, 0.5, 1, part.radialSegments ?? 4);
  else if (part.shape === "stone-block") {
    geometry = new BoxGeometry(1, 1, 1);
    const vertices = geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        y = vertices.getY(i),
        z = vertices.getZ(i);
      const roughness = Math.sin(x * 13 + y * 17 + z * 23 + part.position[1] * 7);
      vertices.setXYZ(i, x + roughness * 0.035, y, z + roughness * 0.035);
    }
    geometry.computeVertexNormals();
    if (part.surface === "stone") applyAshlarBlockUv(geometry, part.position);
  } else if (part.shape === "scythe-blade" || part.shape === "axe-head")
    geometry = createRomanToolHead(part.shape === "axe-head", detailed, part.stock && !detailed ? 1 : undefined);
  else if (part.shape === "firebox-reveal") geometry = createFireboxRevealGeometry(part, detailed);
  else if (part.shape === "arch-spandrel") geometry = createRomanDoorSpandrel(detailed);
  else if (part.shape === "persian-arch-spandrel") geometry = createPersianArchSpandrel(
    part.pointedArchOpening?.[0] ?? .8, part.pointedArchOpening?.[1] ?? .8, detailed, part.size[0] / part.size[1]);
  else if (part.shape === "persian-palmette-panel") geometry = createPersianPalmettePanelGeometry(detailed);
  else if (part.shape === "persian-stucco-relief") geometry = createPersianStuccoReliefGeometry(detailed);
  else if (part.shape === "maya-civic-mask") geometry = createMayaCivicMaskGeometry(detailed,part.compactGeometry);
  else if (part.shape === "fish") geometry = createRomanFish(detailed);
  else if (part.shape === "fish-tail") geometry = createRomanFishTail();
  else if (part.shape === "wheat-ear") geometry = createRomanWheatEar(detailed);
  else if (part.shape === "open-sack") geometry = createRomanOpenStockSack(detailed, part.radialSegments);
  else if (part.shape === "sack") geometry = createRomanStockSack(detailed, compactSackSegments(part, detailed));
  else if (part.shape === "anvil") geometry = createRomanAnvilGeometry(detailed);
  else if (part.shape === "workshop-stump") geometry = createWorkshopPropGeometry("stump", detailed);
  else if (part.shape === "nursery-sapling") geometry = createWorkshopPropGeometry("sapling", detailed);
  else if (part.shape === "tea-bark") geometry = createTeaBerryGeometry("tea", "bark", detailed);
  else if (part.shape === "tea-leaves") geometry = createTeaBerryGeometry("tea", "leaves", detailed);
  else if (part.shape === "berry-bark") geometry = createTeaBerryGeometry("berries", "bark", detailed);
  else if (part.shape === "berry-leaves") geometry = createTeaBerryGeometry("berries", "leaves", detailed);
  else if (part.shape === "berry-fruit") geometry = createTeaBerryGeometry("berries", "fruit", detailed);
  else if (part.shape === "harvested-tea-leaf") geometry = createTeaBerryGeometry("tea", "harvest", detailed);
  else if (part.shape === "harvested-drink-berry") geometry = createTeaBerryGeometry("berries", "harvest", detailed);
  else if (part.shape === "vat-liquid") geometry = createTanningLiquidGeometry(detailed);
  else if (part.shape === "planting-soil") geometry = createPlantingSoilGeometry(detailed);
  else if (part.shape === "pomegranate-bark") geometry = createPomegranateGeometry("bark", detailed);
  else if (part.shape === "pomegranate-leaves") geometry = createPomegranateGeometry("leaves", detailed);
  else if (part.shape === "pomegranate-fruit") geometry = createPomegranateGeometry("fruit", detailed);
  else if (part.shape === "pomegranate-whole-fruit") geometry = createPomegranateGeometry("whole-fruit", detailed);
  else if (part.shape === "cacao-bark") geometry = createCacaoTreeGeometry("bark", detailed);
  else if (part.shape === "cacao-leaves") geometry = createCacaoTreeGeometry("leaves", detailed);
  else if (part.shape === "cacao-pods") geometry = createCacaoTreeGeometry("pods", detailed);
  else if (part.shape === "window-shadow") geometry = createWindowShadowGeometry(part);
  else if (part.shape === "bevel-box")
    geometry = detailed ? createRomanBevelledBox(!part.stock && !part.compactGeometry) : new BoxGeometry(1, 1, 1);
  else if (part.shape === "civic-hipped-roof") geometry = createRomanCivicRoof(detailed,part.size[0],part.size[2]);
  else if (part.shape === "camp-dressing") {
    geometry=createAdventureCampDecoration(part.campDecoration??"tent",detailed,part.campTheme,part.campTentVariant,.45);
    geometry.computeBoundingBox();
    const bounds=geometry.boundingBox!,size=bounds.getSize(new Vector3()),centre=bounds.getCenter(new Vector3());
    geometry.translate(-centre.x,-centre.y,-centre.z);
    geometry.scale(1/Math.max(.001,size.x),1/Math.max(.001,size.y),1/Math.max(.001,size.z));
  }
  else if (part.shape === "roof-infill") geometry = createRoofEndInfill(part,detailed);
  else if (part.shape === "ring") {
    const segments = detailed ? 24 : 12;
    geometry = createHollowRingGeometry(part.radialSegments ?? (part.stock ? segments / 2 : segments), Math.PI * 2, part.innerRadius);
  }
  else if (part.shape === "stone-arc") {
    geometry = createHollowRingGeometry(detailed ? 3 : 1, Math.PI / 6 - 0.009, part.innerRadius);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.2, uv.getY(i) * 0.125);
  } else if (part.shape === "tile") geometry = createRomanRoofTile();
  else if (part.shape === "gable") {
    geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        [
          -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5,
          0.5
        ],
        3
      )
    );
    geometry.setAttribute(
      "uv",
      new Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1], 2)
    );
    geometry.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
    geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
  } else if (part.shape === "cone") geometry = new CylinderGeometry(0, 0.5, 1, part.radialSegments ?? (detailed ? 16 : 8));
  else if (part.shape === "wheat-stalk") geometry = new CylinderGeometry(0.5, 0.5, 1, detailed ? 5 : 3, 1, detailed);
  else if (part.shape === "cord") geometry = new CylinderGeometry(0.5, 0.5, 1, detailed ? 4 : 3, 1, part.stock?.ware === "bow" && !detailed);
  else if (part.shape === "cylinder")
    geometry = new CylinderGeometry(0.5, 0.5, 1, part.radialSegments ?? (detailed ? 12 : 6), 1,
      part.openEnded === true);
  else if (part.shape === "catapult-deck") geometry = createCatapultDeckGeometry();
  else if (part.shape === "catapult-rock") geometry = createCatapultRockGeometry(detailed);
  else if (part.shape === "structural-rock" && part.indigenousMasonryStone)
    geometry = createIndigenousWorkshopStoneGeometry(detailed, part.decorVariant);
  else if (part.shape === "structural-rock") geometry = createStructuralRockGeometry(detailed, part.decorVariant, part.rockFacets, part.rockBuriedBack);
  else if (part.shape === "catapult-scoop") geometry = createCatapultScoopGeometry(detailed);
  else if (part.shape === "iron-ingot") geometry = createIronIngotGeometry();
  else if (part.shape === "rock") {
    geometry = new IcosahedronGeometry(0.5, detailed ? 1 : 0);
    const vertices = geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        y = vertices.getY(i),
        z = vertices.getZ(i);
      const scale = 0.87 + Math.sin(x * 31 + y * 17 + z * 23) * 0.12;
      vertices.setXYZ(i, x * scale, y * scale, z * scale);
    }
    geometry.computeVertexNormals();
  } else if (part.shape === "sphere" && part.surface === "paint" && part.size[2] <= .004) {
    geometry = new SphereGeometry(.5, detailed ? 12 : 6, 2);
  } else if (part.shape === "sphere") {
    const maximum = Math.max(...part.size);
    const fine =
      detailed &&
      part.surface !== "leaf" &&
      maximum > 0.12 &&
      !(part.size[1] < 0.08 && maximum < 0.3);
    const compact = part.compactGeometry && !detailed;
    geometry = new SphereGeometry(0.5, compact ? 4 : part.radialSegments ?? (fine ? 12 : 6),
      compact ? 2 : getSphereHeightSegments(part.radialSegments, fine));
  } else geometry = new BoxGeometry(1, 1, 1);
  if (part.fireboxCut) geometry = cutFireboxCavityGeometry(geometry, part.fireboxCut);
  applyCatapultAxeMetalUv(geometry, part);
  const existingColors = geometry.getAttribute("color");
  const color = existingColors ? Float32Array.from(existingColors.array) :
    new Float32Array(geometry.attributes.position!.count * 3).fill(1);
  const tint = part.tint ?? [1, 1, 1];
  for (let index = 0; index < color.length; index++) color[index] = color[index]! * tint[index % 3]!;
  geometry.setAttribute("color", new Float32BufferAttribute(color, 3));
  geometry.scale(...part.size);
  if (part.interiorFloorFaces) keepInteriorFloorFaces(geometry, part.interiorFloorFaces);
  if (!detailed && part.shape === "box" && part.omitGroundBottom) omitGroundBottom(geometry);
  if (part.shape === "box" && part.buriedBoxFaces) omitBuriedBoxFaces(geometry, part.buriedBoxFaces);
  if(part.shape==="indigenous-pigment") {
    const positions=geometry.getAttribute("position"),normals=geometry.getAttribute("normal");
    for (let at = 0; at < positions.count; at++) {
      // A projected painting crosses sharp stone shoulders. One projection-axis offset keeps
      // adjacent painted triangles joined; independent face-normal offsets open hairline cracks.
      if (part.indigenousPigmentCarriers) { positions.setZ(at, positions.getZ(at) + .0008); continue; }
      positions.setXYZ(at, positions.getX(at) + normals.getX(at) * .0008,
        positions.getY(at) + normals.getY(at) * .0008, positions.getZ(at) + normals.getZ(at) * .0008);
    }
  }
  if (part.worldUv && !applyPersianRoofUv(geometry, part))
    applyBuildingWorldUv(geometry, part.worldUv, part.rotation ? undefined : part.position,
    ROUND_SHAPES.has(part.shape) ? Math.PI * (part.size[0] + part.size[2]) / 2 : undefined);
  if (part.topScale || part.topOffset) {
    const positions = geometry.getAttribute("position");
    const scale = part.topScale ?? [1, 1, 1];
    const offset = part.topOffset ?? [0, 0, 0];
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const fraction = positions.getY(vertex) / part.size[1] + 0.5;
      positions.setXYZ(
        vertex,
        positions.getX(vertex) * (1 + (scale[0] - 1) * fraction) + offset[0] * fraction,
        positions.getY(vertex),
        positions.getZ(vertex) * (1 + (scale[2] - 1) * fraction) + offset[2] * fraction
      );
    }
    geometry.computeVertexNormals();
  }
  if (part.rotation) {
    geometry.rotateX(part.rotation[0]);
    geometry.rotateY(part.rotation[1]);
    geometry.rotateZ(part.rotation[2]);
  }
  geometry.translate(...part.position);
  if (part.roofOpening) geometry = clipRoofTowerOpening(geometry, part.roofOpening);
  if(part.catapultRubble)geometry=clipCatapultRubbleOpenings(geometry,part.shape!=="indigenous-rubble-masonry");
  if(part.shape==="indigenous-rubble-masonry")seatIndigenousMasonryOutsideCavity(geometry);
  if(part.shape==="indigenous-rubble-masonry")softenIndigenousRubbleNormals(geometry,detailed);
  applyCatapultOrnamentCurve(geometry, part);
  applyMayaMasonryUv(geometry, part);
  applyBuildingInteriorShade(geometry, part);
  if (!detailed) return removeEmptyTriangles(compactPrimitiveCaps(geometry));
  return geometry;
};
/** Standalone wares reuse the buildings' authored shapes, UVs, tint and transforms. */
export { partGeometry as createRomanPartGeometry };
/** Merged mesh of a building's swinging lanterns and cedar balls (High). */
const HANGING_DECOR = "hanging_decor";
/** The merged mesh a part joins within its construction stage and surface. */
const partGroupKey = (part: BuildingPart, detailed: boolean) => {
  if (part.constructionDeck) return "construction-deck";
  if (part.windowShadow) return "window-shadow";
  // Lamp panes share one material swap at night; ordinary amber parts must stay out of it.
  if (part.nightLamp) return "night-lamp";
  if (part.shape.startsWith("pig-feeding-")) return part.shape;
  if (part.windCordSlot !== undefined) return `wind-cord:${part.windCordSlot}`;
  if (part.drinkTool) return `drink-tool:${part.drinkTool}`;
  // Minimal merges hanging decorations with the rest: they hang still there.
  if (part.swayPivot && detailed) return "sway";
  if (part.shape === "catapult-rock" && part.stock) return `catapult-rock:${part.stock.slot}`;
  if (isCatapultEntryAxe(part)) return "catapult-entry-axe";
  if (part.indigenousMasonryStone) return "indigenous-quarry-stone";
  if (isMayaGildedColumn(part)) return "maya-gilded-column";
  if (isMayaYardFigurine(part)) return "maya-yard-figurine";
  if (OWNED_MATERIAL_SHAPES[part.shape]) return part.shape;
  if (part.catapultPart) return `catapult:${part.catapultPart}:${part.stock?.slot ?? "fixed"}`;
  if (part.stock) return `${part.stock.kind ?? "output"}:${part.stock.ware}:${part.stock.slot}`;
  return "permanent";
};

/** The parts of every construction stage and surface (`stage|surface`), in recipe order. */
const bucketParts = (parts: readonly BuildingPart[]) => {
  const buckets = new Map<string, BuildingPart[]>();
  for (const part of parts) {
    const id = `${romanConstructionStage(part)}|${part.surface}`;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(part);
    else buckets.set(id, [part]);
  }
  return buckets;
};

/** The groups of one stage and surface (in order of first appearance), each sorted bottom up. */
const partGroupsOf = (buckets: ReadonlyMap<string, readonly BuildingPart[]>, stage: number, surface: string,
  detailed: boolean) => {
  const groups = new Map<string, BuildingPart[]>();
  for (const part of buckets.get(`${stage}|${surface}`) ?? []) {
    const key = partGroupKey(part, detailed);
    const group = groups.get(key);
    if (group) group.push(part);
    else groups.set(key, [part]);
  }
  return [...groups].map(([key, parts]) => ({ key,
    parts: parts.sort((a, b) => (a.position[1] - a.size[1] / 2) - (b.position[1] - b.size[1] / 2)) }));
};

/** Level dressing adds many small overlaps; Minimal drops provably buried triangles, never parts. */
const solidBoxesOf = (parts: readonly BuildingPart[], detailed: boolean) =>
  !detailed && parts.some(part => part.compactGeometry) ? buildingSolidBoxes(parts) : [];

export type MergedPartGroup = { ends: number[]; geometry: BufferGeometry };
/** Merged groups by `stage|surface|key`, prepared off the main thread (building recipe worker). */
export type PreparedPartGroups = ReadonlyMap<string, MergedPartGroup>;
const partGroupId = (stage: number, surface: string, key: string) => `${stage}|${surface}|${key}`;

/** One group's merged geometry and the running vertex/index end of each part (construction reveal). */
const mergePartGroup = (selectedParts: readonly BuildingPart[], key: string, detailed: boolean,
  solidBoxes: ReturnType<typeof buildingSolidBoxes>): MergedPartGroup => {
  const geometries = selectedParts.map((part) =>
    removeHiddenBuildingTriangles(partGeometry(part, detailed), part, solidBoxes));
  if (key === "sway") geometries.forEach((geometry, index) => setSwayPivot(geometry, selectedParts[index]!.swayPivot!));
  if (geometries.some((geometry) => !geometry.index)) {
    for (let i = 0; i < geometries.length; i++) {
      const geometry = geometries[i]!;
      if (!geometry.index) continue;
      geometries[i] = geometry.toNonIndexed();
      geometry.dispose();
    }
  }
  let end = 0;
  const ends = geometries.map((geometry) => {
    end += geometry.index?.count ?? geometry.getAttribute("position").count;
    return end;
  });
  const merged = mergeGeometries(geometries);
  geometries.forEach((geometry) => geometry.dispose());
  if (!merged) throw new Error("Building geometry merge failed");
  return { ends, geometry: merged };
};

/** The parts drawn as merged meshes (ware stock and pig residents are separate models). */
const mergedRecipeParts = (recipe: BuildingRecipe) => recipe.parts.filter(part =>
  part.shape !== "pig-residents" && (part.shape === "catapult-rock" || !isCanonicalRomanWareStock(part.stock)));

/**
 * Every merged group of a recipe, for every surface its parts use: DOM and GPU free, so the
 * building recipe worker can prepare a model's geometry. The model takes the groups it draws.
 */
export const prepareMergedPartGroups = (recipe: BuildingRecipe, detailed: boolean) => {
  const parts = mergedRecipeParts(withBuildingWindowShadows(recipe));
  const solidBoxes = solidBoxesOf(parts, detailed);
  const surfaces = [...new Set(parts.map(part => part.surface))];
  const buckets = bucketParts(parts);
  const groups = new Map<string, MergedPartGroup>();
  for (let stage = 0; stage < 5; stage++) for (const surface of surfaces)
    for (const { key, parts: selected } of partGroupsOf(buckets, stage, surface, detailed))
      groups.set(partGroupId(stage, surface, key), mergePartGroup(selected, key, detailed, solidBoxes));
  return groups;
};

const addMergedParts = (
  root: Group,
  parts: BuildingPart[],
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean,
  prepared?: PreparedPartGroups
) => {
  const solidBoxes = solidBoxesOf(parts, detailed);
  const buckets = bucketParts(parts);
  for (let stage = 0; stage < 5; stage++) {
    const group = new Group();
    group.name = `construction_${stage}`;
    root.add(group);
    for (const surface of Object.keys(materials) as BuildingSurface[]) {
      for (const { key, parts: selectedParts } of partGroupsOf(buckets, stage, surface, detailed)) {
        const { ends, geometry: merged } = prepared?.get(partGroupId(stage, surface, key)) ??
          mergePartGroup(selectedParts, key, detailed, solidBoxes);
        const deck = key === "construction-deck";
        const ownMaterial = ownedPartMaterial(selectedParts[0]!), statue = Boolean(ownMaterial);
        const sway = key === "sway";
        let material = materials[surface];
        if (deck) material = materials.wood;
        else if (sway) material = getSwayMaterial(materials[surface]);
        if (key === "window-shadow") material = windowShadowMaterial(materials[surface]);
        const mesh = createBuildingMesh(merged, ownMaterial ? ownMaterial(materials[surface], detailed) : material);
        if (deck) {
          mesh.name = "construction_deck";
          mesh.userData.deckMaterials = { construction: materials.wood, finished: materials.stone };
        }
        if (sway) mesh.name = HANGING_DECOR;
        if (statue) mesh.userData.ownedMaterial = true;
        const shape = selectedParts[0]!.shape;
        if(shape==="catapult-window-glass")mesh.userData.windowGlass=true;
        if(shape==="indigenous-pigment") {mesh.name="indigenous_pigment";mesh.userData.visualPigment=true;}
        if (statue && shape !== "catapult-rock" && shape !== "structural-rock" && shape !== "indigenous-rubble-masonry" &&
            !hasBuildingMaterialOwnership(mesh.material))
          ownBuildingMaterial(mesh.material, materials[surface],
            shape === "civic-statue" || shape === "thor-statue" || shape === "rune-plinth" ||
            shape === "national-yard-sculpture" || selectedParts[0]?.mayaGildedColumn === true);
        if (["catapult-rock", "structural-rock", "indigenous-rubble-masonry"].includes(selectedParts[0]?.shape ?? ""))
          mesh.userData.catapultRockMaterial = true;
        mesh.castShadow = detailed && key !== "window-shadow" && shape!=="indigenous-pigment" &&
          shape!=="catapult-window-glass";
        mesh.receiveShadow = detailed && key !== "window-shadow";
        if (key === "window-shadow") {
          mesh.name = "window_shadow";
          mesh.userData.windowShadow = true;
          mesh.userData.windowShadowDecorative = selectedParts[0]?.windowShadowDecorative === true;
        }
        if (key === "night-lamp") { mesh.name = "night_lamp"; mesh.userData.nightLamp = true; }
        mesh.userData.buildingSurface = surface;
        mesh.userData.stock = selectedParts[0]?.stock;
        if(key.startsWith("pig-feeding-")) {mesh.userData.pigFeedSurface=key.slice(12);mesh.name=key;}
        const cord = selectedParts[0];
        if (cord?.catapultPart) prepareCatapultMesh(mesh, cord.catapultPart);
        if (cord?.drinkTool) {
          mesh.name = `drink_tool_${cord.drinkTool}`;
          mesh.userData.drinkTool = cord.drinkTool;
          mesh.geometry.translate(-cord.position[0], -cord.position[1], -cord.position[2]);
          mesh.position.set(...cord.position);
        }
        if (cord?.windCordSlot !== undefined) {
          mesh.name = `hunter_cord_${cord.windCordSlot}`;
          mesh.userData.windCordSlot = cord.windCordSlot;
          mesh.userData.windCordWare = "meat";
          const anchor = new Vector3(cord.position[0], cord.position[1] + cord.size[1] / 2, cord.position[2]);
          mesh.geometry.translate(-anchor.x, -anchor.y, -anchor.z);
          mesh.position.copy(anchor);
        }
        prepareRomanConstructionMesh(mesh, ends, stage === 1);
        // Plain shared-material parts never animate once built: cross-building batches may draw them.
        if (key === "permanent" && !ownMaterial && !mesh.userData.visualPigment)
          markStaticBatchMesh(mesh, material, true, stage === 1);
        group.add(mesh);
      }
    }
  }
};
const createMechanism = (
  definition: BuildingDefinition,
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, nation: WorkerNation
) => {
  if (definition.id === 31) return createNationalMillMechanism(materials, detailed, nation);
  const industry = createIndustryMechanism(definition.id, materials, detailed);
  if (industry) return industry;
  const group = new Group();
  group.name = "mechanism";
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    surface: BuildingSurface = "wood"
  ) => {
    const mesh = createBuildingMesh(new BoxGeometry(w, h, d), materials[surface]);
    mesh.position.set(x, y, z);
    mesh.castShadow = detailed;
    group.add(mesh);
    return mesh;
  };
  const kind = definition.mechanism;
  if (kind === "none") return group;
  if (kind === "wheel") {
    const radius = definition.style === "mill" ? 0.8 : 0.22;
    const hub = createBuildingMesh(new CylinderGeometry(0.08, 0.08, 0.15, 8), materials.iron);
    hub.rotation.x = Math.PI / 2;
    group.add(hub);
    for (let i = 0; i < 8; i++) {
      const spoke = box(0, 0, 0, 0.035, radius * 2, 0.04);
      spoke.rotation.z = (i * Math.PI) / 4;
      if (definition.style === "mill" && i % 2 === 0) {
        const sail = box(
          Math.sin((i * Math.PI) / 4) * radius * 0.6,
          Math.cos((i * Math.PI) / 4) * radius * 0.6,
          0.04,
          0.17,
          radius * 0.75,
          0.025,
          "cloth"
        );
        sail.rotation.z = (-i * Math.PI) / 4;
      }
    }
  } else if (kind === "crane") {
    box(0, 0.05, 0, 0.055, 1.04, 0.055);
    box(0.23, 0.55, 0, 0.5, 0.06, 0.06);
    box(0.45, 0.2, 0, 0.015, 0.7, 0.015, "iron");
    box(0.45, -0.14, 0, 0.14, 0.08, 0.14);
  } else {
    const metal = kind === "saw" || kind === "hammer";
    if (kind === "saw") {
      box(0, 0, 0, 0.028, 0.42, 0.13, "iron");
      if (detailed)
        for (let i = 0; i < 7; i++) box(0.02, -0.18 + i * 0.06, 0, 0.018, 0.021, 0.12, "iron");
    } else box(0, 0, 0, metal ? 0.32 : 0.15, metal ? 0.14 : 0.35, 0.09, metal ? "iron" : "wood");
    box(0, -0.19, 0, 0.07, 0.26, 0.07);
  }
  return group;
};
const createBalconyDoor = (
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  position: Point3,
  width = 0.35,
  height = 0.5,
  yaw = 0
) => {
  const door = new Group();
  door.name = "balcony_door";
  door.position.set(...position);
  door.rotation.y = yaw;
  const panel = createBuildingMesh(createWoodenDoorPanel(false, false,
    { height, spring: height, width }, .035, .0175), materials.planks ?? materials.wood);
  door.add(panel);
  for (const y of [height * 0.16, height * 0.8]) {
    const hinge = createBuildingMesh(new BoxGeometry(0.22, 0.015, 0.014), materials.iron);
    hinge.position.set(0.12, y, 0.025);
    door.add(hinge);
  }
  return door;
};
const buildingMetadata = (definition: BuildingDefinition, recipe: BuildingRecipe) => {
  const sizing = getRomanBuildingWorldSizing(definition);
  return {
    modelScale: sizing.scale,
    groundBounds: sizing.groundBounds,
    overheadClearance: sizing.overhead,
    entranceClearance: sizing.entrance,
    effects: sizing.effects,
    nation: "roman",
    buildingId: definition.id,
    name: definition.name,
    role: definition.role,
    worker: definition.worker,
    task: definition.task,
    workerExit: recipe.workerExit,
    workPoint: recipe.workPoint,
    footprint: definition.footprint,
    foundationDepth: definition.style === "mine" ? 1 : 0.6,
    extension: definition.extension,
    outputStorage: definition.outputStorage,
    gridFootprint: definition.gridFootprint,
    garrisonCapacity: definition.garrisonCapacity,
    garrisonWindows: recipe.garrisonWindows,
    archerPositions: recipe.archerPositions ?? [],
    archerPositionsUseGarrison: true
  };
};
/** Reusable original Roman model: Y up, metres/world units, south (+Z) entrance. */
const disposeBuildingObject = (object: import("three").Object3D) => {
  if (!(object instanceof Mesh)) return;
  if (object.userData.catapultBundle) return; // geometry and material owned by the shared bundle kit
  object.geometry.dispose();
  object.userData.catapultBundleOverlay?.solid.dispose();
  if (object.userData.catapultRockMaterial) { disposeCatapultRockMaterial(object.material as MeshStandardMaterial); return; }
  if (object.userData.ownedMap) (object.material as MeshStandardMaterial).map?.dispose();
  if (object.userData.ownedMaterial) (object.material as MeshStandardMaterial).dispose();
};

const createBalconyEntrance = (anchor: BuildingRecipe["balconyDoor"], recipe: BuildingRecipe,
  materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean) => {
  if (!anchor) return undefined;
  if (recipe.hideBalconyDoor) return undefined;
  if (!recipe.tentDoor) return createBalconyDoor(materials, anchor.position, anchor.width, anchor.height, anchor.yaw);
  const { height, position, width, yaw } = anchor;
  const curtain = createTentDoor(materials, detailed, position,
    { height, spring: height - width / 2, width }, "tent_balcony");
  curtain.name = "balcony_door"; curtain.rotation.y = yaw;
  return curtain;
};

export const createRomanBuilding = (
  definition: BuildingDefinition,
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed = true,
  suppliedRecipe?: BuildingRecipe,
  nation: WorkerNation = "roman",
  stockReference?: BuildingRecipe,
  /** The recipe's merged groups, prepared by the building recipe worker (byte-identical). */
  prepared?: PreparedPartGroups
) => {
  const root = new Group();
  root.name = `roman_${definition.id}`;
  const recipe = withBuildingWindowShadows(suppliedRecipe ?? createRomanBuildingRecipe(definition, detailed));
  addMergedParts(root, mergedRecipeParts(recipe), materials, detailed, prepared);
  const drinkTools = createExpansionDrinkTools(root);
  const pigs=createRomanPigResidents(recipe.parts.find(part=>part.shape==="pig-residents"),detailed);
  if(pigs)root.getObjectByName("construction_3")!.add(pigs.root);
  const stockModels = createRomanWareStockModels(root.getObjectByName("construction_4") as Group,
    { ...recipe, parts: recipe.parts.filter(part => part.shape !== "catapult-rock") },
    getRomanBuildingWorldSizing(definition).scale, detailed, materials, nation,
    stockReference ?? (!detailed && !suppliedRecipe ? getRomanBuildingWorldSizing(definition).recipe : undefined));
  const createEntrance = () => {
    if (recipe.hideDoor) return new Group();
    if (recipe.doubleDoor) return createStorageDoubleDoor(materials, detailed, recipe.door,
      recipe.doorDimensions!, recipe.tentDoor);
    if (recipe.tentDoor) return createTentDoor(materials, detailed, recipe.door, recipe.doorDimensions);
    return createRomanGroundDoor(materials, detailed, recipe.door, recipe.doorProfile === "arched", recipe.doorDimensions);
  };
  const door = createEntrance();
  root.add(door);
  if(recipe.hideDoor){door.name="door";door.position.set(...recipe.door);}
  const balconyAnchor =
    recipe.balconyDoor ??
    (definition.id === 14
      ? {
          position: [-0.175, 1.785, recipe.door[2] - 0.051] as Point3,
          width: 0.35,
          height: 0.5,
          yaw: 0
        }
      : undefined);
  const balconyDoor = createBalconyEntrance(balconyAnchor, recipe, materials, detailed);
  if (balconyDoor) root.add(balconyDoor);
  door.visible = !recipe.hideDoor && definition.style !== "well";
  const well = definition.id === 35 ? createRomanWellMechanism(materials, detailed, nation) : undefined;
  const mechanism = recipe.drinkNation ? new Group() : well?.root ?? createMechanism(definition, materials, detailed, nation);
  mechanism.name = "mechanism";
  mechanism.position.set(...recipe.mechanism);

  root.add(mechanism);
  const furnaceEffects = createRomanFurnaceEffects(definition, recipe, detailed);
  if (furnaceEffects) root.add(furnaceEffects.root);
  const mineLight = createRomanMineLight(definition.id, detailed);
  if (mineLight) root.add(mineLight.root);
  const harborBeacon = createRomanHarborBeacon(definition.id, materials, detailed, recipe.harborBeacon, nation === "roman");
  if (harborBeacon) root.add(harborBeacon.root);
  const banner = new Group();
  banner.name = "activity_banner";
  banner.position.set(
    -Math.min(0.58, definition.footprint * 0.31),
    0.57,
    (definition.footprint * 0.69) / 2 + 0.12
  );
  if (definition.style === "well") banner.position.set(-0.45, 0.83, 0.08);
  // Keep the empty animation target for existing GLB clip compatibility.
  // Activity is expressed through functional equipment instead of arbitrary wall pennants.
  root.add(banner);
  const playerFlag = !recipe.hideFlag && [0, 1, 2, 4, 9].includes(definition.id)
    ? createRomanPlayerFlag(materials.cloth, materials.wood, detailed)
    : undefined;
  if (playerFlag) {
    if (recipe.flagAnchor) playerFlag.root.position.set(...recipe.flagAnchor);
    else
      playerFlag.root.position.set(
        0,
        (definition.id === 1 ? 1.12 : 1.42) +
          0.27 +
          (Math.tan(0.54) * (definition.footprint * 0.82 + 0.33)) / 2 -
          0.18 +
          0.17,
        (definition.footprint * 0.69) / 2 - 0.04
      );
    root.add(playerFlag.root);
  }
  for (const [index, position] of (recipe.archerPositions ?? []).entries()) {
    const anchor = new Group();
    anchor.name = `archer_position_${index}`;
    anchor.position.set(...position);
    root.add(anchor);
  }
  const rotationTrack = (name: string, axis: Vector3, times: number[], angles: number[]) =>
    new QuaternionKeyframeTrack(
      `${name}.quaternion`,
      times,
      angles.flatMap((angle) => new Quaternion().setFromAxisAngle(axis, angle).toArray())
    );
  const doorClip = createRomanEntranceAnimation(recipe, rotationTrack, balconyDoor ? balconyAnchor!.yaw : undefined);
  const stages = root.children.filter((child) => child.name.startsWith("construction_"));
  const tracks = romanConstructionTracks(stages as Group[]);
  const hiddenDuringConstruction = [door, mechanism, banner];
  if (furnaceEffects) hiddenDuringConstruction.push(furnaceEffects.root);
  if (mineLight) hiddenDuringConstruction.push(mineLight.root);
  if (harborBeacon) hiddenDuringConstruction.push(harborBeacon.root);
  if (playerFlag) hiddenDuringConstruction.push(playerFlag.root);
  if (balconyDoor) hiddenDuringConstruction.push(balconyDoor);
  for (const child of hiddenDuringConstruction)
    tracks.push(
      new VectorKeyframeTrack(
        `${child.name}.scale`,
        [0, 8.9, 9],
        [0, 0, 0, 0, 0, 0, 1, 1, 1],
        InterpolateDiscrete
      )
    );
  const constructionClip = new AnimationClip("construction", 9, tracks);
  const workingTracks = [
    rotationTrack(
      "activity_banner",
      new Vector3(0, 0, 1),
      [0, 0.5, 1, 1.5, 2],
      [0, 0.06, 0, -0.06, 0]
    )
  ];
  workingTracks.push(...drinkTools.tracks);
  if (furnaceEffects) workingTracks.push(...furnaceEffects.tracks);
  if (mineLight) workingTracks.push(...mineLight.tracks);
  if (harborBeacon) workingTracks.push(...harborBeacon.tracks);
  if ([26, 32].includes(definition.id)) workingTracks.push(...industryTracks(definition.id));
  else if (definition.mechanism === "wheel")
    workingTracks.push(
      rotationTrack(
        "mechanism",
        new Vector3(0, 0, 1),
        [0, 0.5, 1, 1.5, 2],
        [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]
      )
    );
  else if (definition.mechanism === "crane")
    workingTracks.push(rotationTrack("mechanism", new Vector3(0, 1, 0), [0, 1, 2], [0, 0.25, 0]));
  else if (["saw", "pump", "press"].includes(definition.mechanism) || definition.id === 25) {
    const [x, y, z] = recipe.mechanism;
    const track = new VectorKeyframeTrack(
      "mechanism.position",
      [0, 0.5, 1, 1.5, 2],
      [x, y, z, x, y + 0.06, z, x, y, z, x, y - 0.06, z, x, y, z]
    );
    const workingClip = new AnimationClip("working", recipe.drinkNation ? 4 : 2, [...workingTracks, track]);
    root.animations = [constructionClip, doorClip, workingClip];
  } else if (definition.mechanism !== "none")
    workingTracks.push(rotationTrack("mechanism", new Vector3(0, 0, 1), [0, 1, 2], [0, 0.3, 0]));
  const workingClip = root.animations[2] ?? new AnimationClip("working", recipe.drinkNation ? 4 : 2, workingTracks);
  root.animations = [constructionClip, doorClip, workingClip];
  if (well) root.animations[2] = well.clip;
  if (playerFlag) root.animations.push(playerFlag.clip);
  const catapultGround = definition.id === 16 ? createCatapultGroundStock(detailed,
    getRomanBuildingWorldSizing(definition).scale, materials) : undefined;
  if (catapultGround) root.add(catapultGround.root);
  const disposeRoofBundles = definition.id === 16 ? attachCatapultRoofBundles(root, detailed) : undefined;
  const hunterCords = definition.id === 22 ? createRomanHunterCordWind(root) : undefined;
  const hangingDecor = Boolean(root.getObjectByName(HANGING_DECOR));
  if (hunterCords) root.animations.push(hunterCords.clip);
  root.userData = buildingMetadata(definition, recipe);
  root.userData.gridPlacement = getRomanGridPlacement(definition, mechanism);
  let workElapsed = 0,
    lastTime: number | undefined;
  const constructionDeck = root.getObjectByName("construction_deck") as Mesh | undefined;
  const deckMaterials = constructionDeck?.userData.deckMaterials as
    { construction: MeshStandardMaterial; finished: MeshStandardMaterial } | undefined;
  let deckFinished = false;
  const update = (
    time: number,
    state: Pick<
      BuildingFrame,
      | "catapultCycle"
      | "catapultAim"
      | "catapultSupply"
      | "catapultGroundPoints"
      | "catapultRackKinds"
      | "construction"
      | "door"
      | "doorLeaves"
      | "working"
      | "workTime"
      | "workRate"
      | "pigFeedPhase"
      | "wellBucketTaken"
      | "playerColor"
      | "windStrength"
      | "windDirection"
      | "balconyDoor"
      | "outputStock"
      | "inputStock"
    > & Partial<Pick<BuildingFrame, "x" | "y" | "z" | "rotation">>,
    flagPhase = 0
  ) => {
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(0.1, time - lastTime));
    lastTime = time;
    const progress = Math.max(0, Math.min(1, state.construction));
    pigs?.update(time,progress===1,state.pigFeedPhase,state.workTime);
    if (hangingDecor) updateHangingDecorSway(time, state.windStrength);
    hunterCords?.update(time + flagPhase, state.outputStock === undefined ? 6 : state.outputStock.meat ?? 0,
      state.windStrength, state.windDirection);
    updateRomanConstruction(stages as Group[], progress);
    if (constructionDeck && deckMaterials) {
      const finished = progress === 1;
      if (finished !== deckFinished) {
        constructionDeck.material = finished ? deckMaterials.finished : deckMaterials.construction;
        deckFinished = finished;
      }
    }
    const rackCount = definition.id === 16
      ? catapultRackCount({ input: state.inputStock ?? {}, catapultCycle: state.catapultCycle }) : 0;
    const stockInput = definition.id === 16
      ? { ...state.inputStock, stone: Math.max(state.inputStock?.stone ?? 0, rackCount) } : state.inputStock;
    stockModels.update(stockInput, state.outputStock);
    catapultGround?.update(state);
    root.traverse((object) => {
      if (object.userData.pigFeedSurface === "water") {
        const normalMap = (object as Mesh).material as MeshStandardMaterial;
        normalMap.normalMap?.offset.set(time * .008, time * .005);
      }
      if(object.userData.pigFeedSurface) object.visible=progress===1 && (state.pigFeedPhase===undefined ||
        object.userData.pigFeedSurface==="grain" && ["grain","water","breeding"].includes(state.pigFeedPhase??"") ||
        object.userData.pigFeedSurface==="water" && ["water","breeding"].includes(state.pigFeedPhase??""));
      updateCatapultMesh(object, state.catapultCycle, state.catapultAim ?? CATAPULT_HOME_YAW, progress, state.catapultSupply);
      if (definition.id === 16 && object.userData.catapultPart === "loaded") {
        tintCatapultObject(object, state.catapultCycle?.ammoKind);
        presentCatapultShot(object, state.catapultCycle?.ammoKind);
      }
      const stock = object.userData.stock as BuildingPart["stock"];
      if (!stock || object.userData.canonicalStock) return;
      const inventory = stock.kind === "input" ? state.inputStock : state.outputStock;
      const count = stock.wares ? stock.wares.reduce((total, ware) => total + (inventory?.[ware] ?? 0), 0)
        : inventory?.[stock.ware] ?? 0;
      if (definition.id === 16 && stock.kind === "input" && stock.ware === "stone") {
        const kind = state.catapultRackKinds?.[stock.slot];
        tintCatapultObject(object, kind);
        presentCatapultShot(object, kind);
        object.visible = inventory === undefined || stock.slot < rackCount; return;
      }
      object.visible = inventory === undefined || stock.slot < Math.max(0, count);
    });
    door.visible = progress === 1 && !recipe.hideDoor && definition.style !== "well";
    const opening = Math.max(0, Math.min(1, state.door));
    if (recipe.doubleDoor) updateStorageDoubleDoor(door, state.doorLeaves ?? [opening, opening]);
    else if (recipe.tentDoor) updateTentDoor(door, opening);
    else door.rotation.y = -opening * Math.PI / 2;
    mechanism.visible = progress === 1 && (definition.id !== 32 || state.working);
    banner.visible = progress === 1;
    if (balconyDoor) {
      balconyDoor.visible = progress === 1;
      const balconyOpening = Math.max(0, Math.min(1, state.balconyDoor ?? state.door));
      if (recipe.tentDoor) {
        updateTentDoor(balconyDoor, balconyOpening);
        balconyDoor.rotation.y = balconyAnchor?.yaw ?? 0;
      } else balconyDoor.rotation.y = (balconyAnchor?.yaw ?? 0) - balconyOpening * 1.45;
    }
    if (playerFlag) {
      playerFlag.root.visible = progress === 1;
      playerFlag.update(time + flagPhase, state.windStrength, state.windDirection, state.playerColor);
    }
    if (state.working && progress === 1) workElapsed += delta * (state.workRate ?? 1);
    drinkTools.update(state.workTime ?? workElapsed);
    furnaceEffects?.update(workElapsed, state.working && progress === 1);
    mineLight?.update(workElapsed, state.working && progress === 1);
    harborBeacon?.update(time, progress === 1);
    banner.rotation.z = state.working ? Math.sin(workElapsed * 3) * 0.05 : 0;
    if ([26, 32].includes(definition.id)) updateIndustry(mechanism, definition.id, workElapsed);
    else if (definition.id === 25)
      mechanism.position.y = recipe.mechanism[1] + Math.sin(workElapsed * 5) * 0.045;
    else if (well) well.update(state.workTime ?? workElapsed, time,
      state.workTime !== undefined && state.workTime >= WELL_CYCLE_SECONDS, state.wellBucketTaken, state.working);
    else if (definition.mechanism === "wheel") mechanism.rotation.z = workElapsed * 1.2;
    else if (definition.mechanism === "crane") mechanism.rotation.y = Math.sin(workElapsed) * 0.25;
    else if (
      definition.mechanism === "saw" ||
      definition.mechanism === "pump" ||
      definition.mechanism === "press"
    )
      mechanism.position.y = recipe.mechanism[1] + Math.sin(workElapsed * 5) * 0.06;
    else mechanism.rotation.z = Math.sin(workElapsed * 4) * 0.3;
  };
  const dispose = () => {
    root.userData.disposed = true;
    catapultGround?.dispose();
    disposeRoofBundles?.();
    stockModels.dispose();
    pigs?.dispose();
    playerFlag?.dispose();
    well?.dispose();
    root.traverse(disposeBuildingObject);
  };
  /** All drawn geometry, or (false) only the static building that its triangle budget covers. */
  const triangles = (includeDynamic = true) => {
    let count = 0;
    root.traverse((object) => {
      if (object instanceof Mesh && (includeDynamic || !isDynamicBuildingGeometry(object)))
        count += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3;
    });
    return count;
  };
  // Explicit axis metadata for downstream GLB pipelines.
  root.userData.upAxis = [0, 1, 0];
  const fitToGrid = () => root.scale.setScalar(root.userData.gridPlacement.scale);
  return { root, update, dispose, triangles, recipe, fitToGrid };
};
