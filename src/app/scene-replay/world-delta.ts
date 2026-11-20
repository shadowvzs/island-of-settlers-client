import { isForbiddenKey, isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";

/** Sparse data-only world edits, including terrain, fog and renderer-owned prop growth/felling. */
export interface SceneWorldEdit { entries?: [number, number][]; path: string[]; remove?: true; value?: unknown }
type WorldRecord = Record<string, unknown>;
type NumberArray = Float64Array | Float32Array | Int32Array | Uint8Array;
/** One piece of the world compared in a tick: a typed array element range or one plain value. */
interface DiffUnit { end: number; path: string[]; start: number; typed: boolean }

/** Typed array slice size: the cost unit of the time-sliced comparison (a multiple of 8). */
const CHUNK_BYTES = 1 << 20;
/** Nominal cost of comparing one plain (JSON) value. */
const VALUE_COST = 4096;

const sameTypedArrayShape = (left: unknown, right: unknown) =>
  ArrayBuffer.isView(left) && ArrayBuffer.isView(right) &&
  left.constructor === right.constructor && left.byteLength === right.byteLength;

const readPath = (root: WorldRecord, path: readonly string[]) => {
  let item: unknown = root;
  for (const key of path) item = isPlainObject(item) ? item[key] : undefined;
  return item;
};

const typedUnits = (path: string[], array: NumberArray) => {
  const step = CHUNK_BYTES / array.BYTES_PER_ELEMENT;
  const units: DiffUnit[] = [];
  for (let start = 0; start < array.length; start += step)
    units.push({ end: Math.min(array.length, start + step), path, start, typed: true });
  return units;
};

/** Every comparable piece of the world, from the previous copy's and the current world's keys. */
const listUnits = (previous: WorldRecord, current: WorldRecord) => {
  const units: DiffUnit[] = [];
  const visit = (before: WorldRecord, after: WorldRecord, prefix: string[]) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const path = [...prefix, key];
      if (sameTypedArrayShape(before[key], after[key])) units.push(...typedUnits(path, after[key] as NumberArray));
      else if (isPlainObject(before[key]) && isPlainObject(after[key])) visit(before[key], after[key], path);
      else units.push({ end: 0, path, start: 0, typed: false });
    }
  };
  visit(previous, current, []);
  return units;
};

const wordView = (array: NumberArray) =>
  array.byteOffset % 4 ? undefined : new Int32Array(array.buffer, array.byteOffset, array.byteLength >> 2);

/** Changed entries of an element range, compared four bytes at a time; `before` takes them over. */
const diffRange = (before: NumberArray, after: NumberArray, start: number, end: number) => {
  const entries: [number, number][] = [];
  const size = after.BYTES_PER_ELEMENT;
  const take = (index: number) => {
    if (entries.at(-1)?.[0] === index) return;
    entries.push([index, after[index]!]);
    before[index] = after[index]!;
  };
  const takeWord = (word: number) => {
    for (let index = Math.floor(word * 4 / size); index * size < word * 4 + 4; index++) take(index);
  };
  const left = wordView(before);
  const right = wordView(after);
  let tail = start;
  if (left && right) {
    const lastWord = (end * size) >> 2;
    for (let word = (start * size) >> 2; word < lastWord; word++) if (left[word] !== right[word]) takeWord(word);
    tail = Math.max(start, Math.ceil(lastWord * 4 / size));
  }
  for (let index = tail; index < end; index++) if (!Object.is(before[index], after[index])) take(index);
  return entries;
};

const diffValue = (previous: WorldRecord, current: WorldRecord, path: string[]): SceneWorldEdit | undefined => {
  const parent = readPath(previous, path.slice(0, -1));
  if (!isPlainObject(parent)) return;
  const key = path.at(-1)!;
  const right = readPath(current, path);
  if (JSON.stringify(parent[key]) === JSON.stringify(right)) return;
  if (right === undefined) {
    delete parent[key];
    return { path, remove: true };
  }
  parent[key] = structuredClone(right);
  return { path, value: structuredClone(right) };
};

const diffUnit = (previous: WorldRecord, current: WorldRecord, unit: DiffUnit): SceneWorldEdit | undefined => {
  const before = readPath(previous, unit.path);
  const after = readPath(current, unit.path);
  if (!unit.typed || !sameTypedArrayShape(before, after)) return diffValue(previous, current, unit.path);
  const entries = diffRange(before as NumberArray, after as NumberArray, unit.start, unit.end);
  if (entries.length) return { entries, path: unit.path };
  return undefined;
};

/**
 * Time-sliced world comparison: each call compares about `budgetBytes` of the world against a
 * private copy, so a 512² island (18 MiB) costs a few milliseconds per sample instead of 17 ms;
 * every change is still caught within one pass over the world.
 */
export const createSceneWorldTracker = (world: object, budgetBytes = Infinity) => {
  const current = world as WorldRecord;
  const previous = structuredClone(current);
  let units: DiffUnit[] = [];
  let cursor = 0;
  return {
    /** The private copy: the world as of the last comparison (the recording's baseline at first). */
    baseline: () => previous,
    collect: (): SceneWorldEdit[] => {
      if (cursor >= units.length) {
        units = listUnits(previous, current);
        cursor = 0;
      }
      const edits: SceneWorldEdit[] = [];
      let spent = 0;
      while (cursor < units.length && spent < budgetBytes) {
        const unit = units[cursor++]!;
        spent += unit.typed ? CHUNK_BYTES : VALUE_COST;
        const edit = diffUnit(previous, current, unit);
        if (edit) edits.push(edit);
      }
      return edits;
    }
  };
};

const editParent = (target: object, path: readonly string[]) => {
  let parent = target as WorldRecord;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(parent[key])) throw new Error("Invalid scene world parent");
    parent = parent[key];
  }
  return parent;
};

/** JSON turns a NaN entry into null: it comes back as NaN. */
const applyArrayEntries = (array: unknown, entries: readonly [number, number | null][]) => {
  if (!ArrayBuffer.isView(array)) throw new Error("Invalid scene array target");
  const values = array as unknown as number[];
  for (const [index, value] of entries) {
    const valid = Number.isSafeInteger(index) && index >= 0 && index < values.length &&
      (value === null || typeof value === "number");
    if (!valid) throw new Error("Invalid scene array edit");
    values[index] = value ?? NaN;
  }
};

export const applySceneWorldEdits = (target: object, edits: readonly SceneWorldEdit[]) => {
  for (const edit of edits) {
    if (!edit.path.length || edit.path.some(isForbiddenKey)) throw new Error("Invalid scene world path");
    const parent = editParent(target, edit.path);
    const key = edit.path.at(-1)!;
    if (edit.remove) delete parent[key];
    else if (edit.entries) applyArrayEntries(parent[key], edit.entries);
    else parent[key] = structuredClone(edit.value);
  }
};
