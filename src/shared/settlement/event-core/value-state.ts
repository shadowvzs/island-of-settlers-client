/**
 * Fields a caller may explicitly omit when it has proved they cannot change a future decision.
 * `animationTime` and `door` are not here: both can gate a contact/decision, so excluding them
 * needs its own contract. The default comparator excludes nothing.
 */
export const PRESENTATION_ONLY_FIELDS: ReadonlySet<string> = new Set(["yaw"]);
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

export interface CanonicalOptions {
  /** Extra fields to omit; defaults to the presentation-only set. */
  exclude?: ReadonlySet<string>;
}

/**
 * Stable value state for the E1 comparator: object keys are sorted, arrays keep their order and
 * presentation-only fields are omitted. This is a test/reporting helper, not a hashing rule for the
 * live save; a field that can change a future simulation decision must stay in the state.
 */
export const canonicalValueState = (value: unknown, options: CanonicalOptions = {}): unknown => {
  const exclude = options.exclude ?? NO_EXCLUSIONS;
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([key]) => !exclude.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, child]) => [key, visit(child)]));
  };
  return visit(value);
};

export const valueStateKey = (value: unknown, options: CanonicalOptions = {}) =>
  JSON.stringify(canonicalValueState(value, options));

export const sameValueState = (left: unknown, right: unknown, options: CanonicalOptions = {}) =>
  valueStateKey(left, options) === valueStateKey(right, options);

export interface ValueStateDiff {
  left: unknown;
  path: string;
  right: unknown;
}

/** The first differing path, for the E1/E3 report; null when the canonical states are equal. */
export const diffValueState = (left: unknown, right: unknown, options: CanonicalOptions = {},
  path = "$"): ValueStateDiff | null => {
  const canonicalLeft = canonicalValueState(left, options), canonicalRight = canonicalValueState(right, options);
  const walk = (a: unknown, b: unknown, at: string): ValueStateDiff | null => {
    if (Object.is(a, b)) return null;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return { left: a.length, path: `${at}.length`, right: b.length };
      for (let index = 0; index < a.length; index++) {
        const diff = walk(a[index], b[index], `${at}[${index}]`);
        if (diff) return diff;
      }
      return null;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const leftKeys = Object.keys(a as Record<string, unknown>), rightKeys = Object.keys(b as Record<string, unknown>);
      for (const key of new Set([...leftKeys, ...rightKeys])) {
        const diff = walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`);
        if (diff) return diff;
      }
      return null;
    }
    return { left: a, path: at, right: b };
  };
  return walk(canonicalLeft, canonicalRight, path);
};
