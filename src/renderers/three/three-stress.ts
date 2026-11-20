import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  type IUniform,
  type Material,
  Matrix4,
  Mesh} from "three";

import { createVertexFog } from "../../render-common/chunk-sampling";
import type { PropInstances } from "../../render-common/props/prop-instances";
import {
  createFishMesh,
  createHouseMesh,
  createWindmillBladesMesh,
  createWindmillMesh,
  WINDMILL_HUB,
  withoutWindBend
} from "../../render-common/stress/building-meshes";
import { createCharacterMesh } from "../../render-common/stress/character-mesh";
import type { StressEntities } from "../../render-common/stress/stress-world";
import { sampleBilinear } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createPropGeometry, createThreePropMeshes } from "./three-props";
import { createUnitMaterial } from "./three-unit-material";

const UNIT_TINTS = [
  [0.45, 0.6, 0.95],
  [0.95, 0.45, 0.4],
  [0.55, 0.85, 0.45],
  [0.95, 0.8, 0.45]
] as const;
const BLADE_SPEED = 1.4;

/** Units: one instanced draw (and a depth twin); attributes rewritten each frame. */
const createUnits = (units: StressEntities["units"], uniforms: Record<string, IUniform>) => {
  const { mesh, rig } = createCharacterMesh();
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("rig", new BufferAttribute(rig, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const pose = new InstancedBufferAttribute(new Float32Array(units.count * 4), 4);
  const style = new InstancedBufferAttribute(new Float32Array(units.count * 4), 4);
  geometry.setAttribute("unitPose", pose);
  geometry.setAttribute("unitStyle", style);
  geometry.instanceCount = units.count;
  const main = new Mesh(geometry, createUnitMaterial(uniforms, false));
  const caster = new Mesh(geometry, createUnitMaterial(uniforms, true));
  main.frustumCulled = false;
  caster.frustumCulled = false;
  const update = () => {
    const poseArray = pose.array as Float32Array;
    const styleArray = style.array as Float32Array;
    for (let index = 0; index < units.count; index += 1) {
      poseArray.set(
        [units.x[index]!, units.y[index]!, units.z[index]!, units.heading[index]!],
        index * 4
      );
      styleArray.set(
        [units.phase[index]!, ...UNIT_TINTS[units.variant[index]! % UNIT_TINTS.length]!],
        index * 4
      );
    }
    pose.needsUpdate = true;
    style.needsUpdate = true;
  };
  return { caster, main, triangles: (mesh.indices.length / 3) * units.count, update };
};

/** Static buildings as chunk culled instances of the rigid house and windmill meshes. */
const createBuildingInstances = (
  world: WorldData,
  buildings: StressEntities["buildings"]
): PropInstances => {
  const fog = createVertexFog(world);
  const { count } = buildings;
  return {
    count,
    fog: Float32Array.from(buildings.x, (x, index) =>
      sampleBilinear(world, fog, x, buildings.z[index]!)
    ),
    meshIds: Uint16Array.from(buildings.windmill),
    phase: new Float32Array(count),
    rotation: buildings.rotation,
    scale: new Float32Array(count).fill(1),
    sourceIndex: new Int32Array(count).fill(-1),
    stretch: new Float32Array(count).fill(1),
    sunVisibility: Float32Array.from(
      buildings.x,
      (x, index) => sampleBilinear(world, world.sunShadow, x, buildings.z[index]!) / 255
    ),
    tint: new Float32Array(count * 3).fill(1),
    x: buildings.x,
    y: buildings.y,
    z: buildings.z
  };
};

/** Instanced rigid mesh with matrices written every frame (blades, fish); data.w 0 = shown. */
const createDynamicProp = (
  geometrySource: Parameters<typeof createPropGeometry>[0],
  count: number,
  material: Material
) => {
  const geometry = createPropGeometry(geometrySource);
  const data = new Float32Array(count * 4).fill(1);
  for (let index = 3; index < data.length; index += 4) data[index] = 0;
  geometry.setAttribute("instanceData", new InstancedBufferAttribute(data, 4));
  geometry.setAttribute(
    "instanceTint",
    new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3)
  );
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  return mesh;
};

/** Stress content for Three.js: GPU animated units, buildings, turning windmill blades, fish. */
export const createThreeStress = (
  stress: StressEntities,
  world: WorldData,
  uniforms: Record<string, IUniform>,
  propMaterials: { depth: Material; main: Material }
) => {
  const units = createUnits(stress.units, uniforms);
  const houses = createThreePropMeshes(
    [withoutWindBend(createHouseMesh()), withoutWindBend(createWindmillMesh())],
    createBuildingInstances(world, stress.buildings),
    world.cellsX,
    propMaterials
  );
  for (const house of houses) house.showChunks(new Uint8Array(4096).fill(1));
  const windmills = Array.from(stress.buildings.windmill.keys()).filter(
    (index) => stress.buildings.windmill[index]
  );
  const blades = createDynamicProp(
    withoutWindBend(createWindmillBladesMesh()),
    windmills.length,
    propMaterials.main
  );
  const fish = createDynamicProp(
    withoutWindBend(createFishMesh()),
    stress.fish.count,
    propMaterials.main
  );
  const matrix = new Matrix4();
  const spin = new Matrix4();
  const hub = new Matrix4();

  const update = (time: number) => {
    units.update();
    windmills.forEach((index, slot) => {
      const rotation = stress.buildings.rotation[index]!;
      matrix
        .makeRotationY(rotation)
        .setPosition(
          stress.buildings.x[index]!,
          stress.buildings.y[index]!,
          stress.buildings.z[index]!
        );
      hub.makeTranslation(WINDMILL_HUB[0], WINDMILL_HUB[1], WINDMILL_HUB[2]);
      spin.makeRotationX(time * BLADE_SPEED + slot);
      blades.setMatrixAt(slot, matrix.multiply(hub).multiply(spin));
    });
    blades.instanceMatrix.needsUpdate = true;
    for (let index = 0; index < stress.fish.count; index += 1) {
      matrix
        .makeRotationY(-stress.fish.heading[index]!)
        .setPosition(stress.fish.x[index]!, stress.fish.y[index]!, stress.fish.z[index]!);
      fish.setMatrixAt(index, matrix);
    }
    fish.instanceMatrix.needsUpdate = true;
  };

  return {
    aboveWater: [units.main, blades, ...houses.map((house) => house.mesh)],
    casters: [units.caster, ...houses.flatMap((house) => (house.caster ? [house.caster] : []))],
    meshes: [units.main, blades, fish, ...houses.map((house) => house.mesh)],
    triangles: units.triangles,
    update
  };
};
