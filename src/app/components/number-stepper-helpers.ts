/** Pure helpers of `NumberStepper` (React-free, shared with its tests). */

/** A whole number inside `min..max`; anything not finite counts as `min`. */
export const clampWholeNumber = (value: number, min: number, max: number) => {
  const whole = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, whole));
};

/** The number a typed draft stands for, or null while it is not a number yet (empty, a lone sign). */
export const parseNumberDraft = (text: string) => {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};
