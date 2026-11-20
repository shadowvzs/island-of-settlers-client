import { NUBIAN_DECOR_ATLAS } from "./nubian-decor-atlas";
import {
  type AtlasPainter,
  band,
  drawInRegion,
  fractalNoise,
  mixTexel,
  polygon,
  regionRect,
  scaleTexel,
  shadeRegion,
  valueNoise} from "./nubian-paint-common";

type Context = CanvasRenderingContext2D;

const PAINT = {
  black: "#1d1714",
  blue: "#2c5d9a",
  clay: "#9b4a2b",
  cream: "#e9d8b2",
  green: "#3b7b45",
  ochre: "#c98a2e",
  red: "#a3311f",
  slip: "#efe0bf",
  turquoise: "#2f9a95",
  white: "#f4ecd8",
  yellow: "#e2b13a"
} as const;

/**
 * Painted cells are stretched on the mesh: a jar's unrolled band is about 1.6 times wider than
 * tall per UV unit, a shield 1.5 times taller than wide. Dots are drawn as ellipses that come out round.
 */
const JAR_STRETCH = 1.6;
const SHIELD_STRETCH = 1 / 1.5;

const dot = (
  context: Context,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stretch: number
) => {
  context.beginPath();
  context.ellipse(x, y, radius, radius * stretch, 0, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
};

/** Repeats a motif round the jar: `count` copies across u (the unrolled circumference). */
const around = (context: Context, count: number, draw: (left: number, width: number) => void) => {
  for (let index = 0; index < count; index++) draw(index / count, 1 / count);
};

const leaf = (
  context: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  tilt: number,
  fill: string
) => {
  context.save();
  context.translate(x, y);
  context.rotate(tilt);
  context.beginPath();
  context.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.restore();
};

/**
 * Meroitic water jar: red clay foot, cream slip, a black-and-red vine scroll frieze, hanging
 * triangles on the shoulder, red neck and black lip.
 */
const meroiticJar = (context: Context) => {
  band(context, 0, 1, PAINT.slip);
  band(context, 0, 0.2, PAINT.clay);
  band(context, 0.27, 0.285, PAINT.black);
  band(context, 0.3, 0.31, PAINT.red);
  context.beginPath();
  for (let step = 0; step <= 96; step++)
    context.lineTo(step / 96, 0.42 + Math.sin((step / 96) * Math.PI * 12) * 0.045);
  context.lineWidth = 0.012;
  context.strokeStyle = PAINT.black;
  context.stroke();
  around(context, 6, (left, width) => {
    leaf(context, left + width * 0.25, 0.5, 0.022, 0.05, 0.5, PAINT.red);
    leaf(context, left + width * 0.75, 0.34, 0.022, 0.05, -0.5, PAINT.green);
    dot(context, left + width * 0.5, 0.42, 0.012, PAINT.black, JAR_STRETCH);
  });
  band(context, 0.56, 0.57, PAINT.black);
  around(context, 14, (left, width) =>
    polygon(
      context,
      [
        [left, 0.66],
        [left + width, 0.66],
        [left + width / 2, 0.58]
      ],
      PAINT.red
    )
  );
  band(context, 0.66, 0.675, PAINT.black);
  band(context, 0.7, 0.86, PAINT.clay);
  band(context, 0.86, 1, PAINT.black);
};

/** Kerma-style burnished red pot with a black top, white-filled zigzag and checker lozenges. */
const kermaPot = (context: Context) => {
  band(context, 0, 1, PAINT.red);
  band(context, 0.66, 1, PAINT.black);
  band(context, 0.6, 0.66, "#5b4a52");
  context.beginPath();
  for (let step = 0; step <= 20; step++) context.lineTo(step / 20, step % 2 ? 0.52 : 0.44);
  context.lineWidth = 0.02;
  context.strokeStyle = PAINT.white;
  context.stroke();
  around(context, 5, (left, width) => {
    const x = left + width / 2;
    polygon(
      context,
      [
        [x, 0.38],
        [x + 0.05, 0.3],
        [x, 0.22],
        [x - 0.05, 0.3]
      ],
      PAINT.white
    );
    polygon(
      context,
      [
        [x, 0.34],
        [x + 0.025, 0.3],
        [x, 0.26],
        [x - 0.025, 0.3]
      ],
      PAINT.ochre
    );
  });
  band(context, 0.2, 0.21, PAINT.white);
  band(context, 0.55, 0.56, PAINT.white);
};

/** Slender bottle painted in bright bands: blue wave, yellow dots, red and green rosettes. */
const bandedBottle = (context: Context) => {
  band(context, 0, 1, PAINT.white);
  band(context, 0, 0.16, PAINT.clay);
  band(context, 0.18, 0.22, PAINT.blue);
  band(context, 0.23, 0.245, PAINT.red);
  context.beginPath();
  for (let step = 0; step <= 96; step++)
    context.lineTo(step / 96, 0.3 + Math.sin((step / 96) * Math.PI * 16) * 0.025);
  context.lineWidth = 0.016;
  context.strokeStyle = PAINT.turquoise;
  context.stroke();
  around(context, 7, (left, width) => {
    const x = left + width / 2;
    dot(context, x, 0.44, 0.026, PAINT.red, JAR_STRETCH);
    for (const dx of [-0.034, 0.034]) dot(context, x + dx, 0.44, 0.008, PAINT.yellow, JAR_STRETCH);
    dot(context, x, 0.44, 0.01, PAINT.green, JAR_STRETCH);
    leaf(context, left, 0.44, 0.012, 0.03, 0, PAINT.green);
  });
  band(context, 0.54, 0.57, PAINT.yellow);
  band(context, 0.58, 0.6, PAINT.red);
  around(context, 16, (left, width) =>
    polygon(
      context,
      [
        [left, 0.62],
        [left + width, 0.62],
        [left + width / 2, 0.7]
      ],
      PAINT.blue
    )
  );
  band(context, 0.74, 0.78, PAINT.red);
  band(context, 0.8, 1, PAINT.blue);
};

/** Fired clay: speckles, a soft burnish, chips showing the body near the widest point. */
const shadePottery = (painter: AtlasPainter, variant: number) => {
  const rect = regionRect(painter, NUBIAN_DECOR_ATLAS.vase[variant]!);
  shadeRegion(painter, rect, (u, v, data, offset) => {
    const grain = fractalNoise(u * 60, v * 30, variant + 20),
      speck = valueNoise(u * 300, v * 150, variant) > 0.93;
    scaleTexel(data, offset, 0.9 + grain * 0.16 - (speck ? 0.18 : 0));
    const chip = fractalNoise(u * 18, v * 9, variant + 40) > 0.78 && v > 0.3 && v < 0.6;
    if (chip) mixTexel(data, offset, [176, 104, 70], 0.55);
    return 0.5 + grain * 0.25 - (chip ? 0.2 : 0);
  });
};

/** Hide shield painted in the cell: the oval fills the cell; the outer 7 % is the leather binding. */
const SHIELD_RIM = 0.465;

const shieldRim = (context: Context, fill: string, lacing: string) => {
  context.beginPath();
  context.ellipse(0.5, 0.5, 0.5, 0.5, 0, 0, Math.PI * 2);
  context.ellipse(0.5, 0.5, SHIELD_RIM, SHIELD_RIM, 0, 0, Math.PI * 2, true);
  context.fillStyle = fill;
  context.fill("evenodd");
  for (let stitch = 0; stitch < 40; stitch++) {
    const angle = (stitch / 40) * Math.PI * 2;
    context.beginPath();
    context.moveTo(0.5 + Math.cos(angle) * 0.47, 0.5 + Math.sin(angle) * 0.47);
    context.lineTo(0.5 + Math.cos(angle + 0.03) * 0.495, 0.5 + Math.sin(angle + 0.03) * 0.495);
    context.lineWidth = 0.008;
    context.strokeStyle = lacing;
    context.stroke();
  }
};

const boss = (context: Context, fill: string, ring: string) => {
  dot(context, 0.5, 0.5, 0.07, ring, SHIELD_STRETCH);
  dot(context, 0.5, 0.5, 0.05, fill, SHIELD_STRETCH);
};

/** Black-and-white cowhide with brown patches, a red binding and a raised spine. */
const cowhideShield = (context: Context) => {
  band(context, 0, 1, PAINT.white);
  const patches: ReadonlyArray<readonly [number, number, number, number, string]> = [
    [0.3, 0.7, 0.13, 0.17, PAINT.black],
    [0.66, 0.32, 0.16, 0.12, PAINT.black],
    [0.7, 0.74, 0.08, 0.1, "#6b3f22"],
    [0.28, 0.28, 0.09, 0.07, "#6b3f22"],
    [0.52, 0.52, 0.05, 0.08, PAINT.black]
  ];
  for (const [x, y, rx, ry, fill] of patches) {
    context.beginPath();
    for (let step = 0; step < 18; step++) {
      const angle = (step / 18) * Math.PI * 2,
        wobble = 0.75 + valueNoise(step * 0.9, x * 9, 3) * 0.5;
      context.lineTo(x + Math.cos(angle) * rx * wobble, y + Math.sin(angle) * ry * wobble);
    }
    context.fillStyle = fill;
    context.fill();
  }
  context.fillStyle = "#8a6a4a";
  context.fillRect(0.485, 0.06, 0.03, 0.88);
  shieldRim(context, PAINT.red, PAINT.cream);
};

/** Red-ochre hide: white border of black triangles, a dotted black spine and white lozenges. */
const ochreShield = (context: Context) => {
  band(context, 0, 1, "#b0482a");
  for (let index = 0; index < 22; index++) {
    const angle = (index / 22) * Math.PI * 2,
      next = ((index + 1) / 22) * Math.PI * 2;
    polygon(
      context,
      [
        [0.5 + Math.cos(angle) * 0.46, 0.5 + Math.sin(angle) * 0.46],
        [0.5 + Math.cos(next) * 0.46, 0.5 + Math.sin(next) * 0.46],
        [0.5 + Math.cos((angle + next) / 2) * 0.37, 0.5 + Math.sin((angle + next) / 2) * 0.37]
      ],
      index % 2 ? PAINT.black : PAINT.white
    );
  }
  context.fillStyle = PAINT.black;
  context.fillRect(0.46, 0.1, 0.08, 0.8);
  const spot = (x: number, y: number, radius: number, fill: string) =>
    dot(context, x, y, radius, fill, SHIELD_STRETCH);
  for (let index = 0; index < 9; index++) {
    spot(0.5, 0.14 + index * 0.09, 0.016, PAINT.white);
  }
  for (const [x, y] of [
    [0.3, 0.5],
    [0.7, 0.5]
  ] as const)
    polygon(
      context,
      [
        [x, y - 0.12],
        [x + 0.07, y],
        [x, y + 0.12],
        [x - 0.07, y]
      ],
      PAINT.white
    );
  for (const x of [0.3, 0.7])
    polygon(
      context,
      [
        [x, 0.42],
        [x + 0.035, 0.5],
        [x, 0.58],
        [x - 0.035, 0.5]
      ],
      PAINT.yellow
    );
  shieldRim(context, PAINT.black, "#c9a06a");
  boss(context, "#7a5a3a", PAINT.black);
};

/** Quartered ochre and black hide with a red-and-white zigzag cross and a brass boss. */
const quarteredShield = (context: Context) => {
  for (const [x, y, fill] of [
    [0, 0, PAINT.yellow],
    [0.5, 0, PAINT.black],
    [0, 0.5, PAINT.black],
    [0.5, 0.5, PAINT.yellow]
  ] as const) {
    context.fillStyle = fill;
    context.fillRect(x, y, 0.5, 0.5);
  }
  context.fillStyle = PAINT.red;
  context.fillRect(0.43, 0, 0.14, 1);
  context.fillRect(0, 0.43, 1, 0.14);
  for (const vertical of [true, false]) {
    context.beginPath();
    for (let step = 0; step <= 16; step++) {
      const along = step / 16,
        side = step % 2 ? 0.53 : 0.47;
      if (vertical) context.lineTo(side, along);
      else context.lineTo(along, side);
    }
    context.lineWidth = 0.02;
    context.strokeStyle = PAINT.white;
    context.stroke();
  }
  for (const [x, y] of [
    [0.24, 0.76],
    [0.76, 0.24]
  ] as const)
    dot(context, x, y, 0.06, PAINT.red, SHIELD_STRETCH);
  for (const [x, y] of [
    [0.24, 0.24],
    [0.76, 0.76]
  ] as const)
    dot(context, x, y, 0.06, PAINT.white, SHIELD_STRETCH);
  shieldRim(context, "#5a3a22", PAINT.yellow);
  boss(context, "#c9a24a", "#6a4a24");
};

/** Hide: hair grain, scuffed paint and a darker, handled edge. */
const shadeShield = (painter: AtlasPainter, variant: number) => {
  const rect = regionRect(painter, NUBIAN_DECOR_ATLAS.shield[variant]!);
  shadeRegion(painter, rect, (u, v, data, offset) => {
    const hair = valueNoise(u * 120, v * 22 + Math.sin(u * 9) * 2, variant + 60),
      radius = Math.hypot(u - 0.5, v - 0.5);
    const scuff = fractalNoise(u * 14, v * 14, variant + 70) > 0.74;
    scaleTexel(data, offset, (0.86 + hair * 0.16) * (1 - Math.max(0, radius - 0.32) * 0.9));
    if (scuff) mixTexel(data, offset, [150, 112, 78], 0.35);
    const binding = radius > SHIELD_RIM ? 0.25 : 0;
    return 0.45 + hair * 0.2 + binding + (Math.abs(u - 0.5) < 0.02 ? 0.15 : 0);
  });
};

const POTTERY = [meroiticJar, kermaPot, bandedBottle] as const;
const SHIELDS = [cowhideShield, ochreShield, quarteredShield] as const;

/** Paints the jar and shield cells of the decor atlas. */
export const paintNubianPotteryAndShields = (painter: AtlasPainter) => {
  POTTERY.forEach((paint, variant) => {
    drawInRegion(painter, regionRect(painter, NUBIAN_DECOR_ATLAS.vase[variant]!), paint);
    shadePottery(painter, variant);
  });
  SHIELDS.forEach((paint, variant) => {
    drawInRegion(painter, regionRect(painter, NUBIAN_DECOR_ATLAS.shield[variant]!), paint);
    shadeShield(painter, variant);
  });
};
