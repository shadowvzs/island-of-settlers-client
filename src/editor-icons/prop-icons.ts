import { InstancedBufferAttribute, InstancedMesh, Matrix4 } from "three";

import { isBiomeGrassKind } from "../render-common/props/biome-grass";
import { getTreeSpecies, getTreeVariant } from "../render-common/props/island-trees";
import { createBiomeGrassHeroMesh } from "../render-common/props/plants/biome-grass-mesh";
import { PROP_MESH_SEED } from "../render-common/props/prop-mesh-seed";
import { createPropMesh } from "../render-common/props/prop-meshes";
import {
  createPropDepthMaterial,
  createPropMaterial
} from "../renderers/three/three-prop-materials";
import { createPropGeometry } from "../renderers/three/three-props";
import { TREE_SCALE } from "../shared/world/editing/prop-placement";
import { type IconStudio, STAGE_CENTRE, type StudioItem } from "./icon-studio";

/** Per instance data: wind phase, sun visibility, fog visibility, hidden. */
const INSTANCE_DATA = [0, 1, 1, 0];
const NO_TINT = [1, 1, 1];

/** The mesh variant the editor places: trees mature (the editor's tree scale), others first. */
const getPlacedVariant = (kind: number) =>
  getTreeSpecies(kind) === undefined ? 0 : getTreeVariant(kind, TREE_SCALE.base);

/** One instance of a prop mesh with the game's prop material (and its sun shadow twin). */
const createPropInstance = (studio: IconStudio, kind: number, variant = getPlacedVariant(kind)): StudioItem => {
  const mesh = isBiomeGrassKind(kind)
    ? createBiomeGrassHeroMesh(kind, variant)
    : createPropMesh(PROP_MESH_SEED, kind, variant);
  const geometry = createPropGeometry(mesh);
  geometry.setAttribute(
    "instanceData",
    new InstancedBufferAttribute(new Float32Array(INSTANCE_DATA), 4)
  );
  geometry.setAttribute("instanceTint", new InstancedBufferAttribute(new Float32Array(NO_TINT), 3));
  const place = new Matrix4().makeTranslation(STAGE_CENTRE, 0, STAGE_CENTRE);
  const create = (material: ReturnType<typeof createPropMaterial>) => {
    const mesh = new InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, place);
    mesh.frustumCulled = false;
    return mesh;
  };
  return {
    casters: [create(createPropDepthMaterial(studio.uniforms))],
    main: create(createPropMaterial(studio.uniforms, false))
  };
};

/** A prop (tree, sapling) as the game draws it, rendered in the studio. */
export const renderPropIcon = (studio: IconStudio, kind: number) =>
  studio.shoot(createPropInstance(studio, kind));
