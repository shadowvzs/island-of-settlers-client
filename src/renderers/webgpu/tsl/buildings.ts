import {
  attribute,
  clamp,
  cos,
  Discard,
  dot,
  float,
  Fn,
  mat3,
  modelWorldMatrix,
  positionLocal,
  positionWorld,
  sin,
  uniform,
  uv,
  varying,
  vec3,
  vec4
} from "three/tsl";
import { type Material, MeshStandardNodeMaterial, type Object3D } from "three/webgpu";

import { HANGING_DECOR_SWAY, hangingDecorSwayUniforms } from "../../three/buildings/hanging-decor-sway";
import { NUBIAN_CLOTH_WIND } from "../../three/buildings/nubian-decor-materials";
import {
  bindComputed,
  bindScalar,
  createUniformBindings,
  syncUniformBindings
} from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * Building-surface extensions the generic standard-material port cannot express, ported from the
 * WebGL `onBeforeCompile` hooks: Roman construction course clipping, monument construction
 * clipping, hanging-decor sway and Nubian cloth wind. Everything else is a plain lit surface.
 */

interface ConstructionCourses { height: { value: number } }

const shaderKeyOf = (source: Material) =>
  (source.userData as { shaderKey?: string }).shaderKey;

const coursesOf = (object: Object3D) =>
  (object.userData as { constructionCourses?: ConstructionCourses }).constructionCourses;

/** `if (position.y > constructionHeight) discard;` for a Roman wall being built. */
const addCourseClip = (material: MeshStandardNodeMaterial, courses: ConstructionCourses) => {
  const height = uniform(courses.height.value);
  const constructionY = varying(positionLocal.y, "vConstructionY") as TslNode;
  material.opacityNode = Fn(() => {
    Discard(constructionY.greaterThan(height));
    return float(1);
  })();
  material.userData.syncUniforms = () => { height.value = courses.height.value; };
};

/** `if (worldY > constructionHeight) discard;` for the supplied monument models. */
const addMonumentClip = (material: MeshStandardNodeMaterial, heightSource: { value: number }) => {
  const height = uniform(heightSource.value);
  material.opacityNode = Fn(() => {
    Discard(positionWorld.y.greaterThan(height));
    return float(1);
  })();
  material.userData.syncUniforms = () => { height.value = heightSource.value; };
};

/** The hanging decor rotates about its pivot with two small pendulum angles, stronger in wind. */
const createSwayRotation = () => {
  const sway = HANGING_DECOR_SWAY;
  const bindings = createUniformBindings("hanging-decor-sway", hangingDecorSwayUniforms);
  const pivot = attribute("swayPivot", "vec3") as TslNode;
  const time = bindScalar(bindings, "uSwayTime");
  const wind = bindScalar(bindings, "uSwayWind");
  const origin = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz as TslNode;
  const phase = dot(pivot, vec3(sway.phaseWeightX, sway.phaseWeightY, sway.phaseWeightZ))
    .add(origin.x.mul(sway.originXWeight)).add(origin.z.mul(sway.originZWeight));
  const strength = float(sway.strengthBase)
    .add(clamp(wind, sway.windClampMin, sway.windClampMax).mul(sway.strengthWind));
  const pitch = strength.mul(sin(time.mul(sway.pitchRate).add(phase)));
  const roll = strength.mul(sway.rollShare)
    .mul(sin(time.mul(sway.rollRate).add(phase.mul(sway.rollPhaseWeight)).add(sway.rollPhase)));
  const cp = cos(pitch), sp = sin(pitch), cr = cos(roll), sr = sin(roll);
  const aroundX = mat3(vec3(1, 0, 0), vec3(0, cp, sp), vec3(0, sp.negate(), cp));
  const aroundZ = mat3(vec3(cr, sr, 0), vec3(sr.negate(), cr, 0), vec3(0, 0, 1));
  return { bindings, pivot, rotation: aroundZ.mul(aroundX) as TslNode };
};

const addSway = (material: MeshStandardNodeMaterial) => {
  const normal = createSwayRotation();
  material.normalNode = normal.rotation.mul(attribute("normal", "vec3"));
  const position = createSwayRotation();
  material.positionNode = position.pivot.add(position.rotation.mul(positionLocal.sub(position.pivot)));
  material.userData.syncUniforms = () => {
    syncUniformBindings(normal.bindings);
    syncUniformBindings(position.bindings);
  };
};

/** The Nubian hanging cloth: the hem below the rod billows along its own normal and ripples. */
const addClothWind = (material: MeshStandardNodeMaterial) => {
  const cloth = NUBIAN_CLOTH_WIND;
  const bindings = createUniformBindings("nubian-cloth-wind", {});
  // The WebGL material's onBeforeRender clock does not run under the node renderer.
  const time = bindComputed(bindings, () => performance.now() / 1000);
  const coord = uv() as TslNode;
  const hang = clamp(float(cloth.hangMax).sub(coord.y), cloth.hangMin, cloth.hangMax);
  const phase = time.mul(cloth.timeScale).add(positionLocal.x.mul(cloth.phaseX))
    .add(positionLocal.z.mul(cloth.phaseZ));
  const ripple = sin(phase.add(coord.y.mul(cloth.rippleUvY)).sub(coord.x.mul(cloth.rippleUvX)))
    .mul(cloth.rippleShare).add(cloth.rippleOffset);
  const gust = float(cloth.gustBase).add(sin(phase.mul(cloth.gustRate)).mul(cloth.gustShare));
  const billow = hang.mul(hang)
    .mul(float(cloth.billowBase).add(ripple.mul(gust).mul(cloth.billowRipple)));
  material.positionNode = positionLocal.add(attribute("normal", "vec3").mul(billow));
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
};

/**
 * Applies the building-specific vertex/fragment extensions the generic stand-in cannot carry.
 * Called for every stand-in; materials without a building marker keep the plain lit surface.
 * Returns the extension name for the material name and the substitution counts, else null.
 */
export const applyBuildingMaterialExtensions = (material: Material, source: Material, object: Object3D) => {
  if (!(material instanceof MeshStandardNodeMaterial)) return null;
  const courses = coursesOf(object);
  if (courses !== undefined) {
    addCourseClip(material, courses);
    return "building-construction";
  }
  const shaderKey = shaderKeyOf(source);
  if (shaderKey === "monument-construction-v1") {
    const height = (source.userData as { constructionHeight?: { value: number } }).constructionHeight;
    if (height !== undefined) {
      addMonumentClip(material, height);
      return "monument-construction";
    }
    return null;
  }
  if (shaderKey === "hanging-decor-sway-v1") {
    addSway(material);
    return "building-sway";
  }
  if (shaderKey === "nubian-cloth-wind-v1") {
    addClothWind(material);
    return "building-cloth-wind";
  }
  return null;
};
