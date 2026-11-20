import type { PropSet } from "../world-data";

/** One prop as plain values (a new entry of the prop set). */
export interface PropEntry {
  form: number;
  phase: number;
  rotation: number;
  scale: number;
  type: number;
  x: number;
  y: number;
  z: number;
}

type PropArray = Float32Array | Uint8Array;

const resize = <T extends PropArray>(array: T, length: number) => {
  const resized = new (array.constructor as new (length: number) => T)(length);
  resized.set(array.subarray(0, Math.min(length, array.length)));
  return resized;
};

/** Resizes every array of the set to `length` entries (the existing ones kept). */
const resizeAll = (props: PropSet, length: number) => {
  props.form = resize(props.form, length);
  props.phase = resize(props.phase, length);
  props.rotation = resize(props.rotation, length);
  props.scale = resize(props.scale, length);
  props.types = resize(props.types, length);
  props.x = resize(props.x, length);
  props.y = resize(props.y, length);
  props.z = resize(props.z, length);
};

/**
 * Appends a prop (map editor): the arrays are replaced by one entry longer copies, the set object
 * stays the same. Returns the new prop's index.
 */
export const appendProp = (props: PropSet, entry: PropEntry) => {
  const index = props.count;
  if (props.types.length <= index) resizeAll(props, index + 1);
  props.form[index] = entry.form;
  props.phase[index] = entry.phase;
  props.rotation[index] = entry.rotation;
  props.scale[index] = entry.scale;
  props.types[index] = entry.type;
  props.x[index] = entry.x;
  props.y[index] = entry.y;
  props.z[index] = entry.z;
  props.count = index + 1;
  return index;
};

/** The set with exactly `count` entries (map editor undo / redo of placed props). */
export const resizeProps = (props: PropSet, count: number) => {
  resizeAll(props, count);
  props.count = count;
};

/** Reserve one bounded editor batch once; unused capacity never changes live prop count. */
export const reservePropCapacity = (props: PropSet, capacity: number) => {
  if (!Number.isInteger(capacity) || capacity < props.count || capacity > props.count + 64)
    throw new Error("Prop reservation must fit one bounded 64-entry editor batch.");
  if (props.types.length < capacity) resizeAll(props, capacity);
};
