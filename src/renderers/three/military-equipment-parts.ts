import { Shape } from "three";

/**
 * Outlines and painted patterns shared by the nation army icons (army-shield-icon-models.ts) and
 * the soldiers' issued equipment in the world (military-equipment-*.ts), so both show one design.
 * Shapes are in icon units; callers scale them.
 */

/** Bearded Viking axe head: the bit sweeps down into a long beard; x = away from the haft. */
export const beardedAxeHeadShape = () => {
  const head = new Shape();
  head.moveTo(0, 0.02);
  head.lineTo(0.05, 0.03);
  head.quadraticCurveTo(0.1, 0.05, 0.15, 0.1);
  head.quadraticCurveTo(0.2, -0.03, 0.16, -0.2);
  head.quadraticCurveTo(0.1, -0.13, 0.08, -0.06);
  head.quadraticCurveTo(0.05, -0.04, 0, -0.05);
  head.closePath();
  return head;
};

/** Bronze khopesh: a straight blunt shank, then the hooked blade (cutting on its outer curve). */
export const khopeshBladeShape = () => {
  const blade = new Shape();
  blade.moveTo(-0.016, 0);
  blade.lineTo(0.016, 0);
  blade.lineTo(0.022, 0.22);
  blade.bezierCurveTo(0.2, 0.24, 0.27, 0.5, 0.1, 0.64);
  blade.lineTo(0.09, 0.6);
  blade.bezierCurveTo(0.17, 0.46, 0.1, 0.32, -0.016, 0.3);
  blade.closePath();
  return blade;
};

/** Three-comma tomoe mon in a disc; `field` paints the disc, `commas` the tomoe. */
export const drawTomoe = (
  context: CanvasRenderingContext2D,
  center: readonly [number, number],
  radius: number,
  colors: { commas: string; field: string }
) => {
  const [centerX, centerY] = center;
  context.fillStyle = colors.field;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = colors.commas;
  for (let comma = 0; comma < 3; comma++) {
    const angle = (comma / 3) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius * 0.42,
      y = centerY + Math.sin(angle) * radius * 0.42;
    context.beginPath();
    context.arc(x, y, radius * 0.3, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
    context.arc(centerX, centerY, radius * 0.82, angle - 0.2, angle + 1.4);
    context.closePath();
    context.fill();
  }
};

/** Patches of the cowhide: [x, y, size] as fractions of the painted area. */
const COWHIDE_PATCHES = [
  [0.12, 0.3, 0.1],
  [0.4, 0.65, 0.14],
  [0.7, 0.25, 0.12],
  [0.9, 0.7, 0.1],
  [0.25, 0.85, 0.08],
  [0.55, 0.1, 0.07]
] as const;

/** Cream hide with irregular dark patches inside the given rectangle. */
export const drawCowhide = (
  context: CanvasRenderingContext2D,
  area: readonly [number, number, number, number],
  aspect = 2,
  patchScale = 1
) => {
  const [left, top, width, height] = area;
  context.fillStyle = "#efe4cc";
  context.fillRect(left, top, width, height);
  for (const [x, y, size] of COWHIDE_PATCHES) {
    context.fillStyle = y > 0.5 ? "#3a2416" : "#1c1410";
    const outline = Array.from({ length: 12 }, (_, step) => {
      const angle = (step / 12) * Math.PI * 2,
        wobble = (1 + 0.35 * Math.sin(step * 2.7 + x * 9)) * patchScale;
      return [
        left + (x + Math.cos(angle) * size * wobble) * width,
        top + (y + Math.sin(angle) * size * wobble * aspect) * height
      ] as const;
    });
    // A smooth blob through the edge midpoints, not a spiky star.
    const middle = (index: number) => {
      const [ax, ay] = outline[index % 12]!, [bx, by] = outline[(index + 1) % 12]!;
      return [(ax + bx) / 2, (ay + by) / 2] as const;
    };
    context.beginPath();
    context.moveTo(...middle(11));
    for (let step = 0; step < 12; step++) context.quadraticCurveTo(...outline[step]!, ...middle(step));
    context.fill();
  }
};
