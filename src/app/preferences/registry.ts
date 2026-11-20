import type { PreferenceEntry, PreferenceFamilyEntry, PreferenceScope } from "./keys";

/**
 * Typed, guarded browser-storage preferences (unification survey §10). Storage can throw on any call (private
 * windows, blocked site data, a full quota): every read here falls back to the codec's default and every write is
 * a best-effort that never throws, so the choice still applies for this visit. Dependency-free on purpose.
 */
export type PreferenceArea = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type ReadArea = Pick<Storage, "getItem">;
type RemoveArea = Pick<Storage, "removeItem">;
type WriteArea = Pick<Storage, "setItem">;

/** Stored text ↔ value. `decode(null)` is the default of a never stored (or unreadable) preference. */
export interface PreferenceCodec<Value, Input = Value> {
  decode: (raw: string | null) => Value;
  encode: (value: Input) => string;
}

export interface Preference<Value, Input = Value> {
  readonly key: string;
  readonly scope: PreferenceScope;
  /** Removes the stored value (the next read returns the default). */
  clear: (area?: RemoveArea) => void;
  read: (area?: ReadArea) => Value;
  /** True when the value was stored; false when the storage refused it. */
  write: (value: Input, area?: WriteArea) => boolean;
}

const browserArea = (scope: PreferenceScope): PreferenceArea | undefined => {
  try {
    return scope === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

const readRaw = (area: ReadArea | undefined, key: string) => {
  try {
    return area?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeRaw = (area: WriteArea | undefined, key: string, value: string) => {
  if (!area) return false;
  try {
    area.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const removeRaw = (area: RemoveArea | undefined, key: string) => {
  try {
    area?.removeItem(key);
  } catch {
    // Nothing to do: the stale value stays until storage works again.
  }
};

/** The browser's local or session storage behind the guard (resolved on each call). */
export const browserStorageArea = (scope: PreferenceScope): PreferenceArea => ({
  getItem: key => readRaw(browserArea(scope), key),
  removeItem: key => removeRaw(browserArea(scope), key),
  setItem: (key, value) => { writeRaw(browserArea(scope), key, value); }
});

const preferenceAt = <Value, Input>(
  key: string, scope: PreferenceScope, codec: PreferenceCodec<Value, Input>
): Preference<Value, Input> => ({
  clear: (area = browserArea(scope)) => removeRaw(area, key),
  key,
  read: (area = browserArea(scope)) => codec.decode(readRaw(area, key)),
  scope,
  write: (value, area = browserArea(scope)) => writeRaw(area, key, codec.encode(value))
});

/** One registered key (keys.ts) with its codec. An injected `area` replaces the browser storage (tests, tabs). */
export const definePreference = <Value, Input = Value>(
  entry: PreferenceEntry, codec: PreferenceCodec<Value, Input>
) => preferenceAt(entry.key, entry.scope, codec);

/** A registered key family: one preference per id, stored at `prefix + id`. */
export const definePreferenceFamily = <Value, Input = Value>(
  family: PreferenceFamilyEntry, codec: PreferenceCodec<Value, Input>
) => (id: string) => preferenceAt(`${family.prefix}${id}`, family.scope, codec);
