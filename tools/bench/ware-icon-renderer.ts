/**
 * In-page ware icon renderer (functions run inside `ware-icon-render.html` through `page.evaluate`):
 * shared by the exporter `ware-icons.ts` and the icon comparison `tests-ui/visual/ware-icons.spec.ts`.
 * They must stay self-contained (serialized into the page).
 */

/** Owner-authored raster icons stay separate from the procedural stock/carry model exports. */
/** Ware icons this renderer never overwrites: authored artwork (and the older horse portrait). */
export const AUTHORED_WARE_ICONS = new Set(["cloth", "coins", "flax", "grain", "horse"]);

/** Fixed orthographic studio with key, fill and hemisphere light, a shadow catcher and Roman materials. */
export const setupWareIconRenderer = async () => {
  const three = await import(/* @vite-ignore */ String("/@id/three"));
  const { RoomEnvironment } = await import(
    /* @vite-ignore */ String("/@id/three/examples/jsm/environments/RoomEnvironment.js"));
  const { createRomanMaterials } = await import(
    /* @vite-ignore */ String("/src/renderers/three/buildings/roman-materials.ts"));
  const { createWareIconModel } = await import(
    /* @vite-ignore */ String("/src/renderers/three/settlement/ware-icon-models.ts"));
  const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(384, 384); renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = three.PCFSoftShadowMap;
  renderer.toneMapping = three.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.72;
  const scene = new three.Scene(), pmrem = new three.PMREMGenerator(renderer);
  const environment = new RoomEnvironment(), reflection = pmrem.fromScene(environment, 0.04);
  scene.environment = reflection.texture; scene.environmentIntensity = 0.85;
  environment.dispose(); pmrem.dispose();
  const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  const key = new three.DirectionalLight(0xfff2df, 2);
  key.position.set(-2.5, 7, 3.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -1.5;
  key.shadow.camera.right = key.shadow.camera.top = 1.5; key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 10; key.shadow.bias = -0.00015; key.shadow.normalBias = 0.012;
  scene.add(key, new three.HemisphereLight(0xeaf3ff, 0xc5ae8d, 0.7));
  const fill = new three.DirectionalLight(0xe2edff, 0.45); fill.position.set(3, 2, -3); scene.add(fill);
  const ground = new three.Mesh(new three.PlaneGeometry(8, 8),
    new three.ShadowMaterial({ color: 0x423423, opacity: 0.2, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const materialPack = createRomanMaterials(true, 256);
  const models = new Map();
  (window as any).__wareIcons = { camera, createWareIconModel, ground, key, materialPack, models,
    reflection, renderer, scene, three };
};

/** Renders one ware (or the hand-cart product) framed and returns its 192 px PNG and stats. */
export const renderWareIcon = async (id: string) => {
  const state = (window as any).__wareIcons;
  const { camera, createWareIconModel, materialPack, models, renderer, scene, three } = state;
  const outputResolution = id === "spyglass" ? 512 : 192;
  renderer.setSize(outputResolution * 2, outputResolution * 2);
  for (const model of models.values()) model.root.visible = false;
  const model = createWareIconModel(id, materialPack.materials);
  models.set(id, model); scene.add(model.root);
  if (id === "pig") {
    const { waitForImportedPigTextures } = await import(
      /* @vite-ignore */ String("/src/renderers/three/buildings/imported-pig.ts"));
    await waitForImportedPigTextures();
  }
  if (["hardwoodLogs", "hardwoodPlanks", "marble", "cedarLogs", "cedarPlanks",
    "walnutLogs", "walnutPlanks", "mahoganyLogs", "mahoganyPlanks", "limestone", "basalt", "granite"].includes(id)) {
    const { waitForAdvancedMaterialTextures } = await import(
      /* @vite-ignore */ String("/src/renderers/three/settlement/advanced-material-assets.ts"));
    await waitForAdvancedMaterialTextures();
  }
  if (model.recipe.tool && !["crucible", "shield"].includes(id)) model.root.rotation.z = -0.24;
  if (id === "planks" && !model.recipe.closeUpLog) model.root.rotation.y = -0.7;
  model.root.updateMatrixWorld(true);
  let bounds = new three.Box3().setFromObject(model.root);
  const size = bounds.getSize(new three.Vector3());
  if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || size.length() <= 0)
    throw new Error(`${id}: invalid geometry bounds`);
  model.root.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
  model.root.updateMatrixWorld(true); bounds = new three.Box3().setFromObject(model.root);
  const center = bounds.getCenter(new three.Vector3());
  model.root.position.set(-center.x, -bounds.min.y + 0.012, -center.z);
  model.root.updateMatrixWorld(true); bounds = new three.Box3().setFromObject(model.root);
  const target = bounds.getCenter(new three.Vector3());
  const closeUpLog = model.recipe.closeUpLog === true;
  if (closeUpLog) target.z += bounds.getSize(new three.Vector3()).z * .26;
  let cameraOffset = id === "bread" ? new three.Vector3(2.2, 1.7, 4.8) : new three.Vector3(3.2, 2.7, 4.4);
  if (closeUpLog) cameraOffset = new three.Vector3(1.7, 1.5, 4.8);
  camera.position.copy(target).add(cameraOffset);
  camera.lookAt(target); camera.left = camera.bottom = -1; camera.right = camera.top = 1;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const projected = [];
  if (model.recipe.tightFraming) {
    // Thin diagonal tools: frame the actual vertices and their key-light shadow, centred.
    const light = state.key.position.clone().normalize();
    model.root.traverse((object: any) => {
      const position = object.isMesh && object.geometry.getAttribute("position");
      for (let index = 0; position && index < position.count; index++) {
        const point = new three.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        projected.push(point.clone().project(camera));
        if (model.recipe.framingShadow)
          projected.push(point.addScaledVector(light, -point.y / light.y).project(camera));
      }
    });
  } else for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
    for (const z of [bounds.min.z, bounds.max.z]) projected.push(new three.Vector3(x, y, z).project(camera));
  const extent = projected.reduce((box, point) => [Math.min(box[0], point.x), Math.max(box[1], point.x),
    Math.min(box[2], point.y), Math.max(box[3], point.y)], [Infinity, -Infinity, Infinity, -Infinity]);
  const middleX = model.recipe.tightFraming && !closeUpLog ? (extent[0] + extent[1]) / 2 : 0;
  const middleY = model.recipe.tightFraming && !closeUpLog ? (extent[2] + extent[3]) / 2 : 0;
  const span = (closeUpLog
    ? Math.max(extent[1] - extent[0], extent[3] - extent[2]) / 2
    : Math.max(extent[1] - middleX, middleX - extent[0], extent[3] - middleY, middleY - extent[2])) *
    (model.recipe.framingMargin ?? 1.2);
  camera.left = middleX - span; camera.right = middleX + span;
  camera.bottom = middleY - span; camera.top = middleY + span;
  camera.updateProjectionMatrix(); renderer.render(scene, camera);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = outputResolution;
  const context = canvas.getContext("2d")!;
  context.drawImage(renderer.domElement, 0, 0, outputResolution, outputResolution);
  const pixels = context.getImageData(0, 0, outputResolution, outputResolution).data;
  let opaque = 0, shadow = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index]! > 200) opaque++;
    else if (pixels[index]! > 0) shadow++;
  }
  if (!opaque || (!closeUpLog && pixels[3] !== 0)) throw new Error(`${id}: invalid transparent icon`);
  return { png: canvas.toDataURL("image/png").split(",")[1]!,
    stats: { id, triangles: model.triangles(),
      opaque, shadow, size: size.toArray() } };
};
