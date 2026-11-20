import { NUBIAN_TEXTILE_COLUMNS,nubianTextileRegion } from "./nubian-decor-atlas";
import {
  type AtlasPainter,
  band,
  createAtlasPainter,
  drawInRegion,
  fractalNoise,
  mixTexel,
  polygon,
  regionRect,
  scaleTexel,
  shadeRegion} from "./nubian-paint-common";
import { blockVariation } from "./surface-detail-common";

/** Dyes of Nubian palm-fibre and cotton weaving: madder, indigo, saffron, leaf green, mulberry. */
const DYE = {
  black: "#211a17",
  cream: "#efe2c4",
  green: "#2f7d46",
  indigo: "#1f2d6e",
  madder: "#a8281e",
  mulberry: "#62275f",
  orange: "#dc6a26",
  saffron: "#e3a52b",
  sky: "#3f8fc0",
  white: "#f6efdc"
} as const;

/** Fringe below the woven field and the hem wrapped round the rod, as fractions of the height. */
const FRINGE = 0.075;
const HEM = 0.045;

type Context = CanvasRenderingContext2D;

const diamond = (
  context: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string
) =>
  polygon(
    context,
    [
      [x, y - height / 2],
      [x + width / 2, y],
      [x, y + height / 2],
      [x - width / 2, y]
    ],
    fill
  );

/** A row of small triangles (basketry "teeth") between `y` and `y + height`, pointing up or down. */
const teeth = (
  context: Context,
  y: number,
  height: number,
  count: number,
  fill: string,
  down = false
) => {
  for (let index = 0; index < count; index++) {
    const left = index / count,
      right = (index + 1) / count,
      tip = (left + right) / 2;
    polygon(
      context,
      down
        ? [
            [left, y + height],
            [right, y + height],
            [tip, y]
          ]
        : [
            [left, y],
            [right, y],
            [tip, y + height]
          ],
      fill
    );
  }
};

const zigzag = (
  context: Context,
  y: number,
  amplitude: number,
  count: number,
  width: number,
  stroke: string
) => {
  context.beginPath();
  for (let index = 0; index <= count * 2; index++)
    context[index ? "lineTo" : "moveTo"](
      index / (count * 2),
      y + (index % 2 ? amplitude : -amplitude)
    );
  context.lineWidth = width;
  context.strokeStyle = stroke;
  context.lineJoin = "miter";
  context.stroke();
};

/** Side selvedges: narrow stripes running the length of the cloth. */
const selvedges = (context: Context, colours: readonly string[]) =>
  colours.forEach((colour, index) => {
    context.fillStyle = colour;
    context.fillRect(index * 0.022, 0, 0.022, 1);
    context.fillRect(1 - (index + 1) * 0.022, 0, 0.022, 1);
  });

/** Banded ends: the classic striped heading at the top and foot of the woven field. */
const stripedEnds = (context: Context, colours: readonly string[], from: number) =>
  colours.forEach((colour, index) => {
    band(context, from + index * 0.02, from + (index + 1) * 0.02, colour);
    band(context, 1 - HEM - (index + 1) * 0.02, 1 - HEM - index * 0.02, colour);
  });

/** Madder red with a chain of outlined lozenges, saffron and green inside, striped ends. */
const lozengeChain = (context: Context) => {
  band(context, 0, 1, DYE.madder);
  stripedEnds(context, [DYE.black, DYE.saffron, DYE.white, DYE.green, DYE.black], FRINGE);
  teeth(context, FRINGE + 0.1, 0.035, 7, DYE.saffron);
  teeth(context, 1 - HEM - 0.135, 0.035, 7, DYE.saffron, true);
  for (const y of [0.33, 0.53, 0.73]) {
    diamond(context, 0.5, y, 0.78, 0.2, DYE.black);
    diamond(context, 0.5, y, 0.66, 0.16, DYE.saffron);
    diamond(context, 0.5, y, 0.46, 0.11, DYE.green);
    diamond(context, 0.5, y, 0.2, 0.05, DYE.white);
    for (const x of [0.08, 0.92]) diamond(context, x, y, 0.12, 0.06, DYE.saffron);
  }
  selvedges(context, [DYE.black, DYE.saffron]);
};

/** Indigo ground with rows of white, saffron and madder chevrons between fine red stripes. */
const indigoChevrons = (context: Context) => {
  band(context, 0, 1, DYE.indigo);
  const colours = [DYE.white, DYE.saffron, DYE.madder, DYE.sky];
  for (let row = 0; row < 8; row++) {
    const y = FRINGE + 0.07 + row * 0.1;
    band(context, y - 0.045, y - 0.037, DYE.madder);
    zigzag(context, y, 0.022, 4, 0.022, colours[row % colours.length]!);
  }
  band(context, FRINGE, FRINGE + 0.03, DYE.black);
  band(context, 1 - HEM - 0.03, 1 - HEM, DYE.black);
  selvedges(context, [DYE.white, DYE.madder]);
};

/** Saffron ground with a large nested diamond, black corner triangles and dotted red borders. */
const nestedDiamond = (context: Context) => {
  band(context, 0, 1, DYE.saffron);
  const centre = (FRINGE + 1 - HEM) / 2,
    colours = [DYE.madder, DYE.black, DYE.white, DYE.green, DYE.madder, DYE.white];
  colours.forEach((colour, index) =>
    diamond(context, 0.5, centre, 0.9 - index * 0.15, 0.6 - index * 0.1, colour)
  );
  for (const [x, y] of [
    [0, FRINGE],
    [1, FRINGE],
    [0, 1 - HEM],
    [1, 1 - HEM]
  ] as const)
    polygon(
      context,
      [
        [x, y],
        [x + (x ? -0.3 : 0.3), y],
        [x, y + (y > 0.5 ? -0.18 : 0.18)]
      ],
      DYE.black
    );
  for (const y of [FRINGE + 0.02, 1 - HEM - 0.045]) {
    band(context, y, y + 0.025, DYE.madder);
    for (let dot = 0; dot < 9; dot++) {
      context.beginPath();
      context.ellipse((dot + 0.5) / 9, y + 0.0125, 0.012, 0.008, 0, 0, Math.PI * 2);
      context.fillStyle = DYE.white;
      context.fill();
    }
  }
  selvedges(context, [DYE.madder]);
};

/** Mulberry, green and orange bands, each edged with basketry teeth or a checker row. */
const basketBands = (context: Context) => {
  const bands = [
    DYE.mulberry,
    DYE.cream,
    DYE.green,
    DYE.orange,
    DYE.mulberry,
    DYE.cream,
    DYE.green
  ];
  const height = (1 - HEM - FRINGE) / bands.length;
  bands.forEach((colour, index) => {
    const y = FRINGE + index * height;
    band(context, y, y + height, colour);
    const accent = colour === DYE.cream ? DYE.madder : DYE.cream;
    if (index % 2) teeth(context, y, height * 0.35, 6, accent);
    else
      for (let cell = 0; cell < 12; cell++)
        if (cell % 2 === 0) {
          context.fillStyle = accent;
          context.fillRect(cell / 12, y + height * 0.42, 1 / 12, height * 0.16);
        }
  });
  selvedges(context, [DYE.black]);
};

const DESIGNS = [lozengeChain, indigoChevrons, nestedDiamond, basketBands] as const;

/** Thread size in texels: warp and weft cross in a plain weave, each thread rounded across. */
const weave = (x: number, y: number, thread: number) => {
  const column = Math.floor(x / thread),
    row = Math.floor(y / thread);
  const over = (column + row) % 2 === 0,
    across = over ? (x / thread) % 1 : (y / thread) % 1;
  return { lift: Math.sin(across * Math.PI), over, row };
};

/** Plain-weave relief, per-pick dye variation, a dark hem round the rod and a knotted fringe. */
const shadeTextile = (painter: AtlasPainter, variant: number, thread: number) => {
  const rect = regionRect(painter, nubianTextileRegion(variant));
  const fringeRow = Math.floor(rect.height * (1 - FRINGE)),
    source = painter.context.getImageData(rect.x, rect.y + fringeRow - 2, rect.width, 1).data;
  shadeRegion(painter, rect, (u, v, data, offset) => {
    const x = u * rect.width,
      y = (1 - v) * rect.height,
      cell = weave(x, y, thread);
    if (v < FRINGE) return fringe(data, offset, source, Math.floor(x), v, thread);
    const pick = 0.94 + blockVariation(cell.row, variant) * 0.1,
      fade = 0.9 + fractalNoise(u * 6, v * 9, variant) * 0.12;
    scaleTexel(data, offset, (0.78 + cell.lift * 0.26) * pick * fade);
    if (v > 1 - HEM)
      scaleTexel(data, offset, 0.55 + 0.25 * Math.sin(((v - 1 + HEM) / HEM) * Math.PI));
    return cell.lift * (cell.over ? 1 : 0.7);
  });
};

/** Twisted strands hanging below the field, each a little shorter or longer; gaps are cut out. */
const fringe = (
  data: Uint8ClampedArray,
  offset: number,
  source: Uint8ClampedArray,
  x: number,
  v: number,
  thread: number
) => {
  const strand = Math.floor(x / (thread * 2)),
    within = (x / (thread * 2)) % 1;
  const length = FRINGE * (0.55 + blockVariation(strand, 7) * 0.45);
  const solid = within > 0.15 && within < 0.85 && v > FRINGE - length;
  data[offset + 3] = solid ? 255 : 0;
  if (!solid) return 0;
  for (let channel = 0; channel < 3; channel++) data[offset + channel] = source[x * 4 + channel]!;
  const twist = Math.sin((v * 260 + within * 3) * Math.PI);
  scaleTexel(data, offset, 0.72 + 0.2 * twist);
  mixTexel(data, offset, [40, 30, 24], 0.08);
  return 0.5 + twist * 0.3;
};

/** The textile atlas: four woven designs side by side, full height each. */
export const paintNubianTextileAtlas = (detailed: boolean) => {
  const width = detailed ? 1024 : 256,
    painter = createAtlasPainter(width, width * 0.75);
  DESIGNS.forEach((design, variant) => {
    drawInRegion(painter, regionRect(painter, nubianTextileRegion(variant)), design);
    shadeTextile(painter, variant, detailed ? 4 : 2);
  });
  if (DESIGNS.length !== NUBIAN_TEXTILE_COLUMNS) throw new Error("Textile atlas design count");
  return painter;
};
