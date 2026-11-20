import type { MeshStandardMaterial, Texture, WebGLProgramParametersWithUniforms } from "three";

import { CrowdBodyMaterial } from "./worker-crowd-body";
import { CROWD_BAKE_QUANTIZATION } from "./worker-gpu-bake";

/**
 * C06: the merged LOD3 crowd body drawn as instances. Each instance carries its root matrix
 * (`instanceMatrix`), its pose rows (`crowdPose` = row A, row B, A→B mix; `crowdBlend` = fading
 * previous row and its weight) and its team tint. Skinning samples the body type's baked
 * bone-matrix texture instead of a per-actor skeleton: the mesh placement, bind and inverse bind
 * matrices are baked in, so the sampled matrices apply to the vertex positions directly.
 */
const CROWD_INSTANCED_MATERIAL = "crowd_instanced";

export const CROWD_POSE_ATTRIBUTE = "crowdPose";
export const CROWD_BLEND_ATTRIBUTE = "crowdBlend";
export const CROWD_TINT_ATTRIBUTE = "crowdTint";
export const CROWD_JOINT_ATTRIBUTE = "crowdJoint";

/** 16-bit fixed-point texels of the baked matrices (C06b): `ivec4 / CROWD_BAKE_QUANTIZATION`. */
const CROWD_TEXEL_SCALE = `${1 / CROWD_BAKE_QUANTIZATION}`;

const CROWD_SKIN_PARS = /* glsl */`
uniform isampler2D crowdBones;
attribute vec4 ${CROWD_JOINT_ATTRIBUTE};
attribute vec4 skinWeight;
attribute vec4 ${CROWD_POSE_ATTRIBUTE};
attribute vec2 ${CROWD_BLEND_ATTRIBUTE};
attribute vec3 ${CROWD_TINT_ATTRIBUTE};
varying vec3 vCrowdTint;
mat4 crowdBoneRow( int row, int joint ) {
	int column = joint * 3;
	vec4 a = vec4( texelFetch( crowdBones, ivec2( column, row ), 0 ) ) * ${CROWD_TEXEL_SCALE};
	vec4 b = vec4( texelFetch( crowdBones, ivec2( column + 1, row ), 0 ) ) * ${CROWD_TEXEL_SCALE};
	vec4 c = vec4( texelFetch( crowdBones, ivec2( column + 2, row ), 0 ) ) * ${CROWD_TEXEL_SCALE};
	return mat4( vec4( a.x, b.x, c.x, 0.0 ), vec4( a.y, b.y, c.y, 0.0 ), vec4( a.z, b.z, c.z, 0.0 ),
		vec4( a.w, b.w, c.w, 1.0 ) );
}
mat4 crowdBoneAt( float row, int joint ) {
	int base = int( floor( row ) );
	mat4 first = crowdBoneRow( base, joint );
	return first + ( crowdBoneRow( base + 1, joint ) - first ) * fract( row );
}
mat4 crowdBone( int joint ) {
	mat4 bone = crowdBoneAt( ${CROWD_POSE_ATTRIBUTE}.x, joint );
	if ( ${CROWD_POSE_ATTRIBUTE}.z > 0.0 )
		bone += ( crowdBoneAt( ${CROWD_POSE_ATTRIBUTE}.y, joint ) - bone ) * ${CROWD_POSE_ATTRIBUTE}.z;
	if ( ${CROWD_BLEND_ATTRIBUTE}.y > 0.0 )
		bone += ( crowdBoneAt( ${CROWD_BLEND_ATTRIBUTE}.x, joint ) - bone ) * ${CROWD_BLEND_ATTRIBUTE}.y;
	return bone;
}
`;

const CROWD_SKIN_BASE = /* glsl */`
mat4 boneMatX = crowdBone( int( ${CROWD_JOINT_ATTRIBUTE}.x ) );
mat4 boneMatY = crowdBone( int( ${CROWD_JOINT_ATTRIBUTE}.y ) );
mat4 boneMatZ = crowdBone( int( ${CROWD_JOINT_ATTRIBUTE}.z ) );
mat4 boneMatW = crowdBone( int( ${CROWD_JOINT_ATTRIBUTE}.w ) );
`;

const CROWD_SKIN_NORMAL = /* glsl */`
mat4 skinMatrix = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ +
	skinWeight.w * boneMatW;
objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
`;

const CROWD_SKIN_VERTEX = /* glsl */`
vec4 skinVertex = vec4( transformed, 1.0 );
vec4 skinned = boneMatX * skinVertex * skinWeight.x + boneMatY * skinVertex * skinWeight.y +
	boneMatZ * skinVertex * skinWeight.z + boneMatW * skinVertex * skinWeight.w;
transformed = skinned.xyz;
`;

export class CrowdInstancedMaterial extends CrowdBodyMaterial {
  /** The body type's baked bone-matrix texture (fixed for the material's life). */
  bones: Texture | null = null;

  constructor(source?: MeshStandardMaterial, bones?: Texture) {
    super();
    if (source) this.copy(source);
    this.name = CROWD_INSTANCED_MATERIAL;
    this.bones = bones ?? null;
  }

  override customProgramCacheKey(): string {
    return `${CROWD_INSTANCED_MATERIAL}:${this.frontFacesOnly}:${this.alphaCutoff}`;
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    super.onBeforeCompile(shader);
    shader.uniforms.crowdBones = { value: this.bones };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${CROWD_SKIN_PARS}`)
      .replace("#include <skinbase_vertex>", CROWD_SKIN_BASE)
      .replace("#include <skinnormal_vertex>", CROWD_SKIN_NORMAL)
      .replace("#include <skinning_vertex>", CROWD_SKIN_VERTEX)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvCrowdTint = ${CROWD_TINT_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("uniform vec3 crowdTint;", "varying vec3 vCrowdTint;")
      .replace("mix( vec3( 1.0 ), crowdTint,", "mix( vec3( 1.0 ), vCrowdTint,");
  }
}
