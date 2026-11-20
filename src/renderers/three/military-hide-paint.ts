/** Warm stretched rawhide: fine pores, mottled tanning and shallow radial stretch marks. */
export const paintIndigenousHide = (context: CanvasRenderingContext2D,
  [left, top, width, height]: readonly [number, number, number, number]) => {
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width - .5, v = (y + .5) / height - .5;
    const radius = Math.hypot(u, v), angle = Math.atan2(v, u);
    const grain = Math.sin(x * 41.31 + y * 17.17) * Math.cos(x * 11.73 - y * 37.91);
    const mottling = Math.sin(x * .17 + Math.sin(y * .14)) * Math.cos(y * .13 - x * .04);
    const stretched = Math.pow(Math.max(0, Math.cos(angle * 23 + radius * 17)), 16) * radius;
    const pore = grain > .77 ? -.055 : 0;
    const brightness = .98 + mottling * .055 + grain * .025 - stretched * .035 + pore;
    const offset = (y * width + x) * 4;
    image.data[offset] = Math.round(139 * brightness);
    image.data[offset + 1] = Math.round(91 * brightness);
    image.data[offset + 2] = Math.round(52 * brightness);
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, left, top);
};
