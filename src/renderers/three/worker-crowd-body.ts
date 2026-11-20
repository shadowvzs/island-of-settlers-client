import { TEAM_TINT_MATERIAL } from "@workers/character-lods/lod-policy";
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  type Material,
  MeshStandardMaterial,
  type Skeleton,
  SkinnedMesh,
  type WebGLProgramParametersWithUniforms
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Per-vertex surface of a merged crowd body: roughness, metalness, flags (team tint 1 + front faces
 * only 2) and the part's alpha cut-off (0: none).
 */
const SURFACE_ATTRIBUTE = "crowdSurface";
const SURFACE_ITEMS = 4;
const RGBA_ITEMS = 4;
const RGB_ITEMS = 3;
const TINT_FLAG = 1;
const FRONT_FLAG = 2;
const CROWD_BODY_MATERIAL = "crowd_body";
/** Parameters every merged part must share (anything else stays per part: no merge). */
const SHARED_PARAMETERS = ["alphaToCoverage", "blending", "depthTest", "depthWrite",
  "emissiveIntensity", "envMapIntensity", "flatShading", "fog", "opacity", "polygonOffset", "toneMapped",
  "transparent", "vertexColors", "wireframe"] as const;
const SURFACE_MAPS = ["alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap", "envMap", "lightMap",
  "map", "metalnessMap", "normalMap", "roughnessMap"] as const;

/**
 * The single material of a merged LOD2/LOD3 crowd body (C04 levels: baked vertex colours, no maps).
 * Each part's colour factor is baked into its vertex colours; roughness, metalness, the team tint
 * weight, single-sided culling and an alpha cut-off come from a per-vertex attribute, so the body
 * draws once with the same pixels as its separate parts. `tint` plays the old tint cloth's colour (setTeamColor);
 * `color` stays a uniform multiplier on every part, as the hover brightening expects.
 */
export class CrowdBodyMaterial extends MeshStandardMaterial {
  /** Team tint of the vertices that belonged to the TEAM_TINT_MATERIAL part. */
  readonly tint = new Color(1, 1, 1);
  /** Mixed single- and double-sided parts: drawn double-sided, single-sided vertices drop back faces. */
  frontFacesOnly = false;
  /** A part had an alpha cut-off (alphaMode MASK): its vertices carry it, the others carry 0. */
  alphaCutoff = false;

  constructor() {
    super({ vertexColors: true });
    this.name = CROWD_BODY_MATERIAL;
  }

  override copy(source: MeshStandardMaterial): this {
    super.copy(source);
    if (source instanceof CrowdBodyMaterial) {
      this.tint.copy(source.tint);
      this.frontFacesOnly = source.frontFacesOnly;
      this.alphaCutoff = source.alphaCutoff;
    }
    return this;
  }

  override customProgramCacheKey(): string {
    return `${CROWD_BODY_MATERIAL}:${this.frontFacesOnly}:${this.alphaCutoff}`;
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    shader.uniforms.crowdTint = { value: this.tint };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>",
        `#include <common>\nattribute vec4 ${SURFACE_ATTRIBUTE};\nflat varying vec4 vCrowdSurface;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvCrowdSurface = ${SURFACE_ATTRIBUTE};`);
    const cull = this.frontFacesOnly ? `if ( vCrowdSurface.z >= ${FRONT_FLAG}.0 && ! gl_FrontFacing ) discard;\n` : "";
    // The cut-off tests the part's own alpha: a figure fading (opacity < 1) must not lose its masked parts.
    const cutoff = this.alphaCutoff ? "\nif ( diffuseColor.a < vCrowdSurface.w * opacity ) discard;" : "";
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 crowdTint;\nflat varying vec4 vCrowdSurface;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${cull}`)
      .replace("#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= mix( vec3( 1.0 ), crowdTint, mod( vCrowdSurface.z, 2.0 ) );")
      .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>${cutoff}`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vCrowdSurface.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vCrowdSurface.y;");
  }
}

const singleMaterial = (mesh: SkinnedMesh) =>
  !Array.isArray(mesh.material) && mesh.material instanceof MeshStandardMaterial ? mesh.material : undefined;

const sharesParameters = (first: MeshStandardMaterial, material: MeshStandardMaterial) =>
  SHARED_PARAMETERS.every(key => material[key] === first[key]) && material.emissive.equals(first.emissive) &&
  SURFACE_MAPS.every(key => !material[key]);

/** The loader gives each primitive of the one skin its own Skeleton over the same bones and inverses. */
const sameBones = (first: Skeleton, skeleton: Skeleton) => skeleton === first ||
  skeleton.bones.length === first.bones.length && skeleton.bones.every((bone, index) => bone === first.bones[index]) &&
  skeleton.boneInverses.every((inverse, index) => inverse.equals(first.boneInverses[index]!));

const sameSkin = (first: SkinnedMesh, mesh: SkinnedMesh) =>
  sameBones(first.skeleton, mesh.skeleton) && mesh.parent === first.parent &&
  mesh.bindMatrix.equals(first.bindMatrix) && mesh.matrix.equals(first.matrix) &&
  !Object.keys(mesh.geometry.morphAttributes).length;

const attributeLayout = (geometry: BufferGeometry) => Object.keys(geometry.attributes).sort().join("|");

const attributeType = (attribute: BufferAttribute) => `${attribute.array.constructor.name}:${attribute.normalized}`;

/** Float copy of an attribute: the values the vertex stage reads from the quantised one (KHR_mesh_quantization). */
const floatAttribute = (attribute: BufferAttribute) => {
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let vertex = 0; vertex < attribute.count; vertex++)
    for (let item = 0; item < attribute.itemSize; item++)
      values[vertex * attribute.itemSize + item] = attribute.getComponent(vertex, item);
  return new BufferAttribute(values, attribute.itemSize);
};

/** Parts quantised differently (Int8 against Int16 positions) share float attributes, as merging needs. */
const alignAttributeTypes = (parts: readonly BufferGeometry[]) => {
  for (const name of Object.keys(parts[0]!.attributes)) {
    const attributes = parts.map(part => part.getAttribute(name) as BufferAttribute);
    if (new Set(attributes.map(attributeType)).size === 1) continue;
    parts.forEach((part, index) => part.setAttribute(name, floatAttribute(attributes[index]!)));
  }
};

/** One part's geometry with its colour factor baked and its surface attribute; null when it cannot merge. */
const surfaceGeometry = (source: BufferGeometry, material: MeshStandardMaterial, frontFacesOnly: boolean) => {
  const color = source.getAttribute("color");
  if (!color || color.itemSize !== RGBA_ITEMS) return null;
  const geometry = source.clone();
  const tinted = material.name === TEAM_TINT_MATERIAL;
  const colors = new Float32Array(color.count * RGBA_ITEMS);
  for (let vertex = 0; vertex < color.count; vertex++) {
    const offset = vertex * RGBA_ITEMS;
    colors[offset] = color.getX(vertex) * (tinted ? 1 : material.color.r);
    colors[offset + 1] = color.getY(vertex) * (tinted ? 1 : material.color.g);
    colors[offset + 2] = color.getZ(vertex) * (tinted ? 1 : material.color.b);
    colors[offset + RGB_ITEMS] = color.getW(vertex);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, RGBA_ITEMS));
  const flags = (tinted ? TINT_FLAG : 0) + (frontFacesOnly && material.side === FrontSide ? FRONT_FLAG : 0);
  const surface = new Float32Array(color.count * SURFACE_ITEMS);
  for (let vertex = 0; vertex < color.count; vertex++)
    surface.set([material.roughness, material.metalness, flags, material.alphaTest], vertex * SURFACE_ITEMS);
  geometry.setAttribute(SURFACE_ATTRIBUTE, new BufferAttribute(surface, SURFACE_ITEMS));
  return geometry;
};

const mergedMaterial = (
  first: MeshStandardMaterial, frontFacesOnly: boolean, alphaCutoff: boolean, side: Material["side"]
) => {
  const material = new CrowdBodyMaterial();
  for (const key of SHARED_PARAMETERS) (material as unknown as Record<string, unknown>)[key] = first[key];
  material.emissive.copy(first.emissive);
  material.frontFacesOnly = frontFacesOnly;
  material.alphaCutoff = alphaCutoff;
  material.side = frontFacesOnly ? DoubleSide : side;
  return material;
};

/**
 * Owner 2026-11-07 (perf lane): one draw per LOD2/LOD3 character. The level's skinned parts (one
 * skin, C04) become one SkinnedMesh on the same skeleton and bind matrix, so the C05 swap, the
 * joints, inverse binds and the tool/cargo sockets are untouched. Null (keep the parts) when the
 * parts differ in anything the merged material cannot carry per vertex.
 */
export const mergeCrowdLevelMeshes = (meshes: readonly SkinnedMesh[]): SkinnedMesh | null => {
  const first = meshes[0];
  if (!first || meshes.length < 2) return null;
  const materials = meshes.map(singleMaterial);
  const firstMaterial = materials[0];
  if (!firstMaterial || materials.some(material => !material || !sharesParameters(firstMaterial, material)) ||
    meshes.some(mesh => !sameSkin(first, mesh))) return null;
  const frontFacesOnly = new Set(materials.map(material => material!.side)).size > 1;
  const parts = meshes.map((mesh, index) => surfaceGeometry(mesh.geometry, materials[index]!, frontFacesOnly));
  const layout = parts[0] && attributeLayout(parts[0]);
  const aligned = parts.every(part => part && attributeLayout(part) === layout);
  if (aligned) alignAttributeTypes(parts as BufferGeometry[]);
  const geometry = aligned ? mergeGeometries(parts as BufferGeometry[]) : null;
  for (const part of parts) part?.dispose();
  if (!geometry) return null;
  const alphaCutoff = materials.some(material => material!.alphaTest > 0);
  const merged = new SkinnedMesh(geometry,
    mergedMaterial(firstMaterial, frontFacesOnly, alphaCutoff, firstMaterial.side));
  merged.name = first.name;
  merged.frustumCulled = first.frustumCulled;
  merged.castShadow = first.castShadow;
  merged.receiveShadow = first.receiveShadow;
  merged.position.copy(first.position);
  merged.quaternion.copy(first.quaternion);
  merged.scale.copy(first.scale);
  merged.bind(first.skeleton, first.bindMatrix);
  return merged;
};

/** The per-actor tint clone: a merged body draws its team colour from `tint`. */
export const setCrowdBodyTint = (material: Material, color: string | number | Color) => {
  if (!(material instanceof CrowdBodyMaterial)) return false;
  material.tint.set(color);
  return true;
};
