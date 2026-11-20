/**
 * 2 x 2 coverage weighted average: colours of transparent samples do not darken the edge.
 * Output keeps straight (not premultiplied) colour; the sprite shader premultiplies.
 */
export const downsample = (source: Uint8Array, width: number, height: number) => {
  const targetWidth = width / 2;
  const targetHeight = height / 2;
  const target = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const from = ((y * 2 + dy) * width + x * 2 + dx) * 4;
          const weight = source[from + 3]!;
          red += source[from]! * weight;
          green += source[from + 1]! * weight;
          blue += source[from + 2]! * weight;
          alpha += weight;
        }
      }
      const to = (y * targetWidth + x) * 4;
      if (alpha > 0) {
        target[to] = red / alpha;
        target[to + 1] = green / alpha;
        target[to + 2] = blue / alpha;
      }
      target[to + 3] = alpha / 4;
    }
  }
  return target;
};

/**
 * Copies colour into fully transparent texels next to opaque ones (alpha stays 0), so bilinear
 * filtering and mipmaps at sprite edges do not pull in black.
 */
export const dilateColor = (image: Uint8Array, width: number, height: number, passes: number) => {
  for (let pass = 0; pass < passes; pass += 1) {
    const source = Uint8Array.from(image);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (source[index + 3]! > 0 || source[index]! + source[index + 1]! + source[index + 2]! > 0)
          continue;
        let count = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = (ny * width + nx) * 4;
          if (source[neighbour]! + source[neighbour + 1]! + source[neighbour + 2]! === 0) continue;
          red += source[neighbour]!;
          green += source[neighbour + 1]!;
          blue += source[neighbour + 2]!;
          count += 1;
        }
        if (count === 0) continue;
        image[index] = red / count;
        image[index + 1] = green / count;
        image[index + 2] = blue / count;
      }
    }
  }
};
