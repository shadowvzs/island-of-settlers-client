/** A store contract readable with `useSyncExternalStore`; React-free so startup code can publish into it. */
export interface ExternalStore<T> {
  getSnapshot: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

/** The read side of a store, enough for React to subscribe to it. */
export type ReadableStore<T> = Pick<ExternalStore<T>, "getSnapshot" | "subscribe">;

/** A small typed store for UI snapshots; publish only when the value actually changes. */
export const createExternalStore = <T>(initial: T): ExternalStore<T> => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    set: next => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
};

/**
 * Structural equality of snapshot data (plain objects, arrays, primitives): a tick that rebuilds equal objects
 * compares equal, so an unchanged view does not re-render.
 */
export const isDeepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || !left || !right) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left), rightRecord = right as Record<string, unknown>;
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) &&
    isDeepEqual((left as Record<string, unknown>)[key], rightRecord[key]));
};

/** Same keys with the same values (by reference): arrays compare item by item, objects key by key. */
export const isShallowEqual = <T>(left: T, right: T) => {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || !left || !right) return false;
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) &&
    Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
};
