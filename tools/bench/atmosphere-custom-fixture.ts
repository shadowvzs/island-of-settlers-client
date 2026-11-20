import {
  AdditiveBlending, BoxGeometry, type BufferGeometry, Color, InstancedMesh, type IUniform, Matrix4, Mesh,
  PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, SphereGeometry, Vector3,
  type WebGLRenderer
} from "three";

import {
  burnMaterial, EMBER_FRAGMENT, EMBER_VERTEX, FLAME_VERTEX, flameFragment, smokeMaterial
} from "../../src/renderers/three/buildings/building-burn-shaders";
import { createThreeHiveBees } from "../../src/renderers/three/settlement/three-hive-bees";
import { createThreePaddyBeds } from "../../src/renderers/three/settlement/three-paddy-beds";
import { createAtlasTexture } from "../../src/renderers/three/three-materials";
import {
  compareAtmospherePixels, readAtmospherePixels, summarizeAtmospherePixels
} from "./atmosphere-gpu";

export type AtmosphereCustomKind = "paddy-high" | "paddy-minimal" | "bees" | "flame" | "smoke" | "ember";

const createBurn = (kind: "flame" | "smoke" | "ember", uniforms: Record<string, IUniform>) => {
  let geometry: BufferGeometry = new BoxGeometry(1, 1, 1).translate(0, .5, 0);
  let material = burnMaterial(FLAME_VERTEX, flameFragment(12), {}, uniforms);
  if (kind === "smoke") {
    geometry.dispose(); material.dispose();
    geometry = new PlaneGeometry(1, 1);
    material = smokeMaterial(.13, .8, uniforms);
  }
  if (kind === "ember") {
    geometry.dispose(); material.dispose();
    geometry = new SphereGeometry(1, 8, 6);
    material = burnMaterial(EMBER_VERTEX, EMBER_FRAGMENT, {}, uniforms, true);
    material.blending = AdditiveBlending;
  }
  material.uniforms.age!.value = 1.1;
  const mesh = new InstancedMesh(geometry, material, 1);
  const matrix = new Matrix4().makeScale(3, 3, 3);
  if (kind === "smoke") matrix.setPosition(0, 1.5, 0);
  if (kind === "ember") matrix.makeScale(.5, .5, .5).setPosition(0, 1.5, 0);
  mesh.setMatrixAt(0, matrix);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return { object: mesh, dispose: () => { mesh.dispose(); geometry.dispose(); material.dispose(); } };
};

/** Compile real custom families independently; standard-material injection cannot mask failures. */
export const reviewAtmosphereCustom = (
  renderer: WebGLRenderer,
  uniforms: Record<string, IUniform>,
  kind: AtmosphereCustomKind
) => {
  const scene = new Scene();
  scene.background = new Color(.04, .05, .07);
  const camera = new PerspectiveCamera(45, 16 / 9, .1, 100);
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 1.5, 0);
  const ripples = createAtlasTexture(new Uint8Array([128, 128, 128, 128]), 1, 1);
  const local = { ...uniforms, uWaterNormals: { value: ripples } };
  let dispose = () => {};
  if (kind === "paddy-high" || kind === "paddy-minimal") {
    const paddy = createThreePaddyBeds(local, kind === "paddy-high");
    paddy.begin();
    for (let x = -3; x <= 3; x++) for (let z = -2; z <= 2; z++) {
      paddy.push(x, 0, z, true, { east: true, north: true, south: true, west: true });
    }
    paddy.commit();
    // Only the custom water sheet participates; standard mud/dikes cannot satisfy this effect check.
    paddy.group.traverse(object => {
      if (object instanceof Mesh) object.visible = object.material instanceof ShaderMaterial;
    });
    scene.add(paddy.group);
    camera.position.set(0, 5, 8);
    camera.lookAt(0, 0, 0);
    dispose = () => {
      paddy.group.traverse(object => { if (object instanceof InstancedMesh) object.dispose(); });
      paddy.dispose();
    };
  } else if (kind === "bees") {
    const bees = createThreeHiveBees(local, 40);
    bees.begin(); bees.push(0, .2, 0, 40, 7); bees.commit();
    scene.add(bees.mesh);
    camera.position.set(0, .35, 1.5);
    camera.lookAt(0, .3, 0);
    dispose = () => { bees.mesh.dispose(); bees.dispose(); };
  } else {
    const burn = createBurn(kind, local);
    scene.add(burn.object);
    dispose = burn.dispose;
  }
  camera.updateMatrixWorld();
  const keys = ["uAtmosphereProfile", "uAtmosphereEye", "uAtmosphereForward"] as const;
  const saved = keys.map(key => Array.from(uniforms[key]!.value as Float32Array));
  const savedPass = uniforms.uAtmospherePass!.value;
  const forward = camera.getWorldDirection(new Vector3());
  try {
    uniforms.uAtmosphereEye!.value.set(camera.position.toArray());
    uniforms.uAtmosphereForward!.value.set(forward.toArray());
    uniforms.uAtmosphereProfile!.value.set([0, .06, 2, 0]);
    uniforms.uAtmospherePass!.value = 1;
    renderer.clear(); renderer.render(scene, camera);
    const clear = readAtmospherePixels(renderer);
    uniforms.uAtmosphereProfile!.value[0] = 1;
    renderer.clear(); renderer.render(scene, camera);
    const dense = readAtmospherePixels(renderer);
    return { effect: compareAtmospherePixels(clear, dense), pixels: summarizeAtmospherePixels(dense) };
  } finally {
    keys.forEach((key, index) => uniforms[key]!.value.set(saved[index]!));
    uniforms.uAtmospherePass!.value = savedPass;
    dispose(); ripples.dispose();
  }
};
