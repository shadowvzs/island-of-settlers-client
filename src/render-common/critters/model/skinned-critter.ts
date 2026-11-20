import { type GlbFile, readAccessor } from "../../glb-reader";
import type { PropMesh } from "../../props/mesh-builder";
import { getCritterGlb } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { refreshBounds } from "./critter-pose";

/**
 * Critters built from licensed skinned sources (tools/assets/skinned-critter.ts): baked clip
 * frames on one compact vertex set, summer (COLOR_0) and winter (COLOR_1) coats, a High and a
 * Minimal index set, an optional part (horns) as the last triangles of each.
 */

interface SkinnedCritterExtras {
  frames: [position: number, normal: number][];
  minimal: { indices: number; partTriangles: number };
  partTriangles: number;
  /** Accessor of the winter coat thickness per vertex (along the normal), if any. */
  winterThickness?: number;
}

/** Which variant to build: the season's coat, the detail level, without the optional part. */
export interface SkinnedCritterOptions {
  minimal: boolean;
  /** Leave out the optional part (a kid without horns). */
  withoutPart?: boolean;
  winter: boolean;
}

/** The index list of the detail level, the optional part's triangles (last) left out on request. */
const readIndices = (glb: GlbFile, extras: SkinnedCritterExtras, options: SkinnedCritterOptions) => {
  const primitive = glb.json.meshes[0]!.primitives[0]!;
  const accessor = options.minimal ? extras.minimal.indices : primitive.indices;
  const part = options.minimal ? extras.minimal.partTriangles : extras.partTriangles;
  const indices = Uint16Array.from(readAccessor(glb, accessor));
  return options.withoutPart ? indices.slice(0, indices.length - part * 3) : indices;
};

/** The winter coat: every vertex pushed out along its normal by its thickness. */
const thicken = (positions: Float32Array, normals: Float32Array, thickness: Float32Array) => {
  for (let vertex = 0; vertex < thickness.length; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      positions[vertex * 3 + axis]! += normals[vertex * 3 + axis]! * thickness[vertex]!;
    }
  }
};

/** Builds the model from its loaded GLB (`loadCritterGlb`). */
export const createSkinnedCritterModel = (
  url: string,
  clips: CritterModel["clips"],
  options: SkinnedCritterOptions
): CritterModel => {
  const glb = getCritterGlb(url);
  const mesh = glb.json.meshes[0]!;
  const extras = (mesh as { extras?: unknown }).extras as SkinnedCritterExtras;
  const attributes = mesh.primitives[0]!.attributes;
  const colors = readAccessor(glb, options.winter ? attributes.COLOR_1! : attributes.COLOR_0!);
  const indices = readIndices(glb, extras, options);
  const thickness = options.winter && extras.winterThickness !== undefined
    ? readAccessor(glb, extras.winterThickness)
    : null;
  const frames = extras.frames.map(([position, normal]): PropMesh => {
    const positions = readAccessor(glb, position);
    const normals = readAccessor(glb, normal);
    if (thickness) thicken(positions, normals, thickness);
    const vertices = positions.length / 3;
    return refreshBounds({
      colors,
      height: 0,
      indices,
      normals,
      positions,
      radius: 0,
      uvs: new Float32Array(vertices * 2).fill(-1),
      wind: new Float32Array(vertices * 2)
    });
  });
  return { clips: [...clips], frames };
};
