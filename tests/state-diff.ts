/**
 * Fast exact comparison of large world states (test helper): typed arrays are compared as bytes
 * natively instead of element by element through the matcher (seconds on a whole world).
 */
type Leaves = Map<string, unknown>;

const collectLeaves = (value: unknown, path: string, leaves: Leaves) => {
  const isBranch = typeof value === "object" && value !== null && !ArrayBuffer.isView(value);
  if (!isBranch) {
    leaves.set(path, value);
    return;
  }
  if (value instanceof Map || value instanceof Set) {
    leaves.set(path, structuredClone([...value]));
    return;
  }
  for (const [key, child] of Object.entries(value)) collectLeaves(child, `${path}.${key}`, leaves);
  if (Array.isArray(value)) leaves.set(`${path}.length`, value.length);
};

const toBytes = (view: ArrayBufferView) =>
  Buffer.from(view.buffer, view.byteOffset, view.byteLength);

const isSameLeaf = (first: unknown, second: unknown) => {
  if (!ArrayBuffer.isView(first) || !ArrayBuffer.isView(second)) {
    return JSON.stringify(first) === JSON.stringify(second) || Object.is(first, second);
  }
  const isSameType = first.constructor === second.constructor;
  return isSameType && toBytes(first).equals(toBytes(second));
};

/** A deep copy of the state as path -> leaf (typed arrays copied). */
export const snapshotState = (state: object): Leaves => {
  const leaves: Leaves = new Map();
  collectLeaves(state, "", leaves);
  for (const [path, leaf] of leaves) {
    if (ArrayBuffer.isView(leaf)) leaves.set(path, structuredClone(leaf));
  }
  return leaves;
};

/** Paths whose leaves differ between two snapshots (empty when equal). */
export const diffSnapshots = (first: Leaves, second: Leaves) => {
  const paths = new Set([...first.keys(), ...second.keys()]);
  return [...paths].filter((path) => !isSameLeaf(first.get(path), second.get(path))).sort();
};
