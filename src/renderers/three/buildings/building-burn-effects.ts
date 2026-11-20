import {
type Box3,
  BoxGeometry, Group, InstancedMesh, type IUniform, MeshStandardMaterial, Object3D, PlaneGeometry, Sphere,
  SphereGeometry, Vector3} from "three";

import { BUILDING_BURN_SECONDS, BUILDING_DEMOLITION_SECONDS } from "../../../render-common/buildings/building-demolition";
import { smoothstep } from "../../../shared/world/noise";
import {
  burnMaterial, burnRandom, charredTimberTexture, EMBER_FRAGMENT, EMBER_VERTEX, FLAME_VERTEX, flameFragment,
  layOutCharredRuin, setBurnUniforms, smokeMaterial
} from "./building-burn-shaders";
import { buildingCollapseScale, sampleBuildingFireAnchors } from "./building-fire-anchors";

/** Shared geometry and the charred timber material of every burning building. */
export const createBurnResources = (high: boolean, atmosphereUniforms: Record<string, IUniform> = {}) => {
  const fireGeometry = new BoxGeometry(1, 1, 1);
  fireGeometry.translate(0, .5, 0);
  const smokeGeometry = new PlaneGeometry(1, 1);
  const emberGeometry = new SphereGeometry(1, high ? 8 : 4, high ? 6 : 3);
  const beamGeometry = new BoxGeometry(1, 1, 1);
  const timberTexture = charredTimberTexture();
  const timber = new MeshStandardMaterial({ color: 0x252321, map: timberTexture, roughness: 1, transparent: true });
  return { atmosphereUniforms, beamGeometry, emberGeometry, fireGeometry, smokeGeometry, timber,
    dispose: () => {
      fireGeometry.dispose(); smokeGeometry.dispose(); emberGeometry.dispose(); beamGeometry.dispose();
      timberTexture.dispose(); timber.dispose();
    } };
};
export type BurnResources = ReturnType<typeof createBurnResources>;

/** Keeps the effect's meshes from being culled while their instances rise above the building. */
export const coverBurnBounds = (meshes: readonly InstancedMesh[], width: number, depth: number, height: number) => {
  for (const mesh of meshes) mesh.boundingSphere = new Sphere(new Vector3(0, height * 2, 0), height * 3 + width + depth + 6);
};

/** Instanced volumetric flames, rising smoke and charred structural timber; shared geometry. */
export const createBuildingBurnEffects = (high: boolean, resources = createBurnResources(high)) => {
  const transform = new Object3D();
  const create = (bounds: Box3, identity: string, structure?: Object3D) => {
    const root = new Group(); root.name = `burn-${identity}`;
    root.position.set((bounds.min.x + bounds.max.x) / 2, bounds.min.y, (bounds.min.z + bounds.max.z) / 2);
    const width = bounds.max.x - bounds.min.x, depth = bounds.max.z - bounds.min.z;
    const height = Math.max(1, bounds.max.y - bounds.min.y);
    const fire = new InstancedMesh(resources.fireGeometry, burnMaterial(FLAME_VERTEX, flameFragment(high ? 24 : 12), {}, resources.atmosphereUniforms),
      high ? 48 : 12);
    const anchors = structure ? sampleBuildingFireAnchors(structure, bounds, fire.count) : [];
    fire.count = anchors.length;
    fire.userData.surfaceAnchors = anchors;
    const smoke = new InstancedMesh(resources.smokeGeometry, smokeMaterial(.13, .38, resources.atmosphereUniforms), high ? 28 : 8);
    const embers = new InstancedMesh(resources.emberGeometry, burnMaterial(EMBER_VERTEX, EMBER_FRAGMENT, {}, resources.atmosphereUniforms), high ? 36 : 8);
    const ruinMaterial = resources.timber.clone();
    const ruins = new InstancedMesh(resources.beamGeometry, ruinMaterial, high ? 28 : 14);
    coverBurnBounds([fire, smoke, embers, ruins], width, depth, height);
    root.add(fire, smoke, embers, ruins);
    const random = burnRandom(width, depth);
    layOutCharredRuin(ruins, width, depth);
    const update = (age: number) => {
      setBurnUniforms(fire.material, age, 1 - smoothstep(BUILDING_BURN_SECONDS - 2, BUILDING_BURN_SECONDS, age));
      setBurnUniforms(smoke.material, age, 1 - smoothstep(15, 21, age));
      setBurnUniforms(embers.material, age, 1 - smoothstep(15, 17, age));
      embers.visible = age < 17;
      fire.visible = age < BUILDING_BURN_SECONDS; smoke.visible = age < 21;
      ruins.visible = age >= 5 && age < BUILDING_DEMOLITION_SECONDS;
      ruinMaterial.opacity = Math.max(0, Math.min(1, (age - 5) / 3, BUILDING_DEMOLITION_SECONDS - age));
      for (let index = 0; index < fire.count; index++) {
        const anchor = anchors[index]!;
        transform.position.set(anchor.x, Math.max(.06, anchor.y * buildingCollapseScale(age) - .035), anchor.z);
        transform.rotation.set(0, random(index) * 6.28, 0);
        transform.scale.setScalar(.55 + random(index + 7) * .7);
        const pulse = .86 + Math.sin(age * 4.3 + index * 1.7) * .16
          + Math.sin(age * 9.1 + index * .9) * .08;
        transform.scale.y *= (1.1 + height * .25) * pulse;
        transform.updateMatrix(); fire.setMatrixAt(index, transform.matrix);
      }
      for (let index = 0; index < smoke.count; index++) {
        const rise = (Math.min(age, 12) * .2 + random(index + 11)) % 1 + Math.max(0, age - 12) * .2;
        transform.position.set((random(index * 3) - .5) * width * .6 + rise * .6,
          height * .65 + rise * (height + 2), (random(index * 3 + 2) - .5) * depth * .6);
        transform.rotation.set(0, 0, 0); transform.scale.setScalar(.7 + rise * 1.6);
        transform.updateMatrix(); smoke.setMatrixAt(index, transform.matrix);
      }
      for (let index = 0; index < embers.count; index++) {
        const rise = (Math.min(age, 12) * .32 + random(index + 31)) % 1
          + Math.max(0, age - 12) * .32;
        const drift = Math.sin(age * 1.1 + index) * rise * .5;
        transform.position.set((random(index * 3) - .5) * width * .7 + rise + drift,
          height * .6 + rise * (height + 3),
          (random(index * 3 + 2) - .5) * depth * .7 + drift);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar((.018 + random(index + 19) * .035) * Math.max(0, 1 - rise));
        transform.updateMatrix(); embers.setMatrixAt(index, transform.matrix);
      }
      fire.instanceMatrix.needsUpdate = smoke.instanceMatrix.needsUpdate = true;
      embers.instanceMatrix.needsUpdate = true;
    };
    return { root, update, dispose: () => {
      root.removeFromParent(); fire.dispose(); smoke.dispose(); embers.dispose(); ruins.dispose();
      fire.material.dispose(); smoke.material.dispose(); embers.material.dispose(); ruinMaterial.dispose();
    } };
  };
  return { create, resources, dispose: resources.dispose };
};
