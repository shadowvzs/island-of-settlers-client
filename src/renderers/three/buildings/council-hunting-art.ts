type Point = readonly [number, number];
const SIZE = 768;

/** Original earth-pigment silhouettes; these coordinates do not embed the supplied reference image. */
const artwork = (): Point[][] => {
  const contours: Point[][] = [];
  const stroke = (points: Point[], width: number) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[1] - a[1]) / length * width / 2, dy = -(b[0] - a[0]) / length * width / 2;
      contours.push([[a[0] + dx, a[1] + dy], [b[0] + dx, b[1] + dy],
        [b[0] - dx, b[1] - dy], [a[0] - dx, a[1] - dy]]);
    }
  };
  const ellipse = (x: number, y: number, rx: number, ry: number) => contours.push(
    Array.from({ length: 20 }, (_, i) => [x + Math.cos(i * Math.PI / 10) * rx,
      y + Math.sin(i * Math.PI / 10) * ry] as Point));
  // Running deer: deep chest, narrow belly, lifted neck, pointed muzzle and four jointed legs.
  contours.push([[386, 320], [410, 287], [454, 270], [515, 278], [561, 274], [587, 246],
    [604, 205], [616, 169], [638, 150], [665, 155], [687, 172], [708, 181], [713, 191],
    [698, 199], [670, 190], [654, 201], [646, 241], [653, 279], [638, 311], [615, 327],
    [595, 322], [559, 315], [526, 333], [480, 339], [433, 329], [413, 339], [392, 337]]);
  stroke([[421, 317], [382, 355], [341, 390], [312, 393]], 13);
  stroke([[441, 325], [419, 368], [370, 405], [344, 413]], 11);
  stroke([[607, 315], [642, 345], [680, 383], [717, 400]], 12);
  stroke([[626, 306], [668, 326], [699, 359], [736, 376]], 10);
  stroke([[405, 302], [384, 281], [372, 252]], 10);
  // Two antlers branch separately; ears sit below their roots.
  stroke([[636, 158], [616, 131], [603, 98], [606, 58]], 9);
  stroke([[618, 131], [585, 119], [574, 96]], 7);
  stroke([[608, 104], [585, 84], [581, 64]], 6);
  stroke([[657, 157], [674, 130], [685, 94], [683, 62]], 8);
  stroke([[674, 130], [705, 121], [720, 98]], 6);
  contours.push([[632, 166], [615, 146], [610, 169], [630, 185]],
    [[659, 168], [681, 151], [679, 174], [661, 187]]);
  const hunter = (x: number, y: number, scale: number, raised: boolean) => {
    const transform = (points: Point[]): Point[] => points.map(point =>
      [x + point[0] * scale, y + point[1] * scale]);
    ellipse(x, y - 72 * scale, 13 * scale, 17 * scale);
    contours.push(transform([[-12, -50], [12, -52], [22, 5], [8, 20], [-10, 7], [-16, -22]]));
    const limb = (points: Point[], width: number) => stroke(transform(points), width * scale);
    limb([[-2, 7], [-29, 57], [-6, 79], [-52, 103]], 10);
    limb([[12, 12], [48, 36], [32, 72], [58, 88]], 9);
    limb([[-10, -41], [-48, -62], [-44, -103]], 8);
    limb([[11, -41], [43, raised ? -77 : -46], [65, -111]], 7);
    limb([[-67, -115], [84, -96]], 3);
    contours.push(transform([[84, -96], [69, -103], [73, -91]]));
  };
  hunter(138, 295, 1.1, false);
  hunter(294, 193, .88, true);
  return contours;
};

let mask: Uint8Array | undefined;
const getMask = () => {
  if (mask) return mask;
  mask = new Uint8Array(SIZE * SIZE);
  // Rasterize once in workers or browser; surface sampling is then a constant-time mask lookup.
  for (const polygon of artwork()) for (let y = 0; y < SIZE; y++) {
    const scan = (y + .5) / SIZE * 480, intersections: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      if ((a[1] > scan) === (b[1] > scan)) continue;
      intersections.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = Math.max(0, Math.ceil(intersections[i]! / 768 * SIZE));
      const end = Math.min(SIZE, Math.floor(intersections[i + 1]! / 768 * SIZE));
      if (end > start) mask.fill(255, y * SIZE + start, y * SIZE + end);
    }
  }
  return mask;
};

/** Two scenes around the wall, with clear margins at the front doorway and rear seam. */
export const councilHuntingPigment = (u: number, height: number) => {
  if (Math.abs(height - .28) < .012 || Math.abs(height - .59) < .012) return 1;
  const across = ((u * 2) % 1 + 1) % 1;
  if (across < .08 || across > .92 || height < .31 || height > .56) return 0;
  const x = Math.min(SIZE - 1, Math.floor((across - .08) / .84 * SIZE));
  const y = Math.min(SIZE - 1, Math.floor((height - .31) / .25 * SIZE));
  return getMask()[y * SIZE + x]! / 255;
};
