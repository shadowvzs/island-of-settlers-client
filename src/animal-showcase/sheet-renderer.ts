import { OrthographicCamera, Scene, Vector3, WebGLRenderer } from "three";

import { computeEnvironment } from "../render-common/environment";
import { createNoiseTexture, NOISE_TEXTURE_SIZE } from "../render-common/noise-textures";
import {
  createSharedUniformValues,
  updateSharedUniformValues
} from "../render-common/shader-uniforms";
import { MODEL_LOD } from "../render-common/wildlife/model/animal-asset";
import type { AnimalModels } from "../render-common/wildlife/model/animal-asset-loader";
import { computeAnimalPose, createRestMotion } from "../render-common/wildlife/model/animal-pose";
import type { AnimalModel } from "../render-common/wildlife/model/animal-rig";
import { createAnimalVariants } from "../render-common/wildlife/model/animal-variants";
import { COAT_SPOTS } from "../render-common/wildlife/model/coat-spots";
import { createAnimalFrame } from "../render-common/wildlife/sim/animal-pool";
import type { AnimalTextures } from "../renderers/three/three-animal-material";
import {
  createAnimalLayer,
  createAnimalTextures,
  createFurTextureMap
} from "../renderers/three/three-animals";
import { createRepeatTexture, createThreeUniforms } from "../renderers/three/three-materials";
import { createSunShadows } from "../renderers/three/three-shadows";
import { DEFAULT_SUN } from "../shared/world/lighting";
import type { SheetCell, SheetRow } from "./sheet-layouts";

const VIEW_PIXELS = 520;
const CENTRE = 2;
const SHEET_HOUR = 12;
const NOISE_SEED = 77;
const SHADOW_MAP = 2048;
const MARGIN = 1.1;

/** Bounding box of a model in rest pose (x, y, z extents). */
const getBounds = (model: AnimalModel) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const { positions } = model.mesh;
  for (let index = 0; index < positions.length; index += 1) {
    min[index % 3] = Math.min(min[index % 3]!, positions[index]!);
    max[index % 3] = Math.max(max[index % 3]!, positions[index]!);
  }
  return { max, min };
};

/** Half extent of a row's framing: the largest animal of the row (true relative sizes). */
const getRowHalf = (row: SheetRow, model: (cell: SheetCell) => AnimalModel) => {
  let half = 0;
  for (const cell of row) {
    if (!cell) continue;
    const { max, min } = getBounds(model(cell));
    const extent = Math.max(max[0]! - min[0]!, max[1]!, max[2]! - min[2]!);
    half = Math.max(half, (extent / 2) * cell.scale);
  }
  return half * MARGIN;
};

/**
 * Orthographic reference sheets (same models, rig, fur material and sun shadows as the
 * game's close level of detail) on a transparent background: rows of cells, each one animal
 * variant in one view and pose; every animal in a row shares one scale (true sizes).
 */
export const createSheetRenderer = (
  canvas: HTMLCanvasElement,
  animals: AnimalModels,
  winter = false
) => {
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const values = createSharedUniformValues();
  const environment = computeEnvironment(DEFAULT_SUN, SHEET_HOUR, 0);
  updateSharedUniformValues(values, { environment, time: 0 });
  const shadows = createSunShadows(
    { cellsX: CENTRE * 2, cellsZ: CENTRE * 2 },
    { enabled: true, mapSize: SHADOW_MAP }
  );
  const uniforms = {
    ...createThreeUniforms(values),
    ...shadows.uniforms,
    uNoiseTexture: {
      value: createRepeatTexture(createNoiseTexture(NOISE_SEED), NOISE_TEXTURE_SIZE)
    }
  };
  const furTexture = createFurTextureMap();
  const textures = new Map<number, AnimalTextures>();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  const frame = createAnimalFrame(1);
  const variants = new Map<number, AnimalModel[]>();
  const layers = new Map<string, ReturnType<typeof createAnimalLayer>>();

  const getAnimal = (species: number) => {
    const animal = animals[species];
    if (!animal) throw new Error(`animal model of species ${species} is missing`);
    return animal;
  };

  const getModel = (cell: SheetCell) => {
    if (!variants.has(cell.species)) {
      const { asset } = getAnimal(cell.species);
      variants.set(cell.species, createAnimalVariants(cell.species, asset, MODEL_LOD.close, winter));
    }
    return variants.get(cell.species)![cell.variant]!;
  };

  const getTextures = (species: number) => {
    if (!textures.has(species)) {
      textures.set(species, createAnimalTextures(getAnimal(species), species, furTexture, true));
    }
    return textures.get(species)!;
  };

  const getLayer = (cell: SheetCell) => {
    const key = `${cell.species}:${cell.variant}`;
    if (!layers.has(key)) {
      const textures = getTextures(cell.species);
      const model = getModel(cell);
      layers.set(key, createAnimalLayer(model, uniforms, textures, COAT_SPOTS[cell.species]));
    }
    return layers.get(key)!;
  };

  /** One animal standing (or bedded) at the centre, in the cell's pose and size. */
  const writeAnimal = (cell: SheetCell) => {
    const motion = createRestMotion();
    motion.rest = cell.rest;
    motion.restHead = cell.restHead;
    motion.restKind = cell.restKind;
    motion.chew = 1.2;
    Object.assign(motion, cell.motion);
    frame.coat.fill(0);
    if (cell.appearance) {
      const look = cell.appearance;
      frame.coat.set([look.archetype, look.patchPattern, look.patchSeed, look.earDarkness]);
      motion.earLeft = look.earLeft;
      motion.earRight = look.earRight;
    }
    const lift = computeAnimalPose(cell.species, motion, frame.pose, 0);
    frame.count = 1;
    frame.x[0] = CENTRE;
    frame.y[0] = lift * cell.scale;
    frame.z[0] = CENTRE;
    frame.antlers[0] = cell.antlers;
    frame.scale[0] = cell.scale;
    frame.shade[0] = 1;
    frame.appear[0] = 1;
    frame.visibility[0] = 1;
  };

  const renderCell = (cell: SheetCell, column: number, row: number, rows: number, half: number) => {
    const layer = getLayer(cell);
    writeAnimal(cell);
    layer.write(0, frame, 0);
    layer.commit(1);
    shadows.scene.clear();
    shadows.scene.add(layer.caster);
    shadows.render(renderer, environment.sun, { radius: 2, x: CENTRE, z: CENTRE });
    renderer.setRenderTarget(null);
    const { max, min } = getBounds(getModel(cell));
    const direction = new Vector3(...cell.view).normalize();
    const target = new Vector3(
      CENTRE + ((max[0]! + min[0]!) / 2) * cell.scale,
      half * 0.85,
      CENTRE
    );
    camera.position.copy(target).addScaledVector(direction, 10);
    camera.lookAt(target);
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    values.uViewDirection.set([direction.x, direction.y, direction.z]);
    renderer.setViewport(
      column * VIEW_PIXELS,
      (rows - 1 - row) * VIEW_PIXELS,
      VIEW_PIXELS,
      VIEW_PIXELS
    );
    renderer.render(new Scene().add(layer.main), camera);
  };

  const render = (rows: SheetRow[]) => {
    const columns = Math.max(...rows.map((row) => row.length));
    renderer.setSize(VIEW_PIXELS * columns, VIEW_PIXELS * rows.length, false);
    renderer.setViewport(0, 0, VIEW_PIXELS * columns, VIEW_PIXELS * rows.length);
    renderer.clear();
    rows.forEach((row, rowIndex) => {
      const half = getRowHalf(row, getModel);
      row.forEach((cell, column) => {
        if (cell) renderCell(cell, column, rowIndex, rows.length, half);
      });
    });
  };

  return { render };
};
