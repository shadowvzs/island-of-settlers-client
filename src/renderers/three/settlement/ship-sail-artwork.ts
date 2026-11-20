/**
 * Original illustrations painted onto sails: the gilt Roman eagle and the Japanese coiled dragon
 * (rendered offline by tools/assets/japanese-sail-dragon.ts), plus the sewn linen they are printed on.
 */
export type ShipSailArtwork = {
  cloth?: CanvasImageSource;
  dragon?: CanvasImageSource;
  eagle?: CanvasImageSource;
  bison?: CanvasImageSource;
  mayaSun?: CanvasImageSource;
  persianPhoenix?: CanvasImageSource;
};

const pending = new Map<string, Promise<HTMLImageElement | undefined>>();

/** One decoded image per URL, shared by every ship set. */
const loadImage = (url: URL) => {
  const cached = pending.get(url.href);
  if (cached) return cached;
  if (typeof Image === "undefined") return Promise.resolve(undefined);
  const loading = new Promise<HTMLImageElement | undefined>(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url.href;
  });
  pending.set(url.href, loading);
  return loading;
};

/** The sail artwork for a detail level: Minimal decodes the half-size dragon. */
export const loadShipSailArtwork = async (detailed: boolean): Promise<ShipSailArtwork> => {
  // Explicit static URLs let Vite copy and fingerprint these production assets.
  const dragonUrl = detailed
    ? new URL("../../../../assets/textures/ships/japanese-sail-dragon-high.webp", import.meta.url)
    : new URL("../../../../assets/textures/ships/japanese-sail-dragon-minimal.webp", import.meta.url);
  const [dragon, eagle, bison, mayaSun, persianPhoenix] = await Promise.all([
    loadImage(dragonUrl),
    loadImage(new URL("../../../../assets/textures/ships/roman-gold-eagle.png", import.meta.url)),
    loadImage(detailed
      ? new URL("../../../../assets/ships/sail-art/indigenous-bison-head-high.webp", import.meta.url)
      : new URL("../../../../assets/ships/sail-art/indigenous-bison-head-minimal.webp", import.meta.url)),
    loadImage(detailed
      ? new URL("../../../../assets/ships/sail-art/maya-sun-high.webp", import.meta.url)
      : new URL("../../../../assets/ships/sail-art/maya-sun-minimal.webp", import.meta.url)),
    loadImage(detailed
      ? new URL("../../../../assets/ships/sail-art/persian-phoenix-high.webp", import.meta.url)
      : new URL("../../../../assets/ships/sail-art/persian-phoenix-minimal.webp", import.meta.url))
  ]);
  return { dragon, eagle, bison, mayaSun, persianPhoenix };
};
