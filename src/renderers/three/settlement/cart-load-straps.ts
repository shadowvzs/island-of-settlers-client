import { Box3, BoxGeometry, type BufferGeometry, CylinderGeometry, type Matrix4, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Top of the cart bed (metres, cart frame) where the ropes are tied to the side rails. */
const BED_TOP = .427;
/** The rails: ropes never run wider than the bed. */
const MAX_HALF_WIDTH = .215;
/** Two lashings across the load, front and back of the bed's middle. */
const STRAP_Z = [-.195, .105] as const;
const ROPE_RADIUS = .011;
const UP = new Vector3(0, 1, 0);

/** Highest point and widest side of a load: the model bounds placed at every slot. */
export const loadEnvelope = (bounds: Box3, slots: readonly Matrix4[]) => {
  let top = BED_TOP, halfWidth = 0;
  const corner = new Vector3(), placed = new Box3();
  for (const slot of slots) {
    placed.makeEmpty();
    for (let index = 0; index < 8; index++) {
      corner.set(index & 1 ? bounds.max.x : bounds.min.x, index & 2 ? bounds.max.y : bounds.min.y,
        index & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(slot);
      placed.expandByPoint(corner);
    }
    top = Math.max(top, placed.max.y);
    halfWidth = Math.max(halfWidth, Math.abs(placed.min.x), Math.abs(placed.max.x));
  }
  return { halfWidth: Math.min(MAX_HALF_WIDTH, halfWidth + .012), top: top + ROPE_RADIUS };
};

/** One rope segment from `start` to `end`: a round rope on High, a square cord on Minimal. */
const ropeSegment = (start: Vector3, end: Vector3, detailed: boolean) => {
  const direction = end.clone().sub(start), length = direction.length();
  const geometry = detailed ? new CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, length, 7, 1, true)
    : new BoxGeometry(ROPE_RADIUS * 2, length, ROPE_RADIUS * 2);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, direction.normalize()));
  geometry.translate(...start.clone().add(end).multiplyScalar(.5).toArray());
  return geometry.index ? geometry.toNonIndexed() : geometry;
};

type LoadEnvelope = ReturnType<typeof loadEnvelope>;

/** One lashing's path across the bed at `z`: up the rail, over the shoulder of the heap, across its top. */
const lashingPath = (layers: LoadEnvelope, heap: LoadEnvelope, z: number) => {
  const side = Math.max(layers.halfWidth, heap.halfWidth), shoulder = Math.min(side, heap.halfWidth);
  return [new Vector3(-side, BED_TOP, z), new Vector3(-side, layers.top, z), new Vector3(-shoulder, heap.top, z),
    new Vector3(shoulder, heap.top, z), new Vector3(side, layers.top, z), new Vector3(side, BED_TOP, z)];
};

/**
 * The lashings of a full cart (handcart talent at its raised capacity): two ropes over the heaped
 * load, tied to both side rails, following the base layers (`layers`) and the heap on top (`heap`).
 * One merged geometry per ware load, built once when first needed.
 */
export const createCartStrapGeometry = (layers: LoadEnvelope, heap: LoadEnvelope, detailed: boolean) => {
  const pieces: BufferGeometry[] = [];
  for (const z of STRAP_Z) {
    const path = lashingPath(layers, heap, z);
    for (let index = 1; index < path.length; index++) {
      if (path[index]!.distanceTo(path[index - 1]!) < 1e-4) continue;
      pieces.push(ropeSegment(path[index - 1]!, path[index]!, detailed));
    }
  }
  const merged = mergeGeometries(pieces)!;
  pieces.forEach(piece => piece.dispose());
  return merged;
};
