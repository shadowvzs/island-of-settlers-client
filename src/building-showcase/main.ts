import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

import {
  BUILDING_CATALOG,
  getBuildingDefinition
} from "../render-common/buildings/building-catalog";
import { BUILDING_MENU } from "../render-common/buildings/building-menu";
import { BUILDING_LEVELS, buildingLevelOf } from "../render-common/buildings/levels/building-level";
import { MONUMENT_TYPE_ID } from "../render-common/buildings/monument-definition";
import { getNationBuildingDefinition } from "../render-common/buildings/nation-building-text";
import { NEUTRAL_BUILDING_IDS } from "../render-common/buildings/neutral-building-recipe";
import { createWorkyardReviewPrototype } from "../render-common/buildings/workyard-review-prototype";
import { isWorkerNation } from "../render-common/workers/worker-appearance";
import { prepareImportedPigTexture } from "../renderers/three/buildings/imported-pig";
import { buildingAssetReady } from "../renderers/three/buildings/monument-building";
import { createNationBuilding } from "../renderers/three/buildings/nation-building";
import { createNationBuildingMaterials } from "../renderers/three/buildings/nation-building-materials";
import { createNeutralBuilding } from "../renderers/three/buildings/neutral-building";
import { createNeutralBuildingMaterials } from "../renderers/three/buildings/neutral-building-materials";
import { createRomanBuilding } from "../renderers/three/buildings/roman-building";
import { createRomanMaterials } from "../renderers/three/buildings/roman-materials";
import { waitForAdvancedMaterialTextures } from "../renderers/three/settlement/advanced-material-assets";
import { createVillagePreviewGround } from "./ground";

import "./style.css";

const parameters = new URLSearchParams(location.search);
document.body.classList.toggle("sample", parameters.has("sample"));
const nationParameter = parameters.get("nation");
const readShowcaseNation = (value: string | null) => {
  if (value === "neutral") return "neutral";
  return isWorkerNation(value) ? value : "roman";
};
const nation = readShowcaseNation(nationParameter);
let level = buildingLevelOf(Number(parameters.get("level") ?? 1) - 1);
const detailed = parameters.get("quality") !== "minimal";
const scene = new Scene();
scene.background = new Color("#c6c9b9");
scene.fog = new Fog("#c6c9b9", 14, 35);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = detailed;
document.querySelector("#viewport")!.append(renderer.domElement);
const camera = new PerspectiveCamera(36, 1, 0.1, 60);
camera.position.set(4.5, 3.7, 5.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.maxDistance = 12;
controls.minDistance = 2;
scene.add(new HemisphereLight("#fff1d4", "#64744d", 2.4));
const sun = new DirectionalLight("#fff1dc", 3.2);
sun.position.set(-3, 7, 5);
sun.castShadow = detailed;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.normalBias = 0.025;
// Match the island's small light-depth offset: normal bias alone leaves acne in curved tile troughs.
sun.shadow.bias = -.04 / (sun.shadow.camera.far - sun.shadow.camera.near);
scene.add(sun);
const ground = createVillagePreviewGround();
scene.add(ground);
const baseMaterialPack = createRomanMaterials(detailed);
const createShowcaseMaterialPack = () => {
  if (nation === "neutral") return createNeutralBuildingMaterials(baseMaterialPack.materials);
  if (nation === "roman") return baseMaterialPack;
  return createNationBuildingMaterials(baseMaterialPack.materials, nation, detailed);
};
const materialPack = createShowcaseMaterialPack();
const createBuilding = (definition: Parameters<typeof createRomanBuilding>[0]) => {
  if (parameters.has("workyardReview") && nation !== "neutral") {
    const prototype = createWorkyardReviewPrototype(definition, nation, detailed, level);
    if (prototype) {
      const preview = createRomanBuilding(definition, materialPack.materials, detailed, prototype.recipe, nation);
      preview.root.userData.workyardReview = prototype.profile;
      return preview;
    }
  }
  if (nation === "neutral") return createNeutralBuilding(definition, materialPack.materials, detailed);
  return createNationBuilding(definition, materialPack.materials, nation, detailed, level);
};
let model: ReturnType<typeof createRomanBuilding>;
const selector = document.querySelector<HTMLSelectElement>("#building")!;
const levelSelector = document.querySelector<HTMLSelectElement>("#level")!;
const progress = document.querySelector<HTMLInputElement>("#progress")!;
const working = document.querySelector<HTMLInputElement>("#working")!;
const door = document.querySelector<HTMLInputElement>("#door")!;
const status = document.querySelector<HTMLElement>("#status")!;
const role = document.querySelector<HTMLElement>("#role")!;
const worker = document.querySelector<HTMLElement>("#worker")!;
/** Centre and radius of the shown model's bounds (review tools frame several levels alike). */
let framing = { centre: [0, 0, 0], radius: 1 };
let constructing = false,
  constructionStart = 0;
for (const group of BUILDING_MENU) {
  const options = document.createElement("optgroup");
  options.label = group.name;
  for (const definition of group.buildings) {
    const option = document.createElement("option");
    option.value = String(definition.id);
    option.textContent = getNationBuildingDefinition(definition.id, nation === "neutral" ? "roman" : nation).name;
    options.append(option);
  }
  selector.append(options);
}
for (const option of BUILDING_LEVELS) levelSelector.append(new Option(`Level ${option}`, String(option)));
levelSelector.disabled = nation === "neutral";
/** Shows a building; `nextLevel` (1-5) switches the level additions shown (nation buildings only). */
const selectBuilding = (id: number, nextLevel: number = level) => {
  level = buildingLevelOf(nextLevel - 1);
  if (model) {
    scene.remove(model.root);
    model.dispose();
  }
  const definition = getNationBuildingDefinition(id, nation === "neutral" ? "roman" : nation);
  if (scene.fog instanceof Fog) { scene.fog.near = id === 7 ? 100 : 14; scene.fog.far = id === 7 ? 160 : 35; }
  model = createBuilding(definition);
  scene.add(model.root);
  const residentReady = Promise.all([
    buildingAssetReady(model.root),
    waitForAdvancedMaterialTextures()
  ]);
  Object.assign(window, { __buildingResidentReady: residentReady });
  if ([0, 9].includes(id)) {
    camera.position.set(5.8, 4.8, 7.3);
    controls.target.set(0, 1.5, 0);
  } else if (definition.style === "tower" || definition.style === "mill") {
    camera.position.set(5.5, 4.5, 6.8);
    if (definition.style === "mill") camera.position.set(6, 4.8, 7.4);
    controls.target.set(0, definition.style === "mill" ? 2 : 1.35, 0);
  } else {
    camera.position.set(4.5, 3.7, 5.5);
    controls.target.set(0, 0.9, 0);
  }
  // Fit the actual raised walls and complete roof/sail silhouette, including narrow icons.
  const bounds = id === 7 ? new Box3(new Vector3(-4.2, -.16, -4.2),
    new Vector3(4.2, Number(model.root.userData.authoredHeight), 4.2)) : new Box3().setFromObject(model.root);
  const centre = bounds.getCenter(new Vector3());
  const radius = bounds.getSize(new Vector3()).length() / 2;
  framing = { centre: centre.toArray(), radius };
  const vertical = camera.fov * Math.PI / 360;
  const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
  const distance = radius / Math.sin(halfFov) * 1.08;
  controls.maxDistance = Math.max(12, distance * 1.1);
  camera.position.copy(centre).add(new Vector3(4.5, 3.2, 5.5).normalize().multiplyScalar(distance));
  controls.target.copy(centre);
  controls.update();
  role.textContent = definition.role;
  worker.textContent = `${definition.worker} · ${definition.task}`;
  selector.value = String(id);
  constructing = false;
  progress.value = "1";
  status.textContent =
    `${nation} · ${definition.gridFootprint[0]} × ${definition.gridFootprint[1]} · ` +
    `${Math.round(model.triangles()).toLocaleString()} triangles · ${detailed ? "High" : "Minimal"} · level ${level}`;
  levelSelector.value = String(level);
  const url = new URL(location.href);
  url.searchParams.set("building", String(id));
  url.searchParams.set("level", String(level));
  history.replaceState(null, "", url);
};
selector.addEventListener("change", () => selectBuilding(Number(selector.value)));
levelSelector.addEventListener("change", () => selectBuilding(Number(selector.value), Number(levelSelector.value)));
selectBuilding(Number(parameters.get("building") ?? 20));
document.querySelector("#construct")!.addEventListener("click", () => {
  constructing = true;
  constructionStart = performance.now() / 1000;
  progress.value = "0";
});
progress.addEventListener("input", () => (constructing = false));
document.querySelector("#quality")!.addEventListener("click", () => {
  const url = new URL(location.href);
  url.searchParams.set("quality", detailed ? "minimal" : "high");
  location.href = url.href;
});
const exporter = new GLTFExporter();
const exportModel = async () => {
  const definition = getBuildingDefinition(Number(selector.value));
  const exported = createBuilding(definition);
  exported.fitToGrid();
  await Promise.all([waitForAdvancedMaterialTextures(), buildingAssetReady(exported.root)]);
  const bytes = await exporter.parseAsync(exported.root, {
    binary: true,
    animations: exported.root.animations
  });
  exported.dispose();
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Expected binary GLB");
  return bytes;
};
const exportLibrary = async () => {
  const library = new Group();
  library.name = `${nation}_building_library`;
  const spacing = Math.max(...BUILDING_CATALOG.map((entry) => Math.max(...entry.gridFootprint))) + 2;
  const definitions = nation === "neutral" ? BUILDING_CATALOG.filter(entry =>
    NEUTRAL_BUILDING_IDS.includes(entry.id as typeof NEUTRAL_BUILDING_IDS[number])) : BUILDING_CATALOG;
  const models = definitions.map((definition, index) => {
    const model = createBuilding(definition);
    model.fitToGrid();
    model.root.position.set((index % 7) * spacing, 0, Math.floor(index / 7) * spacing);
    const prefix = `${nation}_${definition.id}_`;
    model.root.traverse((object) => {
      if (object !== model.root && object.name) object.name = prefix + object.name;
    });
    for (const clip of model.root.animations) {
      clip.name = prefix + clip.name;
      for (const track of clip.tracks) track.name = prefix + track.name;
    }
    library.add(model.root);
    return model;
  });
  try {
    await Promise.all([waitForAdvancedMaterialTextures(), ...models.map(model => buildingAssetReady(model.root))]);
    for (const model of models) if (model.root.userData.monument) {
      const prefix = `${nation}_${MONUMENT_TYPE_ID}_`;
      model.root.traverse(object => {
        if (object !== model.root && object.name && !object.name.startsWith(prefix)) object.name = prefix + object.name;
      });
    }
    const bytes = await exporter.parseAsync(library, {
      binary: true,
      animations: models.flatMap((model) => model.root.animations)
    });
    if (!(bytes instanceof ArrayBuffer)) throw new Error("Expected binary GLB");
    return bytes;
  } finally {
    models.forEach((model) => model.dispose());
  }
};
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  try {
    const bytes = await exportModel();
    const url = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `roman-${getBuildingDefinition(Number(selector.value)).name.toLowerCase().replaceAll(" ", "-")}.glb`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    status.textContent = `Export failed: ${String(error)}`;
  } finally {
    exportButton.disabled = false;
  }
});
const resize = () => {
  const element = document.querySelector<HTMLElement>("#viewport")!;
  camera.aspect = element.clientWidth / element.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(element.clientWidth, element.clientHeight);
};
window.addEventListener("resize", resize);
resize();
renderer.setAnimationLoop(() => {
  const time = performance.now() / 1000;
  if (constructing) {
    progress.value = String(Math.min(1, (time - constructionStart) / 9));
    if (Number(progress.value) >= 1) constructing = false;
  }
  model.update(time, {
    construction: Number(progress.value),
    door: door.checked ? 1 : 0,
    working: working.checked
  });
  controls.update();
  renderer.render(scene, camera);
});
Object.assign(window, {
  __buildingReady: false,
  __buildingPreview: {
    selectBuilding,
    exportLibrary,
    exportModel,
    model: () => model,
    framing: () => framing,
    renderer,
    scene,
    camera,
    controls
  }
});

await prepareImportedPigTexture(detailed);
(window as unknown as { __buildingReady: boolean }).__buildingReady = true;
