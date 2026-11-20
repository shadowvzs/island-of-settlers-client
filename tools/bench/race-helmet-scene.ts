import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, DirectionalLight, type Group,
  HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PMREMGenerator, Scene,
  SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer
} from "three";

import { fitEliteHelmetIcon, loadEliteHelmetIcon } from "./race-helmet-elite";
import { nubianHeadband } from "./race-helmet-headband";
import { japaneseHelmet, romanHelmet, vikingHelmet } from "./race-helmet-models";
import type { RaceHelmetIconOptions } from "./race-helmet-types";

/** Browser side of tools/bench/race-helmet-icons.ts: renders each nation's helmet to a PNG data URL. */

const SIZE = 256;
/** Every helmet shares one turn and one camera, so the icons read as a consistent set. */
const HELMET_YAW = -0.2;
const HELMETS: Record<string, () => Group> = {
  japanese: japaneseHelmet, nubian: nubianHeadband, roman: romanHelmet, viking: vikingHelmet
};

/** Studio reflections for the metal: a warm sky dome with three soft boxes. */
const createStudio = (renderer: WebGLRenderer) => {
  const studio = new Scene();
  studio.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: "#6d6359", side: BackSide })));
  for (const [x, y, z, width, height, color] of [[-6, 8, 6, 8, 3, "#fff3dc"], [7, 3, 2, 2, 7, "#cfe2ff"],
    [0, -6, 4, 12, 1, "#7a6248"], [0, 9, -2, 10, 4, "#fff8ea"]] as const) {
    const box = new Mesh(new BoxGeometry(width, height, 0.2), new MeshBasicMaterial({ color }));
    box.material.color.multiplyScalar(4);
    box.position.set(x, y, z);
    box.lookAt(0, 0, 0);
    studio.add(box);
  }
  return new PMREMGenerator(renderer).fromScene(studio, 0.03).texture;
};

const createLights = (scene: Scene) => {
  scene.add(new HemisphereLight("#fff4dc", "#3a3540", 1.1));
  const key = new DirectionalLight("#fff1da", 3.2);
  key.position.set(-3, 5, 5);
  const rim = new DirectionalLight("#a9d2ff", 2.4);
  rim.position.set(4, 3, -4);
  const fill = new DirectionalLight("#ffe6c2", 0.8);
  fill.position.set(3, -1, 4);
  scene.add(key, rim, fill);
};

/**
 * Three-quarter view from slightly above. Original helmets have their rim at y=0;
 * fitted elites retain this camera and fit their complete ornament silhouette to the icon extent.
 */
const FRAME_CENTRE = new Vector3(0, 0.66, 0);
const FRAME_RADIUS = 1.92;

const frame = (camera: PerspectiveCamera) => {
  const direction = new Vector3(0.42, 0.3, 1).normalize();
  const distance = FRAME_RADIUS / Math.sin((camera.fov * Math.PI) / 360);
  camera.position.copy(FRAME_CENTRE).addScaledVector(direction, distance);
  camera.lookAt(FRAME_CENTRE);
};

export const renderRaceHelmets = async (options: RaceHelmetIconOptions = {}) => {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const environment = createStudio(renderer);
  const camera = new PerspectiveCamera(28, 1, 0.1, 60);
  const result: Record<string, string> = {};
  for (const name of options.nations ?? Object.keys(HELMETS)) {
    const scene = new Scene();
    scene.environment = environment;
    createLights(scene);
    const source = options.elites?.[name];
    const helmet = source ? await loadEliteHelmetIcon(source) : HELMETS[name]!();
    helmet.rotation.y = HELMET_YAW;
    scene.add(helmet);
    frame(camera);
    if (source) fitEliteHelmetIcon(helmet, camera);
    renderer.render(scene, camera);
    result[name] = renderer.domElement.toDataURL("image/png").split(",")[1]!;
  }
  return result;
};
