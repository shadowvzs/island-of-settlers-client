import { Box3, DoubleSide, MeshBasicMaterial, MeshDepthMaterial, PlaneGeometry, RGBADepthPacking, SRGBColorSpace, type Texture,Vector3 } from "three";

import { excludeFromAmbientOcclusion } from "../ambient-occlusion-exclusion";

export const PEACH_IMPOSTOR = { columns: 8, rows: 2, tile: 256, elevations: [30, 55], width: 5.8, height: 6.4, centre: 2.9 } as const;

/** Original canonical renders, never a substitute for individual close flower geometry. */
export const createPeachTreeImpostorMaterial = (atlas: Texture) => {
  atlas.colorSpace = SRGBColorSpace;
  // R12b: a flat impostor card receives no screen-space occlusion.
  const material = excludeFromAmbientOcclusion(new MeshBasicMaterial({ map: atlas, alphaTest: .45, toneMapped: false }));
  material.name = "peach-distant-canonical-impostor";
  material.shadowSide = DoubleSide;
  const depth = new MeshDepthMaterial({ map: atlas, alphaTest: .45, depthPacking: RGBADepthPacking });
  material.userData.peachDepthMaterial = depth;
  let disposed = false;
  material.addEventListener("dispose", () => { if (!disposed) { disposed = true; depth.dispose(); } });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", `
      #include <uv_vertex>
      mat4 peachWorld = modelMatrix;
      #ifdef USE_INSTANCING
        peachWorld = modelMatrix * instanceMatrix;
      #endif
      vec3 peachCentre = (peachWorld * vec4(0.0, ${PEACH_IMPOSTOR.centre.toFixed(1)}, 0.0, 1.0)).xyz;
      vec3 peachDirection = isOrthographic ?
        vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : normalize(cameraPosition - peachCentre);
      vec3 peachLocal = vec3(dot(peachDirection, normalize(peachWorld[0].xyz)),
        dot(peachDirection, normalize(peachWorld[1].xyz)),
        dot(peachDirection, normalize(peachWorld[2].xyz)));
      float peachColumn = mod(floor(atan(peachLocal.x, peachLocal.z) * 8.0 / 6.28318530718 + .5) + 8.0, 8.0);
      float peachRow = atan(peachLocal.y, length(peachLocal.xz)) > .7417649321 ? 1.0 : 0.0;
      // PNG rows are top to bottom; vMapUv uses bottom to top texture coordinates.
      vMapUv = (vec2(peachColumn, 1.0 - peachRow) + vec2(.008) + uv * .984) / vec2(8.0, 2.0);
    `).replace("#include <project_vertex>", `
      vec3 peachRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 peachUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float peachScaleX = length(peachWorld[0].xyz);
      float peachScaleY = length(peachWorld[1].xyz);
      vec3 peachRoot = (peachWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float peachLift = ${PEACH_IMPOSTOR.centre.toFixed(1)} * cos(peachRow > .5 ? .9599310886 : .5235987756);
      // Pin the baked ground contact to the actual instance root rather than floating a centre-pivot quad.
      vec3 peachBillboard = peachRoot + peachRight * position.x * peachScaleX +
        peachUp * (position.y + peachLift) * peachScaleY;
      vec4 mvPosition = viewMatrix * vec4(peachBillboard, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  depth.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile(shader, renderer);
    // Three refreshes isOrthographic for colour materials, not MeshDepthMaterial. Directional shadows are orthographic.
    shader.vertexShader = shader.vertexShader.replace("isOrthographic ?", "true ?");
  };
  material.customProgramCacheKey = () => "peach-directional-impostor-v2-root-pinned";
  depth.customProgramCacheKey = () => "peach-directional-impostor-depth-v2-root-pinned";
  return material;
};

/** Flat Mesh geometry works in decoration instancing; shader applies each instance's world transform. */
export const createPeachTreeImpostorGeometry = () => {
  const geometry = new PlaneGeometry(PEACH_IMPOSTOR.width, PEACH_IMPOSTOR.height);
  // Conservative world bounds include all rotated camera-facing orientations, roots and mature crown.
  geometry.boundingBox = new Box3(new Vector3(-PEACH_IMPOSTOR.width / 2,
    PEACH_IMPOSTOR.centre - PEACH_IMPOSTOR.height / 2, -PEACH_IMPOSTOR.width / 2),
  new Vector3(PEACH_IMPOSTOR.width / 2, PEACH_IMPOSTOR.centre + PEACH_IMPOSTOR.height / 2, PEACH_IMPOSTOR.width / 2));
  geometry.computeBoundingSphere();
  geometry.boundingSphere!.center.y = PEACH_IMPOSTOR.centre;
  geometry.boundingSphere!.radius = Math.hypot(PEACH_IMPOSTOR.width, PEACH_IMPOSTOR.height) / 2 + PEACH_IMPOSTOR.centre;
  return geometry;
};
