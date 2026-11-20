import { type IUniform, OrthographicCamera, Scene, type WebGLRenderer } from "three";

import { coverGroundWeight } from "../../render-common/props/field-cover";
import type { FrameState, RendererInput } from "../../render-common/renderer-contract";
import { VERGE_MIN_COVER_GROUND } from "../../render-common/road-verges/road-verge-bands";
import { WORKER_ASSET_BASE } from "../../render-common/workers/worker-assets";
import type { BridgeSurfaceService } from "../../shared/settlement/bridge-surface";
import { sampleBilinear } from "../../shared/world/grid-geometry";
import type { createThreeBuildings } from "./buildings/three-buildings";
import { createPirateShipModels } from "./settlement/pirate-ship-models";
import { createShipClothWind, STATIC_SHIP_CLOTH } from "./settlement/ship-cloth-wind";
import { createShipInteraction } from "./settlement/ship-interaction";
import { createThreeAdventureCamps } from "./settlement/three-adventure-camps";
import { createThreeBridges } from "./settlement/three-bridges";
import { createThreeCombatEffects } from "./settlement/three-combat-effects";
import { createThreeSettlementFields } from "./settlement/three-fields";
import { createThreeFishingBoats } from "./settlement/three-fishing-boats";
import { createThreeHandcarts } from "./settlement/three-handcarts";
import { createThreeHarbourShuttles } from "./settlement/three-harbour-shuttles";
import { createThreeRallyBanner } from "./settlement/three-rally-banner";
import { createThreeRoadDecorations } from "./settlement/three-road-decorations";
import { createThreeRoadVerges } from "./settlement/three-road-verges";
import { createThreeRoads } from "./settlement/three-roads";
import { createThreeShipWakes } from "./settlement/three-ship-wakes";
import { createThreeSettlementShips } from "./settlement/three-ships";
import { createSmallBoatPeople } from "./settlement/three-small-boat-people";
import { createThreeTerritoryMarkers } from "./settlement/three-territory-markers";
import { createThreeTransportHorses } from "./settlement/three-transport-horses";
import { createCrowdLights } from "./three-worker";

/** Dirt-road ruts share the ground's traffic-wear uniform, so a field upload reaches both. */
const createRoadRutUniforms = (uniforms: Record<string, IUniform>) => ({ uTrafficWear: uniforms.uTrafficWear! });

type SettlementInput = Pick<RendererInput, "quality" | "world"> & {
  bridgeHeight: (x: number, z: number) => number | undefined;
  bridgeSurface: BridgeSurfaceService;
  groundHeight: (x: number, z: number) => number;
  renderer: WebGLRenderer;
  terrainHeight: (x: number, z: number) => number;
  scene: Scene;
  shadowScene: Scene;
  uniforms: Record<string, IUniform>;
  materialsFor: ReturnType<typeof createThreeBuildings>["materialsFor"];
};

/**
 * Settlement layers of the island scene: territory, roads, fields, combat, transport, camps and
 * ships, plus the separate smoke and camp scenes drawn after it.
 */
export const createRendererSettlement = ({
  bridgeHeight,
  bridgeSurface,
  groundHeight,
  materialsFor,
  quality,
  renderer,
  scene,
  shadowScene,
  terrainHeight,
  uniforms, world
}: SettlementInput) => {
  const territoryMarkers = createThreeTerritoryMarkers(
    uniforms, !quality.liteGround, quality.sunShadows ? shadowScene : undefined
  );
  scene.add(territoryMarkers.root);
  const roads = createThreeRoads(world, quality.liteGround ? "minimal" : "high", groundHeight,
    quality.sunShadows ? uniforms : undefined,
    quality.trafficWear ? createRoadRutUniforms(uniforms) : undefined);
  const waterSurface = (world as { waterSurface?: Float32Array }).waterSurface;
  const waterHeight = waterSurface
    ? (x: number, z: number) => sampleBilinear(world, waterSurface, x, z)
    : () => world.seaLevel;
  const bridges = createThreeBridges({
    detailed: !quality.liteGround,
    materialsFor,
    revision: () => world.terrainRevision ?? 0,
    shadowScene: quality.sunShadows ? shadowScene : undefined,
    surface: bridgeSurface,
    terrainHeight,
    waterHeight
  });
  let roadRevision = -1;
  let roadGroundRevision = -1, roadTerrainRevision = -1;
  scene.add(roads.root, bridges.root);
  const antialias = renderer.getContextAttributes()?.antialias ?? false;
  const decorationShadowScene = quality.sunShadows && quality.decorationShadows ? shadowScene : undefined;
  const roadDecorations = createThreeRoadDecorations(world, !quality.liteGround, materialsFor,
    undefined, uniforms, antialias, decorationShadowScene, quality.decorationWind);
  scene.add(roadDecorations.root, roadDecorations.ghostRoot);
  const roadVerges = createThreeRoadVerges({ antialias, budget: quality.roadVerges, detailed: !quality.liteGround,
    groundHeight, isBare: (x, z) => terrainHeight(x, z) < waterHeight(x, z) + .04 ||
      coverGroundWeight(world, x, z) < VERGE_MIN_COVER_GROUND, uniforms, world });
  scene.add(roadVerges.root);
  const civilianFields = createThreeSettlementFields(world, quality.liteGround ? "minimal" : "high", uniforms);
  if (civilianFields.casters && quality.sunShadows) shadowScene.add(civilianFields.casters);
  const combatEffects = createThreeCombatEffects(!quality.liteGround);
  const rallyBanner = createThreeRallyBanner(!quality.liteGround);
  scene.add(combatEffects.root, rallyBanner.root);
  const smokeScene = new Scene().add(combatEffects.smoke);
  const transportHorses = createThreeTransportHorses(renderer, bridgeHeight);
  const handcarts = createThreeHandcarts(!quality.liteGround, bridgeHeight);
  const adventureCamps = createThreeAdventureCamps(world, !quality.liteGround);
  // Camp canvas uses the same lit material environment as buildings, not the terrain shader scene.
  const adventureCampScene = new Scene().add(adventureCamps.root);
  const updateCampLights = createCrowdLights(adventureCampScene);
  const boatPeople = createSmallBoatPeople(!quality.liteGround);
  const compileCamera = new OrthographicCamera();
  // A craft built outside the view (or at a zoom that culls it) links its programs in the background,
  // not in the frame it first appears in (the first far zoom on the owner save: three programs).
  const shipCloth = quality.shipClothWind ? createShipClothWind() : STATIC_SHIP_CLOTH;
  const ships = createThreeSettlementShips(quality.liteGround ? "minimal" : "high", boatPeople,
    root => void renderer.compileAsync(root, compileCamera, scene).catch(() => undefined),
    shipCloth, createPirateShipModels(renderer, `${WORKER_ASSET_BASE}basis/`, !quality.liteGround, shipCloth));
  const shuttles = createThreeHarbourShuttles(!quality.liteGround, boatPeople);
  const fishingBoats = createThreeFishingBoats(!quality.liteGround, boatPeople, uniforms);
  scene.add(civilianFields.group, transportHorses.root, handcarts.root, ships.group, shuttles.group,
    fishingBoats.group);
  const shipInteraction = createShipInteraction(scene, ships.group);
  // R18a foam wakes; Minimal (budget 0) builds no layer at all.
  const wakes = quality.shipWakes > 0
    ? createThreeShipWakes(quality.shipWakes, uniforms, (x, z, out) => {
      out.height = waterHeight(x, z);
      out.depth = out.height - terrainHeight(x, z);
    })
    : null;
  if (wakes) scene.add(wakes.mesh);
  /** Rebuilds the road meshes only when the roads or the ground under them changed. */
  const syncRoads = (frame: FrameState) => {
    if (
      roadRevision !== (frame.roadRevision ?? 0) ||
      roadGroundRevision !== (world.buildRevision ?? 0) ||
      roadTerrainRevision !== (world.terrainRevision ?? 0)
    ) {
      roads.update(frame.roads ?? []);
      bridgeSurface.update(frame.roads ?? []);
      roadRevision = frame.roadRevision ?? 0;
      roadGroundRevision = world.buildRevision ?? 0;
      roadTerrainRevision = world.terrainRevision ?? 0;
    }
    bridges.update(frame.bridgeSites ?? []);
    bridges.setSelected(frame.selectedBridge ?? null);
  };
  return {
    boatPeople, adventureCamps, adventureCampScene, bridges, civilianFields, combatEffects, fishingBoats, handcarts,
    rallyBanner,
    roads, roadDecorations, roadVerges, shipInteraction, ships, shuttles, smokeScene, syncRoads, territoryMarkers,
    transportHorses, updateCampLights, wakes
  };
};

