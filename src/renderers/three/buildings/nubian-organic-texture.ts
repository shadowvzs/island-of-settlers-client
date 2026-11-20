import { NUBIAN_DECOR_ATLAS } from "./nubian-decor-atlas";
import {
  type AtlasPainter,
  band,
  drawInRegion,
  fractalNoise,
  mixTexel,
  regionRect,
  scaleTexel,
  shadeRegion,
  valueNoise} from "./nubian-paint-common";

type Context = CanvasRenderingContext2D;

/**
 * Front-on weathered skull, mapped across the face (u) from muzzle (v 0) to poll (v 1): ivory bone,
 * deep orbits near the edges at two thirds height, nasal openings, a long nasal ridge and sutures.
 */
const paintBone = (context: Context) => {
  band(context, 0, 1, "#e4d9bf");
  const gradient = context.createLinearGradient(0, 0, 1, 0);
  gradient.addColorStop(0, "rgba(120,96,64,.55)");
  gradient.addColorStop(0.25, "rgba(120,96,64,0)");
  gradient.addColorStop(0.75, "rgba(120,96,64,0)");
  gradient.addColorStop(1, "rgba(120,96,64,.55)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, 1);
  for (const side of [-1, 1]) {
    const x = 0.5 + side * 0.36;
    context.beginPath();
    context.ellipse(x, 0.65, 0.1, 0.075, side * 0.4, 0, Math.PI * 2);
    context.fillStyle = "#3a2a1e";
    context.fill();
    context.beginPath();
    context.ellipse(x + side * 0.02, 0.655, 0.065, 0.05, side * 0.4, 0, Math.PI * 2);
    context.fillStyle = "#140e0a";
    context.fill();
    context.beginPath();
    context.ellipse(0.5 + side * 0.045, 0.1, 0.03, 0.07, side * -0.15, 0, Math.PI * 2);
    context.fillStyle = "#24180f";
    context.fill();
    context.beginPath();
    context.moveTo(0.5 + side * 0.09, 0.18);
    context.lineTo(0.5 + side * 0.13, 0.55);
    context.lineWidth = 0.025;
    context.strokeStyle = "rgba(110,86,58,.45)";
    context.stroke();
  }
  context.fillStyle = "rgba(255,250,235,.55)";
  context.fillRect(0.47, 0.2, 0.06, 0.42);
  context.beginPath();
  for (let step = 0; step <= 24; step++)
    context.lineTo(0.2 + (step / 24) * 0.6, 0.82 + Math.sin(step * 2.3) * 0.012);
  context.lineWidth = 0.008;
  context.strokeStyle = "#7a6248";
  context.stroke();
};

/** Horn keratin from base (v 0) to tip: growth rings near the base, darkening towards the tip. */
const paintHorn = (context: Context, base: string, tip: string, rings: number) => {
  const gradient = context.createLinearGradient(0, 0, 0, 1);
  gradient.addColorStop(0, base);
  gradient.addColorStop(0.55, base);
  gradient.addColorStop(1, tip);
  context.fillStyle = gradient;
  context.fillRect(-0.01, 0, 1.02, 1);
  for (let ring = 0; ring < rings; ring++) {
    const y = 0.04 + ring * (0.6 / rings);
    band(context, y, y + 0.012, "rgba(40,28,20,.5)");
    band(context, y + 0.012, y + 0.02, "rgba(255,240,215,.2)");
  }
};

/**
 * Coiled palm-leaf hat seen from above (crown tip in the centre, brim edge at the cell edge), dyed
 * in Nubian basketry colours: triangles round the crown, a band of lozenges on the brim, a
 * leather-bound edge.
 */
const HAT_DYES = [
  ["#a3271f", "#5e2a6b", "#2f7d46"],
  ["#d8632a", "#2f7d46", "#24306e"]
] as const;
const CROWN = 0.32;

const paintHat = (context: Context, variant: number) => {
  const [first, second, third] = HAT_DYES[variant]!;
  band(context, 0, 1, "#d6b066");
  const ring = (radius: number, width: number, fill: string) => {
    context.beginPath();
    context.arc(0.5, 0.5, radius, 0, Math.PI * 2);
    context.lineWidth = width;
    context.strokeStyle = fill;
    context.stroke();
  };
  for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2,
      next = ((index + 1) / 12) * Math.PI * 2;
    context.beginPath();
    context.moveTo(0.5 + Math.cos(angle) * 0.26, 0.5 + Math.sin(angle) * 0.26);
    context.lineTo(0.5 + Math.cos(next) * 0.26, 0.5 + Math.sin(next) * 0.26);
    context.lineTo(
      0.5 + Math.cos((angle + next) / 2) * 0.14,
      0.5 + Math.sin((angle + next) / 2) * 0.14
    );
    context.fillStyle = index % 2 ? first : second;
    context.fill();
  }
  ring(0.27, 0.02, third);
  ring(CROWN - 0.01, 0.012, first);
  ring(0.06, 0.05, second);
  for (let index = 0; index < 18; index++) {
    const angle = (index / 18) * Math.PI * 2,
      radius = 0.41;
    context.save();
    context.translate(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(-0.035, 0);
    context.lineTo(0, 0.03);
    context.lineTo(0.035, 0);
    context.lineTo(0, -0.03);
    context.closePath();
    context.fillStyle = [third, first, second][index % 3]!;
    context.fill();
    context.restore();
  }
  ring(0.37, 0.008, first);
  ring(0.45, 0.008, first);
  ring(0.485, 0.03, "#5a3220");
};

/** Coil rows with stitches across them for the hats, pores and stains for bone, fibre for horn. */
const shadeHat = (painter: AtlasPainter, variant: number) => {
  const rect = regionRect(painter, NUBIAN_DECOR_ATLAS.hat[variant]!);
  shadeRegion(painter, rect, (u, v, data, offset) => {
    const radius = Math.hypot(u - 0.5, v - 0.5),
      angle = Math.atan2(v - 0.5, u - 0.5);
    const coil = Math.sin(radius * 180) * 0.5 + 0.5,
      stitch = Math.sin(angle * 90 + Math.floor(radius * 57) * 1.7) > 0.85;
    scaleTexel(
      data,
      offset,
      (0.78 + coil * 0.24) *
        (stitch ? 0.85 : 1) *
        (0.94 + valueNoise(u * 80, v * 80, variant) * 0.1)
    );
    return coil * 0.8 + (stitch ? -0.2 : 0);
  });
};

const shadeBone = (painter: AtlasPainter) => {
  const rect = regionRect(painter, NUBIAN_DECOR_ATLAS.bone);
  shadeRegion(painter, rect, (u, v, data, offset) => {
    const pores = valueNoise(u * 140, v * 140, 81) > 0.82,
      stain = fractalNoise(u * 5, v * 3, 82);
    scaleTexel(data, offset, (pores ? 0.86 : 1) * (0.92 + fractalNoise(u * 40, v * 40, 83) * 0.12));
    if (stain > 0.6) mixTexel(data, offset, [150, 118, 78], (stain - 0.6) * 1.2);
    return 0.5 + (pores ? -0.15 : 0) + fractalNoise(u * 20, v * 20, 84) * 0.2;
  });
};

const shadeHorn = (painter: AtlasPainter, variant: number) => {
  const rect = regionRect(painter, NUBIAN_DECOR_ATLAS.horn[variant]!);
  shadeRegion(painter, rect, (u, v, data, offset) => {
    const fibre = valueNoise(u * 40, v * 3, variant + 90);
    scaleTexel(data, offset, 0.86 + fibre * 0.2);
    return 0.4 + fibre * 0.3;
  });
};

/** Paints the skull, horn and hat cells of the decor atlas. */
export const paintNubianOrganicDecor = (painter: AtlasPainter) => {
  drawInRegion(painter, regionRect(painter, NUBIAN_DECOR_ATLAS.bone), paintBone);
  shadeBone(painter);
  drawInRegion(painter, regionRect(painter, NUBIAN_DECOR_ATLAS.horn[0]), (context) =>
    paintHorn(context, "#cfc2a4", "#3a3027", 5)
  );
  drawInRegion(painter, regionRect(painter, NUBIAN_DECOR_ATLAS.horn[1]), (context) =>
    paintHorn(context, "#4a4038", "#1d1916", 14)
  );
  NUBIAN_DECOR_ATLAS.horn.forEach((_region, variant) => shadeHorn(painter, variant));
  NUBIAN_DECOR_ATLAS.hat.forEach((region, variant) => {
    drawInRegion(painter, regionRect(painter, region), (context) => paintHat(context, variant));
    shadeHat(painter, variant);
  });
};
