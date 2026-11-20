const hash = (x: number, y: number) =>
  (((Math.imul(x + 19, 374761393) ^ Math.imul(y + 41, 668265263)) >>> 0) % 1000) / 1000;
const smooth = (value: number) => value * value * (3 - 2 * value);
/** Periodic multi-octave mineral / plaster weathering, independent of pixel resolution. */
export const periodicNoise = (u: number, v: number, period: number) => {
  const x = u * period,
    y = v * period;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = smooth(x - ix),
    fy = smooth(y - iy);
  const a = hash(ix % period, iy % period),
    b = hash((ix + 1) % period, iy % period);
  const c = hash(ix % period, (iy + 1) % period),
    d = hash((ix + 1) % period, (iy + 1) % period);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
};
export const createRomanTextureGrain = (resolution: number) => {
  const weather = new Float32Array(resolution * resolution);
  const grain = new Float32Array(weather.length);
  const mineral = new Float32Array(weather.length);
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      const u = x / resolution,
        v = y / resolution,
        index = y * resolution + x;
      weather[index] =
        periodicNoise(u, v, 4) * 0.5 + periodicNoise(u, v, 16) * 0.3 + periodicNoise(u, v, 64) * 0.2;
      grain[index] = hash(x, y);
      mineral[index] = periodicNoise(u, v, 64) * 0.55 + periodicNoise(u, v, 256) * 0.45;
    }
  return { weather, grain, mineral };
};
