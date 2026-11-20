import { Box3, type Group, InterpolateDiscrete, type Mesh, type MeshStandardMaterial,VectorKeyframeTrack } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";

/** Runtime ordering is independent of authored recipe metadata and completed geometry. */
export const romanConstructionStage = (part: BuildingPart) => {
  if (part.stage < 2) return part.stage;
  if (part.shape === "gable") return 2;
  if (part.stage === 3 && part.surface === "stone" && part.shape === "box" &&
    part.size[0] > .7 && part.size[2] > .7 && part.size[1] < .16) return 2;
  if (part.surface === "roof" || part.surface.startsWith("roof-") || (part.surface === "stone" && part.stage === 4)) return 3;
  // Authored columns, canopy posts and roof frames precede the roof and fit-out.
  if (part.stage === 2 && ["stone", "wood", "bark"].includes(part.surface)) return 2;
  return 4;
};

/** Foundation, masonry, structural framing, roof tiles, then operational fittings. */
const ROMAN_CONSTRUCTION_PHASES = [0, .08, .48, .60, .90, 1] as const;
const romanConstructionAmount = (stage: number, progress: number) => {
  const start = stage === 3 ? .68 : ROMAN_CONSTRUCTION_PHASES[stage]!, end = ROMAN_CONSTRUCTION_PHASES[stage+1]!;
  return Math.max(0,Math.min(1,(progress-start)/(end-start)));
};

/** Original mesh vertices stay at their completed positions throughout construction. */
export const prepareRomanConstructionMesh = (mesh: Mesh, ends: number[], wall: boolean) => {
  mesh.userData.constructionEnds = ends;
  if (!wall) return;
  const original = mesh.material as MeshStandardMaterial;
  const material = original.clone();
  const height = { value: Infinity };
  material.onBeforeCompile = (shader, renderer) => {
    original.onBeforeCompile(shader, renderer);
    shader.uniforms.constructionHeight = height;
    shader.vertexShader = `varying float constructionY;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nconstructionY = position.y;");
    shader.fragmentShader = `uniform float constructionHeight;\nvarying float constructionY;\n${shader.fragmentShader}`
      .replace("#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif (constructionY > constructionHeight) discard;");
  };
  material.customProgramCacheKey = () => `${original.customProgramCacheKey()}:roman-construction-courses`;
  mesh.material = material;
  mesh.userData.ownedMaterial = true;
  mesh.geometry.computeBoundingBox();
  mesh.userData.constructionCourses = { height, bounds: mesh.geometry.boundingBox!.clone() };
};

export const updateRomanConstruction = (stages: readonly Group[], progress: number) => {
  stages.forEach((stage, index) => {
    const amount = romanConstructionAmount(index,progress);
    stage.visible = amount > 0;
    stage.scale.setScalar(1);
    for (const child of stage.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) continue;
      const courses = mesh.userData.constructionCourses as { height: { value: number }; bounds: Box3 } | undefined;
      const ends = mesh.userData.constructionEnds as number[];
      if (courses) {
        const fraction = Math.ceil(amount * 12) / 12;
        courses.height.value = amount === 1 ? Infinity :
          courses.bounds.min.y + (courses.bounds.max.y - courses.bounds.min.y) * fraction;
        mesh.geometry.setDrawRange(0, amount > 0 ? ends.at(-1)! : 0);
      } else {
        const visible = amount > 0 ? Math.ceil(amount * ends.length) : 0;
        mesh.geometry.setDrawRange(0, visible ? ends[visible - 1]! : 0);
      }
    }
  });
};

/** GLB supports STEP scale tracks: pieces appear instantly, never rise or stretch through other parts. */
export const romanConstructionTracks = (stages: readonly Group[]) => stages.map((stage, index) =>
  new VectorKeyframeTrack(`${stage.name}.scale`, [0, (index === 3 ? .68 : ROMAN_CONSTRUCTION_PHASES[index]!) * 9 + .01, 9],
    [0, 0, 0, 1, 1, 1, 1, 1, 1], InterpolateDiscrete));
