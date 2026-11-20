/**
 * Paths into a trigger (or any script node): every slot of a sentence block knows its path, so one immutable
 * `setAtPath` serves every picker, and validation issue paths map back onto the slots they name.
 */
export type NodePath = readonly (string | number)[];

type Node = Record<string, unknown> | unknown[];

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null;

/** The value at `path` (undefined when a step is missing). */
export const getAtPath = (root: unknown, path: NodePath): unknown => {
  let value = root;
  for (const key of path) {
    if (!isNode(value)) return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
};

const copyNode = (node: unknown, key: string | number): Node => {
  if (Array.isArray(node)) return [...node];
  if (isNode(node)) return { ...node };
  return typeof key === "number" ? [] : {};
};

/**
 * A copy of `root` with `value` at `path`; only the nodes along the path are copied. `undefined` removes an
 * object field (optional slots return to "not set"), and `null` stays a value.
 */
export const setAtPath = <T>(root: T, path: NodePath, value: unknown): T => {
  if (path.length === 0) return value as T;
  const [key, ...rest] = path as [string | number, ...(string | number)[]];
  const copy = copyNode(root, key) as Record<string | number, unknown>;
  const next = setAtPath(copy[key], rest, value);
  if (next === undefined && !Array.isArray(copy)) delete copy[key];
  else copy[key] = next;
  return copy as T;
};

/** `triggers[3].events[0].slots.killer` → `["triggers", 3, "events", 0, "slots", "killer"]`. */
export const parseIssuePath = (path: string): NodePath => {
  const parts: (string | number)[] = [];
  for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (match[2] !== undefined) parts.push(Number(match[2]));
    else if (match[1] !== undefined) parts.push(match[1]);
  }
  return parts;
};

/** True when `prefix` is the start of `path` (or equal to it). */
export const isPathPrefix = (prefix: NodePath, path: NodePath) =>
  prefix.length <= path.length && prefix.every((key, index) => path[index] === key);

/** A stable string key of a path (React keys, maps). */
export const pathKey = (path: NodePath) => path.join(".");
