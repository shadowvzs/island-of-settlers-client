import { Box3, MeshBasicMaterial, PlaneGeometry, Sphere, SRGBColorSpace, type Texture, Vector3 } from "three";

export interface OrnamentalOverviewImage {
  image: string;
  width: number;
  height: number;
  /** Actual local ground origin projected into the transparent canonical icon, bottom-left UV. */
  pivot: readonly [number, number];
}

/** Two triangles keep the icon's transparent padding and calibrated ground-contact projection. */
export const createOrnamentalOverviewGeometry = (image: OrnamentalOverviewImage) => {
  const geometry = new PlaneGeometry(image.width, image.height);
  geometry.translate((.5 - image.pivot[0]) * image.width, (.5 - image.pivot[1]) * image.height, 0);
  const radius = Math.hypot(Math.max(image.pivot[0], 1 - image.pivot[0]) * image.width,
    Math.max(image.pivot[1], 1 - image.pivot[1]) * image.height);
  // The shader turns the plane toward the camera. Original XY-only bounds would cull valid instances.
  geometry.boundingBox = new Box3(new Vector3(-radius, -radius, -radius), new Vector3(radius, radius, radius));
  geometry.boundingSphere = new Sphere(new Vector3(), radius);
  return geometry;
};

/** A tiny projected overview uses actual canonical rendered pixels; close/far retain real3D yaw. */
export const createOrnamentalOverviewMaterial = (texture: Texture) => {
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, alphaTest: .08, toneMapped: false });
  material.name = "ornamental-canonical-overview";
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
      mat4 ornamentalWorld = modelMatrix;
      #ifdef USE_INSTANCING
        ornamentalWorld = modelMatrix * instanceMatrix;
      #endif
      vec3 ornamentalRoot = (ornamentalWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 ornamentalRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 ornamentalUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 ornamentalBillboard = ornamentalRoot +
        ornamentalRight * transformed.x * length(ornamentalWorld[0].xyz) +
        ornamentalUp * transformed.y * length(ornamentalWorld[1].xyz);
      vec4 mvPosition = viewMatrix * vec4(ornamentalBillboard, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  material.customProgramCacheKey = () => "ornamental-canonical-overview-v1-root-pinned";
  return material;
};
