/**
 * Procedural building texture pixels (flames, smoke, water, sail cloth, cast bronze) are pure
 * functions of a few arguments: each set is painted once per session and every texture receives
 * its own copy, so ownership and disposal stay per model and the pixels are byte-identical.
 * DOM and GPU free (worker-safe).
 */
const pixelSets = new Map<string, readonly Uint8Array[]>();

/** Copies of the cached pixel arrays of `key`, painted by `paint` on the first request. */
export const cachedPixelSet = (key: string, paint: () => readonly Uint8Array[]) => {
  let cached = pixelSets.get(key);
  if (!cached) {
    cached = paint();
    pixelSets.set(key, cached);
  }
  return cached.map(pixels => pixels.slice());
};

/** One cached pixel array (see `cachedPixelSet`). */
export const cachedPixels = (key: string, paint: () => Uint8Array) => cachedPixelSet(key, () => [paint()])[0]!;
