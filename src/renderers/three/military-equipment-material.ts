import { Color, type ColorRepresentation, MeshStandardMaterial, type Texture } from "three";

/**
 * The single armoury material: vertex colour x atlas paint, per-vertex metalness / roughness and
 * the faction livery from `equipmentSurface` (x metal, y rough, z dye) or the atlas alpha mask.
 * Player and enemy materials differ only in the livery uniform and share one shader program.
 */
const VERTEX_DECLARATIONS = "#include <common>\nattribute vec3 equipmentSurface;\nvarying vec3 vEquipmentSurface;";
const FRAGMENT_DECLARATIONS = "#include <common>\nuniform vec3 equipmentLivery;\nvarying vec3 vEquipmentSurface;";
const PAINT = `vec4 equipmentPaint = texture2D( map, vMapUv );
float equipmentDye = max( vEquipmentSurface.z, 1.0 - equipmentPaint.a );
diffuseColor.rgb *= equipmentPaint.rgb * mix( vec3( 1.0 ), equipmentLivery, equipmentDye );`;

export const createEquipmentMaterial = (atlas: Texture, livery: ColorRepresentation) => {
  const uniform = { value: new Color(livery) };
  const material = new MeshStandardMaterial({ map: atlas, vertexColors: true });
  material.name = "military_equipment";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.equipmentLivery = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", VERTEX_DECLARATIONS)
      .replace("#include <color_vertex>", "#include <color_vertex>\nvEquipmentSurface = equipmentSurface;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", FRAGMENT_DECLARATIONS)
      .replace("#include <map_fragment>", PAINT)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vEquipmentSurface.y;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vEquipmentSurface.x;");
  };
  material.customProgramCacheKey = () => "military_equipment";
  return { material, setLivery: (color: ColorRepresentation) => uniform.value.set(color) };
};
