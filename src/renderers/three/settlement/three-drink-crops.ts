import { Euler, Group, type IUniform, Matrix4, Quaternion, Vector3 } from "three";

import { HIVE_BENCH_TOP, HIVE_EKE_HEIGHT } from "../../../render-common/props/drink-crops/beehive-mesh";
import { COCONUT_FALLEN_GROUPS, COCONUT_TINTS } from "../../../render-common/props/drink-crops/coconut-palm-mesh";
import {
  createDrinkCropMesh, getPalmCrownHeight, getPalmGrowthDraw
} from "../../../render-common/props/drink-crops/drink-crop-meshes";
import {
type DrinkCropFrame,
  getHiveVisual, getPalmVisual, getRiceVisual, getVineVisual, ripenTint} from "../../../render-common/props/drink-crops/drink-crop-stages";
import { VINE_TINTS, VINE_VARIANTS } from "../../../render-common/props/drink-crops/grapevine-mesh";
import { RICE_TINTS } from "../../../render-common/props/drink-crops/rice-mesh";
import { getNationalDrinkPlantStage } from "../../../render-common/props/drink-crops/national-drink-plants";
import { plantationPropWeight } from "../../../render-common/workers/plantation-prop-cycle";
import type { WorkerFrame } from "../../../render-common/workers/worker-unit";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import type { WorldData } from "../../../shared/world/world-data";
import { plantationHandPose } from "../worker-plantation-contact";
import { createPlacedPropLayers } from "./placed-prop-layers";
import { createThreeHarvestGrapes } from "./three-harvest-grapes";
import { createThreeHiveBees } from "./three-hive-bees";
import { createThreeHiveCombs } from "./three-hive-combs";
import { createThreePaddyBeds } from "./three-paddy-beds";

const UP = new Vector3(0, 1, 0);
/** Share of the coconuts' drop spent falling; the rest is their bounce on the ground. */
const LANDING = 0.7;
const matrix = new Matrix4(), rotation = new Quaternion(), position = new Vector3(), size = new Vector3();

/** Stable per-site variety: yaw quarter turns (vines keep their rows straight) and wind phase. */
const siteHash = (id: number) => ((id * 2654435761) >>> 0) / 4294967296;

const place = (x: number, y: number, z: number, yaw: number, scale = 1, stretch = scale) => {
  rotation.setFromAxisAngle(UP, yaw);
  return matrix.compose(position.set(x, y, z), rotation, size.set(scale, stretch, scale));
};

/**
 * The nation drink crops in the world: Roman trellised vines, Japanese flooded rice paddies,
 * Viking skep hives with bees and Nubian coconut palms. Meshes are built once per stage and drawn
 * instanced with the vegetation material (shared wind, light, fog, shadows); the CPU only places
 * the visible instances, all motion runs in the vertex shaders. Minimal uses simpler meshes,
 * no bees and still paddy water.
 */
export const createThreeDrinkCrops = (
  world: WorldData, uniforms: Record<string, IUniform>, detailed: boolean
) => {
  const group = new Group(); group.name = "drink_crops";
  const layers = createPlacedPropLayers(uniforms, detailed, key => createDrinkCropMesh(key, detailed));
  const paddies = createThreePaddyBeds(uniforms, detailed);
  const bees = detailed ? createThreeHiveBees(uniforms) : null;
  const combs = createThreeHiveCombs(detailed);
  const grapes = createThreeHarvestGrapes(detailed);
  const handsBySite = new Map<number, WorkerFrame>();
  const inspectionTilt = new Quaternion().setFromEuler(new Euler(-.35, 0, 0));
  const combRotation = new Quaternion();
  const heldMatrix = new Matrix4(), heldPosition = new Vector3(), heldRotation = new Quaternion();
  group.add(layers.group, paddies.group, combs.mesh, combs.remaining, combs.held, grapes.mesh);
  if (bees) group.add(bees.mesh);

  /** Paddy cells of this frame: neighbouring paddies share one dike. */
  const paddyCells = new Set<number>();
  const cellKey = (x: number, z: number) => z * 65536 + x;
  const ground = (frame: DrinkCropFrame) => sampleSmooth(world, world.heights, frame.x, frame.z);

  const drawHeldGrapes = (frame: DrinkCropFrame) => {
    if (frame.harvest === undefined) return;
      const worker = handsBySite.get(frame.id), hands = worker && plantationHandPose(worker);
      if (!worker || !hands || worker.action !== "pick_grapes") return;
      const weight = plantationPropWeight(worker.action, worker.animationTime);
      if (weight <= 0) return;
      heldMatrix.compose(hands.position, hands.rotation, size.setScalar(weight));
      grapes.push(heldMatrix);
  };

  const drawVine = (frame: DrinkCropFrame, y: number, hash: number) => {
    drawHeldGrapes(frame);
    const visual = getVineVisual(frame), yaw = hash > 0.5 ? Math.PI : 0;
    layers.push("vine-trellis", place(frame.x, y, frame.z, yaw), hash);
    const variant = Math.floor(hash * 7919) % VINE_VARIANTS;
    layers.push(`vine-plant-${visual.plant}-${variant}`, place(frame.x, y, frame.z, yaw, 0.94 + hash * 0.12), hash);
    if (!visual.bunches) return;
    const tint = ripenTint(VINE_TINTS, visual.ripeness);
    for (let vine = 0; vine < visual.bunchVines; vine += 1)
      layers.push(`vine-bunch-${visual.bunches}-${vine}`, place(frame.x, y, frame.z, yaw), hash, tint);
  };

  const drawRice = (frame: DrinkCropFrame, y: number, hash: number) => {
    const visual = getRiceVisual(frame);
    const cellX = Math.floor(frame.x), cellZ = Math.floor(frame.z);
    paddies.push(frame.x, y, frame.z, visual.flooded, {
      east: paddyCells.has(cellKey(cellX + 1, cellZ)), north: paddyCells.has(cellKey(cellX, cellZ - 1)),
      south: paddyCells.has(cellKey(cellX, cellZ + 1)), west: paddyCells.has(cellKey(cellX - 1, cellZ))
    });
    layers.push(`rice-${visual.stage}`, place(frame.x, y + 0.02, frame.z, Math.floor(hash * 4) * Math.PI / 2), hash,
      visual.stage === "heading" ? ripenTint(RICE_TINTS, visual.ripeness) : undefined);
  };

  const drawHive = (frame: DrinkCropFrame, y: number, hash: number) => {
    const visual = getHiveVisual(frame), yaw = hash * Math.PI * 2;
    layers.push("hive-stand", place(frame.x, y, frame.z, yaw), hash);
    const skepBase = y + HIVE_BENCH_TOP;
    // The ekes come off with the lifted skep, so the cut combs stand free on the bench.
    for (let eke = 0; eke < (visual.open ? 0 : visual.ekes); eke += 1)
      layers.push("hive-eke", place(frame.x, skepBase + eke * HIVE_EKE_HEIGHT, frame.z, yaw), hash);
    const entrance = skepBase + visual.ekes * HIVE_EKE_HEIGHT;
    if (visual.open) {
      // The beekeeper set the skep down beside the bench and cuts the combs on it.
      const side = new Vector3(0.32, 0, 0).applyAxisAngle(UP, yaw);
      layers.push("hive-skep", place(frame.x + side.x, y, frame.z + side.z, yaw + 0.6), hash);
      const worker = handsBySite.get(frame.id), hands = worker && plantationHandPose(worker);
      const weight = worker ? plantationPropWeight(worker.action, worker.animationTime) : 0;
      if (hands && worker?.action === "lift_honeycomb" && weight > 0) {
        heldPosition.set(frame.x, skepBase + .24, frame.z).lerp(hands.position, weight);
        combRotation.copy(hands.rotation).multiply(inspectionTilt);
        heldRotation.setFromAxisAngle(UP, yaw + Math.PI / 2).slerp(combRotation, weight);
        heldMatrix.compose(heldPosition, heldRotation, size.set(1, 1, 1));
        combs.pushHeld(place(frame.x, skepBase, frame.z, yaw), heldMatrix);
      } else combs.push(place(frame.x, skepBase, frame.z, yaw));
    } else layers.push("hive-skep", place(frame.x, entrance, frame.z, yaw), hash);
    if (visual.honeyRun) layers.push("hive-drip", place(frame.x, entrance, frame.z, yaw), hash);
    bees?.push(frame.x, skepBase + 0.05, frame.z, visual.bees, frame.id);
  };

  /**
   * The palm (shaken on the GPU by the prop shader's rattle while the grower shakes it), its
   * coconuts on the crown, falling with a bounce, then lying on the ground until gathered.
   */
  const drawPalm = (frame: DrinkCropFrame, y: number, hash: number) => {
    const visual = getPalmVisual(frame), yaw = hash * Math.PI * 2;
    const tree = getPalmGrowthDraw(visual.growth), tint = ripenTint(COCONUT_TINTS, visual.ripeness);
    layers.push(`palm-tree-${tree.stage}`, place(frame.x, y, frame.z, yaw, tree.scale), hash, undefined, visual.shake);
    if (visual.drop !== null && visual.drop >= LANDING) {
      const bounce = Math.abs(Math.sin((visual.drop - LANDING) / (1 - LANDING) * Math.PI * 2)) * 0.05 *
        (1 - visual.drop);
      for (let group = 0; group < COCONUT_FALLEN_GROUPS; group += 1)
        layers.push(`palm-fallen-${group}`, place(frame.x, y + bounce, frame.z, yaw), hash, tint);
      return;
    }
    const fall = visual.drop === null ? 0 : getPalmCrownHeight() * (visual.drop / LANDING) ** 2;
    if (visual.fruit)
      layers.push(`palm-fruit-${visual.fruit}`, place(frame.x, y - fall, frame.z, yaw), hash, tint, visual.shake);
    for (let group = 0; group < visual.fallen; group += 1)
      layers.push(`palm-fallen-${group}`, place(frame.x, y, frame.z, yaw), hash, tint);
  };

  const DRAW: Record<string, (frame: DrinkCropFrame, y: number, hash: number) => void> = {
    tea: (frame, y, hash) => layers.push(`tea-${getNationalDrinkPlantStage(frame)}`,
      place(frame.x, y, frame.z, hash * Math.PI * 2), hash),
    pomegranate: (frame, y, hash) => layers.push(`pomegranate-${getNationalDrinkPlantStage(frame)}`,
      place(frame.x, y, frame.z, hash * Math.PI * 2), hash),
    cacao: (frame, y, hash) => layers.push(`cacao-${getNationalDrinkPlantStage(frame)}`,
      place(frame.x, y, frame.z, hash * Math.PI * 2), hash),
    berries: (frame, y, hash) => layers.push(`berries-${getNationalDrinkPlantStage(frame)}`,
      place(frame.x, y, frame.z, hash * Math.PI * 2), hash),
    hive: drawHive, palm: drawPalm, rice: drawRice, vine: drawVine
  };

  /** Draws every drink crop site of the frame (other kinds are ignored). */
  const update = (frames: readonly DrinkCropFrame[], time: number, workers: readonly WorkerFrame[] = []) => {
    layers.begin(); paddies.begin(); bees?.begin(); combs.begin(); grapes.begin();
    handsBySite.clear();
    for (const worker of workers) {
      if (worker.visible === false || worker.plantationSiteId === undefined ||
        !plantationHandPose(worker)) continue;
      handsBySite.set(worker.plantationSiteId, worker);
    }
    paddyCells.clear();
    for (const frame of frames) if (frame.kind === "rice") paddyCells.add(cellKey(Math.floor(frame.x), Math.floor(frame.z)));
    for (const frame of frames) DRAW[frame.kind]?.(frame, ground(frame), siteHash(frame.id));
    layers.commit(); paddies.commit(); bees?.commit(); combs.commit(); grapes.commit();
  };
  const dispose = () => { layers.dispose(); paddies.dispose(); bees?.dispose(); combs.dispose(); grapes.dispose(); handsBySite.clear(); group.clear(); };
  return { casters: layers.casters, dispose, group, update };
};
