import type { PreferenceCodec } from "./registry";

/**
 * Stored encodings of the existing preferences. They differ by key (history), and are kept exactly so a stored
 * choice stays readable: changing an encoding would silently reset players' settings.
 */

/** The raw stored text (`null` when absent): for feature stores that parse it themselves. */
export const rawTextCodec: PreferenceCodec<string | null, string> = {
  decode: raw => raw,
  encode: value => value
};

/** `"1"`/`"0"` flag. Off by default: only `"1"` is on. On by default: only `"0"` is off. */
export const flagCodec = (defaultOn: boolean): PreferenceCodec<boolean> => ({
  decode: raw => defaultOn ? raw !== "0" : raw === "1",
  encode: value => value ? "1" : "0"
});

/** A stored text value from a known set; anything else (or nothing) reads as `fallback`. */
export const choiceCodec = <Choice extends string, const Fallback>(
  isChoice: (value: string | null) => value is Choice, fallback: Fallback
): PreferenceCodec<Choice | Fallback, Choice> => ({
  decode: raw => isChoice(raw) ? raw : fallback,
  encode: value => value
});

/** A feature's own parse/format pair. */
export const parsedCodec = <Value, Input = Value>(
  parse: (raw: string | null) => Value, format: (value: Input) => string
): PreferenceCodec<Value, Input> => ({ decode: parse, encode: format });
