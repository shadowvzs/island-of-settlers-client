import { smoothstep } from "../../../shared/world/noise";
import type { Random } from "../../../shared/world/rng";
import { MeshBuilder, type PropMesh, type Vec3 } from "../mesh-builder";
import {
  addKnob,
  addShellSurface,
  finishStill,
  mixColor,
  scaleColor,
  type ShellSurface,
  SHELL_FAMILY,
  toShellUv
} from "./shell-surface";

/**
 * Sea star lying on top of the beach sand: five puffy, tapering arms with a rounded top around a
 * raised disc, a closed flat underside and arm tips lifted a little off the sand (a small gap and
 * shadow under them). Pink tones; the cartoon white dots and granules on top come from the shell
 * shader, white spine bumps along the arm ridges are close-up detail (dropped by the plant LOD).
 */
const ARMS = 5;
const SECTOR = (Math.PI * 2) / ARMS;
const COLUMNS_PER_ARM = 12;
const ROWS = 6;
/** Arm half-width at the disc and at the tip, as shares of the arm length. */
const ARM_BASE = 0.25;
const ARM_TIP = 0.07;
/** Puffy body: top height at the centre and its fall towards the tips (shares of the size). */
const BODY_HEIGHT = 0.3;
const BODY_TAPER = 0.15;

/** Hot pink, coral pink, magenta pink. */
const STAR_TONES: Vec3[] = [
  [1, 0.42, 0.62],
  [1, 0.5, 0.5],
  [0.94, 0.38, 0.74]
];
const DOT_TONE: Vec3 = [1, 0.96, 0.96];

/** Arm of a column and its angle off the arm axis (columns crowd towards the axes). */
const getArmColumn = (u: number) => {
  const scaled = u * ARMS;
  const arm = Math.floor(scaled + 1e-9);
  const local = (scaled - arm) * 2 - 1;
  return { across: Math.sign(local) * Math.pow(Math.abs(local), 1.5) * (SECTOR / 2), arm };
};

const getAcross = (u: number) => getArmColumn(u).across;

/** Distance from the centre to the arm outline at an angle off the arm axis (unit arm length). */
const getReach = (across: number) => {
  const taper = ARM_BASE - ARM_TIP;
  const side = ARM_BASE / (Math.tan(Math.abs(across)) + taper) / Math.cos(across);
  // Smooth minimum of the straight sides and the arm length: rounded tips.
  return Math.pow(Math.pow(side, -4) + 1, -0.25);
};

interface StarForm {
  lifts: number[];
  size: number;
  tone: Vec3;
}

/** Point on the top (`top`) or the flat underside of the body. */
const getStarPoint = (form: StarForm, u: number, v: number, top: boolean): Vec3 => {
  const { across, arm } = getArmColumn(u);
  const angle = arm * SECTOR + across;
  const reach = getReach(across) * v;
  const lift = form.lifts[arm % ARMS]! * Math.pow(reach, 3);
  const thickness = top ? (BODY_HEIGHT - BODY_TAPER * reach) * Math.sqrt(Math.max(0, 1 - Math.pow(v, 4))) : 0;
  return [
    Math.cos(angle) * reach * form.size,
    (lift + thickness) * form.size,
    Math.sin(angle) * reach * form.size
  ];
};

const getStarSurface = (form: StarForm, top: boolean): ShellSurface => ({
  colorAt: (u, v) => {
    if (!top) return scaleColor(form.tone, 0.7);
    const outward = smoothstep(0.2, 1, getReach(getAcross(u)) * v);
    return mixColor(scaleColor(form.tone, 0.9), scaleColor(form.tone, 1.08), outward);
  },
  columns: COLUMNS_PER_ARM * ARMS,
  insideAt: (u, v) => {
    const point = getStarPoint(form, u, v, top);
    return [point[0] * 0.5, point[1] + (top ? -1 : 1) * form.size, point[2] * 0.5];
  },
  pointAt: (u, v) => getStarPoint(form, u, v, top),
  rows: ROWS,
  uvAt: (u, v) => toShellUv(SHELL_FAMILY.seaStar, 0.5 + getAcross(u) / SECTOR, getReach(getAcross(u)) * v, 0)
});

/** White spine bumps along each arm ridge. */
const addSpines = (builder: MeshBuilder, surface: ShellSurface, form: StarForm) => {
  for (let arm = 0; arm < ARMS; arm += 1) {
    const u = (arm + 0.5) / ARMS;
    for (let step = 1; step <= 5; step += 1) {
      const v = 0.1 + step * 0.14;
      addKnob(builder, { color: DOT_TONE, height: form.size * (0.06 - step * 0.007), normal: [0, 1, 0],
        point: surface.pointAt(u, v), radius: form.size * (0.04 - step * 0.004), uv: surface.uvAt(u, v) });
    }
  }
};

/** Sea star 0.14-0.19 cells arm radius (twice the first set), resting on the sand. */
export const createSeaStar = (random: Random, variant: number): PropMesh => {
  const builder = new MeshBuilder();
  const form: StarForm = {
    lifts: Array.from({ length: ARMS }, () => 0.04 + random() * 0.1),
    size: 0.14 + random() * 0.05,
    tone: STAR_TONES[variant % STAR_TONES.length]!
  };
  const top = getStarSurface(form, true);
  addShellSurface(builder, top, form.size * 0.12);
  addShellSurface(builder, getStarSurface(form, false), form.size * 0.12);
  builder.detail = true;
  addSpines(builder, top, form);
  return finishStill(builder);
};
