import { DirectionalLight, Group, type IUniform, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";

import { type EnvironmentState,getSunLightOffset } from "../../../render-common/environment";
import type { QualityLevel } from "../../../render-common/quality";
import type { RoadPreview, RoadSegment, RoadTier, RoadWorld } from "../../../shared/settlement/road-types";
import { ROAD_TIERS } from "../../../shared/settlement/road-types";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import { connectSunShadowReceivers } from "../buildings/building-shadows";
import { createSkyLightProbe } from "../sky-light-probe";
import { createRoadGeometry } from "./road-geometry";
import { createRoadMaterial, type RoadRutUniforms } from "./road-materials";

/**
 * `shadowUniforms`: the island sun map (sun shadow presets only); the road surfaces and edge
 * stones then receive tree, building and unit shadows like the ground beneath them (R02).
 * `ruts`: the traffic-wear field for dirt ruts and faint paved cart grooves (detailed roads only).
 */
export const createThreeRoads = (
  world: RoadWorld,
  quality: QualityLevel,
  getHeight = (x: number, z: number) => sampleSmooth(world, world.heights, x, z),
  shadowUniforms?: Record<string, IUniform>,
  ruts?: RoadRutUniforms
) => {
  const root = new Group();
  root.name = "settlement_roads";
  const surfaces = new Group(), previews = new Group();
  previews.name = "settlement_road_preview";
  const previewMaterial = new MeshBasicMaterial({ color: "#c7ec98", depthWrite: false,
    opacity: .65, transparent: true, vertexColors: true });
  let previousPreview: RoadPreview | null = null;
  const clearPreview = () => {
    for (const child of Array.from(previews.children)) {
      (child as Mesh).geometry.dispose(); child.removeFromParent();
    }
  };
  const sky = createSkyLightProbe();
  const sun = new DirectionalLight(0xfff1dd, 2.3);
  sun.position.set(4, 8, 3);
  root.add(surfaces, previews, sky.probe, sun, sun.target);
  const detailed = quality !== "minimal";
  const materials = Object.fromEntries(ROAD_TIERS.map(tier => [tier, createRoadMaterial(tier, detailed,
    detailed ? ruts : undefined)])) as Record<RoadTier, MeshStandardMaterial>;
  const pebbleMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 });
  if (shadowUniforms) connectSunShadowReceivers([...Object.values(materials), pebbleMaterial], shadowUniforms);
  const update = (segments: RoadSegment[]) => {
    for (const child of Array.from(surfaces.children)) {
      (child as Mesh).geometry.dispose();
      child.removeFromParent();
    }
    const height = getHeight;
    for (const tier of ROAD_TIERS) {
      if (!segments.some((segment) => segment.tier === tier)) continue;
      const mesh = new Mesh(
        createRoadGeometry(segments, tier, detailed, height, false, geometry => {
          if (!geometry.index?.count) { geometry.dispose(); return; }
          const pebbles = new Mesh(geometry, pebbleMaterial);
          pebbles.name = tier !== "dirt" ? `${tier}_road_edge_blocks` : "dirt_road_edge_pebbles";
          pebbles.receiveShadow = detailed;
          surfaces.add(pebbles);
        }),
        materials[tier]
      );
      mesh.name = `${tier}_roads`;
      mesh.receiveShadow = detailed;
      surfaces.add(mesh);
    }
  };
  const updatePreview = (preview: RoadPreview | null = null) => {
    if (preview === previousPreview) return;
    previousPreview = preview; clearPreview();
    if (!preview?.valid) return;
    const segments = preview.contextSegments ?? preview.segments.map(segment => ({ ...segment, preview: true }));
    for (const tier of ROAD_TIERS) {
      if (!segments.some(segment => segment.preview && segment.tier === tier)) continue;
      const mesh = new Mesh(createRoadGeometry(segments, tier, detailed,
        (x, z) => getHeight(x, z) + .045, true), previewMaterial);
      mesh.name = `${tier}_road_preview`; mesh.renderOrder = 3; previews.add(mesh);
    }
  };
  const updateEnvironment = (environment: EnvironmentState) => {
    sky.update(environment);
    sun.color.fromArray(environment.sunColor);
    const [x, y, z] = getSunLightOffset(environment.sun, 10);
    sun.position.set(sun.target.position.x + x, sun.target.position.y + y, sun.target.position.z + z);
  };
  const dispose = () => {
    update([]); clearPreview(); previewMaterial.dispose(); pebbleMaterial.dispose();
    for (const material of Object.values(materials)) {
      material.map?.dispose();
      material.bumpMap?.dispose();
      material.dispose();
    }
    root.removeFromParent();
  };
  return { dispose, root, update, updateEnvironment, updatePreview };
};
