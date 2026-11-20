import {
  BackSide, BufferAttribute, BufferGeometry, type IUniform, type Material, Matrix4, Mesh, type Object3D, type Scene,
  ShaderMaterial, SkinnedMesh
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { DISPLAY_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";
import { pickColorDisplayUniforms } from "../color/color-output-control";

/** One temporary hull draw; shared building materials are restored on every hover change. */
/** The drawn part of a non-indexed geometry (staged bridge sites draw a prefix of their batch). */
const drawnGeometry = (geometry: BufferGeometry) => {
  const { count, start } = geometry.drawRange;
  const total = geometry.getAttribute("position").count;
  if (geometry.index || (start === 0 && count >= total)) return geometry.clone();
  const drawn = new BufferGeometry();
  for (const name of ["position", "normal"]) {
    const attribute = geometry.getAttribute(name);
    if (attribute) drawn.setAttribute(name, new BufferAttribute(
      attribute.array.slice(start * attribute.itemSize, (start + Math.min(count, total)) * attribute.itemSize),
      attribute.itemSize));
  }
  return drawn;
};

export const createBuildingHover = (scene: Scene, options: {
  /** Shared colour uniforms: the hull keeps its exact feedback colour in the HDR scene target. */
  colorUniforms?: Record<string, IUniform>;
  local?: boolean; exclude?: (mesh: Mesh) => boolean; excludeOutline?: (mesh: Mesh) => boolean; name?: string;
  /** Outline only the drawn range of each mesh (bridge sites grow by draw range). */
  respectDrawRange?: boolean;
} = {}) => {
  const hullMaterial = new ShaderMaterial({
    side: BackSide, depthWrite: false, transparent: true,
    uniforms: pickColorDisplayUniforms(options.colorUniforms ?? {}),
    vertexShader: `void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * ${options.local ? ".00875" : ".035"}, 1.0);
    }`,
    fragmentShader: `${DISPLAY_COLOR_OUTPUT_GLSL}
void main() { gl_FragColor = vec4(colorDisplayOutput(vec3(.95, .78, .35)), .55); }`
  });
  const originals = new Map<Mesh, Material | Material[]>();
  const bright = new Map<Material, Material>();
  let selected: Object3D | undefined;
  let hull: Mesh | undefined;
  const clear = () => {
    for (const [mesh, original] of originals) mesh.material = original;
    originals.clear();
    for (const material of bright.values()) material.dispose();
    bright.clear();
    if (hull) { hull.removeFromParent(); hull.geometry.dispose(); hull = undefined; }
    selected = undefined;
  };
  const lifted = (material: Material) => {
    let clone = bright.get(material);
    if (clone) return clone;
    clone = material.clone();
    clone.onBeforeCompile = material.onBeforeCompile;
    clone.customProgramCacheKey = material.customProgramCacheKey;
    if ("color" in clone && clone.color && typeof clone.color === "object" && "multiplyScalar" in clone.color)
      (clone.color as { multiplyScalar: (value: number) => unknown }).multiplyScalar(1.5);
    bright.set(material, clone);
    return clone;
  };
  const set = (root?: Object3D) => {
    if (root === selected) {
      // Texture loading can finish while a ship is hovered; keep the bright clones current.
      for (const [original, clone] of bright) {
        const source = original as Material & { map?: unknown; bumpMap?: unknown; bumpScale?: number };
        const target = clone as Material & { map?: unknown; bumpMap?: unknown; bumpScale?: number };
        if (source.map !== target.map || source.bumpMap !== target.bumpMap) {
          target.map = source.map; target.bumpMap = source.bumpMap;
          target.bumpScale = source.bumpScale; target.needsUpdate = true;
        }
      }
      return;
    }
    clear();
    if (!root) return;
    selected = root;
    root.updateMatrixWorld(true);
    const pieces: BufferGeometry[] = [];
    const inverse = new Matrix4().copy(root.matrixWorld).invert();
    root.traverseVisible(object => {
      if (!(object instanceof Mesh) || object.userData.stock) return;
      if (options.exclude?.(object)) return;
      originals.set(object, object.material);
      object.material = Array.isArray(object.material) ? object.material.map(lifted) : lifted(object.material);
      // Skinned pieces (soldiers) get the brightness, but their animated silhouette cannot freeze into a hull.
      if (object instanceof SkinnedMesh) return;
      if (options.excludeOutline?.(object)) return;
      // Moving parts keep their animation and brightness without a frozen outline.
      for (let parent: Object3D | null = object; parent && parent !== root; parent = parent.parent)
        if (["door", "balcony_door", "mechanism", "activity_banner", "player_flag_mount",
          "furnace_effects", "pig_farm_residents", "pig_farm_pour_stream"].includes(parent.name) ||
          parent.name.startsWith("hunter_cord_")) return;
      const geometry = options.respectDrawRange ? drawnGeometry(object.geometry) : object.geometry.clone();
      if (!geometry.getAttribute("position")?.count) { geometry.dispose(); return; }
      geometry.morphAttributes = {};
      geometry.morphTargetsRelative = false;
      for (const name of Object.keys(geometry.attributes))
        if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      geometry.applyMatrix4(options.local ? inverse.clone().multiply(object.matrixWorld) : object.matrixWorld);
      pieces.push(geometry.index ? geometry.toNonIndexed() : geometry);
      if (geometry.index) geometry.dispose();
    });
    const geometry = pieces.length ? mergeGeometries(pieces) : null;
    for (const piece of pieces) piece.dispose();
    if (!geometry) return;
    // Smooth coincident hull vertices so tiled roofs do not grow dotted seams.
    geometry.deleteAttribute("normal");
    const welded = mergeVertices(geometry, .0001);
    geometry.dispose();
    welded.computeVertexNormals();
    hull = new Mesh(welded, hullMaterial);
    hull.name = options.name ?? "building_hover_outline";
    // Render the hull first; normal building depths hide all interior hull faces.
    hull.renderOrder = -1;
    (options.local ? root : scene).add(hull);
  };
  return { set, clear, getStats: () => ({ meshes: originals.size,
    triangles: hull ? (hull.geometry.index?.count ?? hull.geometry.getAttribute("position").count) / 3 : 0 }),
    dispose: () => { clear(); hullMaterial.dispose(); } };
};
