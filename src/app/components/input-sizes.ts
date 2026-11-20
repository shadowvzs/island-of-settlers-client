import "./input-sizes.css";

/** Shared input width classes by expected value length (see input-sizes.css). */
export const INPUT_SIZE_CLASSES = {
  count: "input-count",
  long: "input-long",
  narrow: "input-narrow",
  short: "input-short"
} as const;

export type InputSize = keyof typeof INPUT_SIZE_CLASSES;
