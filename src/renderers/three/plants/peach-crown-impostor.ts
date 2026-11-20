import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, MeshDepthMaterial,
  RGBADepthPacking, SRGBColorSpace, type Texture } from "three";

import { excludeFromAmbientOcclusion } from "../ambient-occlusion-exclusion";
import type { createPeachCrownLayout } from "./peach-crown-layout";

/** Eight separately positioned original branch-mass captures retain crown depth around real close sprigs. */
export const createPeachCrownImpostorMaterial = (atlas: Texture) => {
  atlas.colorSpace = SRGBColorSpace;
  // R12b: flat capture cards receive no screen-space occlusion.
  const material = excludeFromAmbientOcclusion(new MeshBasicMaterial({ map: atlas, alphaTest: .35, toneMapped: false }));
  material.name = "peach-original-crown-masses"; material.shadowSide = DoubleSide;
  const depth = new MeshDepthMaterial({ map: atlas, alphaTest: .35, depthPacking: RGBADepthPacking });
  material.userData.peachDepthMaterial = depth;
  let disposed = false;
  material.addEventListener("dispose", () => { if (!disposed) { disposed = true; depth.dispose(); } });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute vec3 peachCentre; attribute float peachMass; attribute float peachRadius; varying float peachCaptureVisibility;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", `
      #include <uv_vertex>
      mat4 peachWorld = modelMatrix;
      #ifdef USE_INSTANCING
        peachWorld = modelMatrix * instanceMatrix;
      #endif
      vec3 peachWorldCentre = (peachWorld * vec4(peachCentre, 1.0)).xyz;
      vec3 peachCameraCentre = (viewMatrix * vec4(peachWorldCentre, 1.0)).xyz;
      float peachScale = max(length(peachWorld[0].xyz), max(length(peachWorld[1].xyz), length(peachWorld[2].xyz)));
      float peachDiameter = 2.0 * peachRadius * peachScale * abs(projectionMatrix[1][1]);
      if (!isOrthographic) peachDiameter /= max(.001, -peachCameraCentre.z);
      peachCaptureVisibility = 1.0 - smoothstep(1.2, 2.0, peachDiameter);
      vec3 peachDirection = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) :
        normalize(cameraPosition - peachWorldCentre);
      vec3 peachLocal = vec3(dot(peachDirection, normalize(peachWorld[0].xyz)),
        dot(peachDirection, normalize(peachWorld[1].xyz)), dot(peachDirection, normalize(peachWorld[2].xyz)));
      float peachColumn = mod(floor(atan(peachLocal.x, peachLocal.z) * 8.0 / 6.28318530718 + .5) + 8.0, 8.0);
      float peachRow = atan(peachLocal.y, length(peachLocal.xz)) > .7417649321 ? 1.0 : 0.0;
      vMapUv = (vec2(peachColumn, 15.0 - peachMass * 2.0 - peachRow) + vec2(.012) + uv * .976) / vec2(8.0, 16.0);
    `).replace("#include <project_vertex>", `
      vec3 peachRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 peachUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 peachBillboard = peachWorldCentre + peachRight * (position.x - peachCentre.x) * length(peachWorld[0].xyz) +
        peachUp * (position.y - peachCentre.y) * length(peachWorld[1].xyz);
      vec4 mvPosition = viewMatrix * vec4(peachBillboard, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    `);
    shader.fragmentShader = `varying float peachCaptureVisibility;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
      "#include <map_fragment>\n diffuseColor.a *= peachCaptureVisibility;");
  };
  depth.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("isOrthographic ?", "true ?");
    shader.fragmentShader = shader.fragmentShader.replace("diffuseColor.a *= peachCaptureVisibility;", "");
  };
  material.customProgramCacheKey = () => "peach-original-crown-masses-v2-close-detail";
  depth.customProgramCacheKey = () => "peach-original-crown-masses-depth-v2-close-detail";
  return material;
};

export const createPeachCrownImpostorGeometry = (layout: ReturnType<typeof createPeachCrownLayout>) => {
  const positions: number[] = [], centres: number[] = [], masses: number[] = [], radii: number[] = [], uvs: number[] = [], indices: number[] = [];
  layout.forEach(({ centre, radius }, mass) => {
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(centre[0] + x! * radius, centre[1] + y! * radius, centre[2]);
      centres.push(...centre); masses.push(mass); radii.push(radius); uvs.push((x! + 1) / 2, (y! + 1) / 2);
    }
    const at = mass * 4; indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("peachCentre", new Float32BufferAttribute(centres, 3));
  geometry.setAttribute("peachMass", new Float32BufferAttribute(masses, 1));
  geometry.setAttribute("peachRadius", new Float32BufferAttribute(radii, 1));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  // Shader rotates each mass plane in3D; the full tree's sphere includes every such orientation.
  geometry.boundingSphere!.radius += Math.max(...layout.map(mass => mass.radius));
  return geometry;
};
