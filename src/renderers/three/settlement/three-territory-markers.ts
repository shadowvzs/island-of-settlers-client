import { Float32BufferAttribute, Group, InstancedMesh, type IUniform, Matrix4, type Scene } from "three";

import { DEFAULT_PLAYER_COLOR } from "../../../render-common/settlement/player-color";
import {
  createTerritoryMarkerRecipe,
  TERRITORY_MARKER_LOD_ZOOM,
  TERRITORY_MARKER_PAINT
} from "../../../render-common/settlement/territory-marker-recipe";
import type { TerritoryBorderPoint } from "../../../shared/settlement/settlement-territory";
import { createPropGeometry } from "../three-props";
import { createTerritoryMarkerMaterial } from "./territory-marker-material";

const EMPTY_BORDERS: readonly TerritoryBorderPoint[] = [];

/** One draw for every border stone; High adds one depth pass. No per-frame geometry rebuilding. */
export const createThreeTerritoryMarkers = (
  uniforms: Record<string, IUniform>,
  detailed: boolean,
  shadowScene?: Scene
) => {
  const root = new Group();
  root.name = "Roman territory boundary stones";
  const recipe = createTerritoryMarkerRecipe(detailed);
  const geometry = createPropGeometry(recipe);
  const tint = new Float32Array(recipe.positions.length / 3);
  for (let vertex = 0; vertex < tint.length; vertex++) {
    tint[vertex] = TERRITORY_MARKER_PAINT.every((component, axis) =>
      Math.abs(recipe.colors[vertex * 3 + axis]! - component) < .00001) ? 1 : 0;
  }
  geometry.setAttribute("playerTint", new Float32BufferAttribute(tint, 1));
  geometry.scale(1.3, 1.4, 1.3);
  const material = createTerritoryMarkerMaterial(uniforms, detailed);
  const depthMaterial = shadowScene ? createTerritoryMarkerMaterial(uniforms, false, true) : null;
  const matrix = new Matrix4();
  let mesh: InstancedMesh | null = null;
  let caster: InstancedMesh | null = null;
  let capacity = 0;
  let lastRevision = -1;
  let lastPoints: readonly TerritoryBorderPoint[] | null = null;
  let disposed = false;
  let fullDetail = detailed;
  let uploads = 0;

  const removeInstances = () => {
    if (mesh) {
      root.remove(mesh);
      mesh.dispose();
    }
    if (caster) {
      shadowScene?.remove(caster);
      caster.dispose();
    }
    mesh = null;
    caster = null;
  };

  const grow = (required: number) => {
    if (required <= capacity) return;
    removeInstances();
    capacity = Math.max(32, 2 ** Math.ceil(Math.log2(required)));
    mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = "Instanced Roman boundary stones";
    root.add(mesh);
    if (depthMaterial) {
      caster = new InstancedMesh(geometry, depthMaterial, capacity);
      caster.instanceMatrix = mesh.instanceMatrix;
      shadowScene!.add(caster);
    }
  };

  const setDetail = (zoom: number) => {
    const next = detailed && zoom >= TERRITORY_MARKER_LOD_ZOOM;
    if (next === fullDetail) return;
    fullDetail = next;
    geometry.setDrawRange(
      0,
      next ? recipe.indices.length : (recipe.coreIndexCount ?? recipe.indices.length)
    );
  };

  const update = (points = EMPTY_BORDERS, revision = 0, zoom = 1,
    playerColor: [number, number, number] = DEFAULT_PLAYER_COLOR) => {
    if (disposed) return;
    material.uniforms.uPlayerColor!.value.fromArray(playerColor);
    setDetail(zoom);
    if (revision === lastRevision && points === lastPoints) return;
    lastRevision = revision;
    lastPoints = points;
    grow(points.length);
    if (!mesh) return;
    points.forEach((point, index) => {
      matrix.makeRotationY(point.yaw);
      matrix.setPosition(point.x, point.y, point.z);
      mesh!.setMatrixAt(index, matrix);
    });
    mesh.count = points.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (caster) {
      caster.count = mesh.count;
      caster.boundingSphere = mesh.boundingSphere;
    }
    uploads += 1;
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      removeInstances();
      geometry.dispose();
      material.dispose();
      depthMaterial?.dispose();
      root.clear();
    },
    getStats: () => ({
      territoryMarkerCount: mesh?.count ?? 0,
      territoryMarkerDraws: mesh?.count ? 1 + Number(Boolean(caster)) : 0,
      territoryMarkerTriangles:
        ((mesh?.count ?? 0) *
          (fullDetail ? recipe.indices.length : (recipe.coreIndexCount ?? recipe.indices.length))) /
        3,
      territoryMarkerUploads: uploads
    }),
    root,
    update
  };
};
