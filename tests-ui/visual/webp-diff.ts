/** Per-channel difference that counts a pixel as changed, and the share of changed pixels allowed. */
export const CHANNEL_TOLERANCE = 8;
export const MAX_CHANGED_RATIO = 0.005;

/**
 * In-page (`page.evaluate`): the share of pixels whose channels differ by more than `tolerance`
 * between a fresh render (base64) and a committed asset URL; 1 when the sizes differ. Used for WebP
 * icons, which `toMatchSnapshot` cannot decode.
 */
export const changedPixelShare = async (
  { fresh, stored, tolerance }: { fresh: string; stored: string; tolerance: number }
) => {
  const pixels = async (url: string) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const [rendered, committed] = await Promise.all([pixels(fresh), pixels(stored)]);
  if (rendered.length !== committed.length) return 1;
  let count = 0;
  for (let index = 0; index < rendered.length; index += 4) {
    for (let channel = 0; channel < 4; channel++) {
      if (Math.abs(rendered[index + channel]! - committed[index + channel]!) <= tolerance) continue;
      count++;
      break;
    }
  }
  return count / (rendered.length / 4);
};
