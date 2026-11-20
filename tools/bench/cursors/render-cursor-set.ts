import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { CURSOR_CATALOG } from "./cursor-catalog";
import { createCursorMaterials, CURSOR_PIXELS, HOTSPOT_MARKER } from "./cursor-kit";
import { cursorPixels, downscale, finishCursor } from "./cursor-post";

/** Supersampled render size: 8x the @2x cursor, so the box-filtered result stays sharp at 32 and 64 px. */
const RENDER_SIZE = 512;

export interface RenderedCursor {
  /** Hotspot in 1x pixels (CSS `cursor: url() x y`). */
  hotspot: readonly [number, number];
  /** Straight RGBA bytes (base64), 32 px and 64 px. */
  pixels: Record<"1x" | "2x", string>;
  /** Canvas PNG (base64), 32 px and 64 px: the visual baselines compare these. */
  png: Record<"1x" | "2x", string>;
}

const createStudio = (renderer: THREE.WebGLRenderer) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04).texture;
  room.dispose(); pmrem.dispose();
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = .8;
  scene.add(new THREE.HemisphereLight("#fff3dc", "#4a3d33", .3));
  const key = new THREE.DirectionalLight("#fff1d6", 1.15);
  key.position.set(-4, 6, 7);
  const rim = new THREE.DirectionalLight("#cfe4ff", 2.6);
  rim.position.set(6, -3, -1.5);
  const fill = new THREE.DirectionalLight("#ffd9a8", .3);
  fill.position.set(3, -2, 6);
  scene.add(key, rim, fill);
  return { environment, scene };
};

const projectHotspot = (root: THREE.Object3D, camera: THREE.Camera) => {
  const point = root.getObjectByName(HOTSPOT_MARKER)!.getWorldPosition(new THREE.Vector3()).project(camera);
  const half = CURSOR_PIXELS / 2;
  return [Math.round((point.x + 1) * half), Math.round((1 - point.y) * half)] as const;
};

const disposeTree = (root: THREE.Object3D) =>
  root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });

/** Renders every cursor of the catalogue (or `only` these names) to finished 32 px / 64 px images. */
export const renderCursorSet = (only?: readonly string[]) => {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(RENDER_SIZE, RENDER_SIZE);
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.OrthographicCamera(0, CURSOR_PIXELS, 0, -CURSOR_PIXELS, -50, 50);
  const materials = createCursorMaterials();
  const { environment, scene } = createStudio(renderer);
  const result: Record<string, RenderedCursor> = {};
  const renderLayer = (layer: THREE.Object3D) => {
    scene.add(layer);
    layer.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const images = { large: downscale(renderer.domElement, CURSOR_PIXELS * 2), small: downscale(renderer.domElement,
      CURSOR_PIXELS) };
    const hotspot = layer.getObjectByName(HOTSPOT_MARKER) && projectHotspot(layer, camera);
    scene.remove(layer);
    disposeTree(layer);
    return { hotspot, images };
  };
  for (const entry of CURSOR_CATALOG) {
    if (only && !only.includes(entry.name)) continue;
    const layers = entry.layers(materials).map(renderLayer);
    const hotspot = layers.find(layer => layer.hotspot)?.hotspot;
    if (!hotspot) throw new Error(`${entry.name} has no hotspot marker`);
    const small = finishCursor(layers.map(layer => layer.images.small), 1);
    const large = finishCursor(layers.map(layer => layer.images.large), 2);
    result[entry.name] = {
      hotspot,
      pixels: { "1x": cursorPixels(small), "2x": cursorPixels(large) },
      png: { "1x": small.toDataURL("image/png").split(",")[1]!, "2x": large.toDataURL("image/png").split(",")[1]! }
    };
  }
  for (const material of Object.values(materials)) material.dispose();
  environment.dispose();
  renderer.dispose();
  return result;
};
