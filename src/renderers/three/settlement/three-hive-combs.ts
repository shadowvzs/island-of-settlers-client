import {
  CanvasTexture, DoubleSide, ExtrudeGeometry, InstancedMesh, type Matrix4, MeshStandardMaterial, RepeatWrapping,
  Shape, SRGBColorSpace
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createRandom } from "../../../shared/world/rng";

const CAPACITY = 32;
/** Comb cells per world unit: one texture tile holds a few rows of cells. */
const CELL_TILE = 0.09;

/** Wax comb: hexagon cells of translucent amber honey, pale wax walls, some cells capped. */
const createCombTexture = () => {
  const size = 128, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!, random = createRandom(61);
  context.fillStyle = "#e8bf5c"; context.fillRect(0, 0, size, size);
  const radius = size / 8, rowHeight = radius * Math.sqrt(3);
  for (let row = -1; row < size / rowHeight + 1; row += 1) for (let column = -1; column < size / (radius * 1.5) + 1; column += 1) {
    const x = column * radius * 1.5, y = row * rowHeight + (column % 2 ? rowHeight / 2 : 0);
    context.beginPath();
    for (let corner = 0; corner < 6; corner += 1) {
      const angle = (corner / 6) * Math.PI * 2;
      context[corner ? "lineTo" : "moveTo"](x + Math.cos(angle) * radius * 0.84, y + Math.sin(angle) * radius * 0.84);
    }
    context.closePath();
    const capped = random() < 0.15;
    const fill = context.createRadialGradient(x - radius * 0.2, y - radius * 0.2, 1, x, y, radius);
    fill.addColorStop(0, capped ? "#f3d27e" : "#ffb21e");
    fill.addColorStop(1, capped ? "#d4a24a" : "#9a4a04");
    context.fillStyle = fill; context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / CELL_TILE, 1 / CELL_TILE);
  return texture;
};

/** One cut comb: a straight top where it hung from the skep, irregular rounded edges below. */
const createCombShape = (width: number, height: number, seed: number) => {
  const random = createRandom(seed), shape = new Shape(), half = width / 2;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  const points = 9;
  for (let point = 1; point < points; point += 1) {
    const angle = (point / points) * Math.PI;
    const wobble = 0.88 + random() * 0.18;
    shape.lineTo(Math.cos(angle) * half * wobble, -Math.sin(angle) * height * wobble);
  }
  shape.closePath();
  return shape;
};

/** Three combs leaning side by side, as one geometry standing on y 0 (cut edge up). */
const createCombGeometry = (indices = [0, 1, 2]) => {
  const parts = indices.map(comb => {
    const geometry = new ExtrudeGeometry(createCombShape(0.2, 0.24, 7 + comb),
      { bevelEnabled: true, bevelSegments: 1, bevelSize: 0.004, bevelThickness: 0.004, depth: 0.016 });
    geometry.translate(0, 0.24, -0.008);
    geometry.rotateY(Math.PI / 2 + (comb - 1) * 0.12);
    geometry.rotateZ((comb - 1) * 0.08);
    return geometry.translate((comb - 1) * 0.06, 0, (comb - 1) * 0.012);
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return merged;
};

/**
 * The honey combs the beekeeper has cut out of a lifted skep, standing on the bench: hexagon cell
 * texture with translucent-looking amber honey (a warm emissive lift), readable at gameplay zoom.
 */
export const createThreeHiveCombs = (detailed: boolean) => {
  const texture = createCombTexture();
  const material = new MeshStandardMaterial({ emissive: 0x6a3300, emissiveIntensity: 0.35, map: texture,
    roughness: 0.3, side: DoubleSide });
  const mesh = new InstancedMesh(createCombGeometry(), material, CAPACITY);
  mesh.name = "hive_combs"; mesh.count = 0; mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = detailed;
  const remaining = new InstancedMesh(createCombGeometry([0, 2]), material, CAPACITY);
  const heldGeometry = new ExtrudeGeometry(createCombShape(.2, .24, 8),
    { bevelEnabled: true, bevelSegments: 1, bevelSize: .004, bevelThickness: .004, depth: .016 });
  heldGeometry.translate(0, 0, -.008);
  const held = new InstancedMesh(heldGeometry, material, CAPACITY);
  remaining.name = "hive_combs_remaining"; held.name = "beekeeper_held_comb";
  for (const extra of [remaining, held]) {
    extra.count = 0; extra.frustumCulled = false;
    extra.castShadow = extra.receiveShadow = detailed;
  }
  let splitCount = 0;
  let count = 0;
  const begin = () => { count = 0; splitCount = 0; };
  const push = (matrix: Matrix4) => { if (count < CAPACITY) mesh.setMatrixAt(count++, matrix); };
  const pushHeld = (bench: Matrix4, hands: Matrix4) => {
    if (splitCount >= CAPACITY) return;
    remaining.setMatrixAt(splitCount, bench); held.setMatrixAt(splitCount++, hands);
  };
  const commit = () => {
    for (const [object, instances] of [[mesh, count], [remaining, splitCount], [held, splitCount]] as const) {
      object.count = instances; object.visible = instances > 0;
      if (instances) object.instanceMatrix.needsUpdate = true;
    }
  };
  const dispose = () => { mesh.geometry.dispose(); remaining.geometry.dispose(); held.geometry.dispose(); material.dispose(); texture.dispose(); };
  return { begin, commit, dispose, held, mesh, push, pushHeld, remaining };
};
