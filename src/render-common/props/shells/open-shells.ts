import type { Random } from "../../../shared/world/rng";
import { MeshBuilder, type PropMesh, type Vec3 } from "../mesh-builder";
import {
  CLAM,
  COCKLE,
  getScale,
  getValveInner,
  getValveOuter,
  getValvePoint,
  SCALLOP,
  SHELL_BASE,
  type ValveOptions,
  type ValveShape
} from "./bivalve-shells";
import {
  addShellSurface,
  compose,
  finishStill,
  placeSurface,
  rotateX,
  type ShellSurface,
  SHELL_FAMILY,
  sinkSurfaces,
  toShellUv
} from "./shell-surface";

/**
 * Open bivalves (scallop, cockle, clam): both valves share one straight hinge line behind the
 * umbo (with the ears on both valves of a scallop). The lower valve lies flat on the sand cup up,
 * the upper valve is the same valve closed over it and swung up about that hinge line by the
 * opening angle (30-120 degrees across the variants). Some hold a white pearl in the lower cup.
 */
const SHAPES: readonly ValveShape[] = [SCALLOP, COCKLE, CLAM];
const ANGLES = [30, 55, 80, 100, 120].map((degrees) => (degrees * Math.PI) / 180);
/** Pearls only where the upper valve clears them (opening angle index >= 1). */
const FIRST_PEARL_ANGLE = 1;
const OPEN_COLUMNS = 40;
const VALVE_THICKNESS = 0.05;
/** Pearl radius as a share of the disc radius (diameter about 27 % of the valve width). */
const PEARL_RADIUS = 0.26;
const PEARL_TONE: Vec3 = [0.95, 0.94, 0.91];
/** Shader pattern of the pearl inside the nacre family. */
const PEARL_PATTERN = 3;

interface OpenShell {
  angle: number;
  pearl: boolean;
  shape: ValveShape;
}

/** Variant table: per shape every opening angle without a pearl, then the pearl angles. */
const OPEN_SHELLS: OpenShell[] = SHAPES.flatMap((shape) => [
  ...ANGLES.map((angle) => ({ angle, pearl: false, shape })),
  ...ANGLES.slice(FIRST_PEARL_ANGLE).map((angle) => ({ angle, pearl: true, shape }))
]);
export const OPEN_SHELL_VARIANT_COUNT = OPEN_SHELLS.length;

/** Pick weights: about 30 % of open shells hold a pearl. */
const PEARL_SHARE = 0.3;
const PEARL_WEIGHT = (PEARL_SHARE * ANGLES.length) / ((1 - PEARL_SHARE) * (ANGLES.length - FIRST_PEARL_ANGLE));
export const OPEN_SHELL_WEIGHTS = OPEN_SHELLS.map(({ pearl }) => (pearl ? PEARL_WEIGHT : 1));

/** Whether an open-shell variant holds a pearl (collecting reports it). */
export const hasPearl = (variant: number) => OPEN_SHELLS[variant % OPEN_SHELLS.length]!.pearl;

/** Height of the lower (flipped) valve's hinge edge: the shared hinge line. */
const getHingeHeight = (options: ValveOptions) => {
  const scale = getScale(options);
  return (options.shape.dome * 0.8 - getValvePoint(options.shape, 0, 1)[1]) * scale;
};

/** The lower valve: lying flat on the sand, cup up (its inside shows). */
const getLowerValve = (options: ValveOptions) => [
  getValveOuter({ ...options, flipped: true }),
  getValveInner({ ...options, flipped: true }, VALVE_THICKNESS)
];

/**
 * The upper valve: the same valve closed over the lower one (hinge edges on one line), swung up
 * about the shared hinge line by the opening angle.
 */
const getUpperValve = (options: ValveOptions, angle: number) => {
  const scale = getScale(options);
  const hingeZ = -options.shape.hingeBack * scale;
  const hingeLocalY = getValvePoint(options.shape, 0, 1)[1] * scale;
  const hingeY = getHingeHeight(options);
  const place = compose(
    ([x, y, z]) => [x, y - hingeLocalY, z - hingeZ],
    rotateX(-angle),
    ([x, y, z]) => [x, y + hingeY, z + hingeZ]
  );
  return [getValveOuter({ ...options, flipped: false }), getValveInner({ ...options, flipped: false }, VALVE_THICKNESS)]
    .map((surface) => placeSurface(surface, place));
};

/** A white pearl resting in the lower valve's cup, a little in front of the hinge. */
const getPearl = (options: ValveOptions, lowerInner: ShellSurface): ShellSurface => {
  const radius = PEARL_RADIUS * getScale(options);
  const rest = lowerInner.pointAt(0.5, 0.38);
  const centre: Vec3 = [rest[0], rest[1] + radius * 0.92, rest[2]];
  return {
    colorAt: () => PEARL_TONE,
    columns: 14,
    insideAt: () => centre,
    pointAt: (u, v) => {
      const around = u * Math.PI * 2, from = v * Math.PI;
      return [
        centre[0] + Math.cos(around) * Math.sin(from) * radius,
        centre[1] + Math.cos(from) * radius,
        centre[2] + Math.sin(around) * Math.sin(from) * radius
      ];
    },
    rows: 9,
    uvAt: (u, v) => toShellUv(SHELL_FAMILY.nacre, u, v, PEARL_PATTERN)
  };
};

/** Open scallop, cockle or clam, opened 30-120 degrees, some with a pearl. */
export const createOpenShell = (random: Random, variant: number): PropMesh => {
  const builder = new MeshBuilder();
  const { angle, pearl, shape } = OPEN_SHELLS[variant % OPEN_SHELLS.length]!;
  const size = 0.12 + random() * 0.04;
  const options: ValveOptions = { columns: OPEN_COLUMNS, shape, size, tone: SHELL_BASE };
  const lower = getLowerValve(options);
  const parts = [...lower, ...getUpperValve(options, angle)];
  if (pearl) parts.push(getPearl(options, lower[1]!));
  for (const surface of sinkSurfaces(parts, 0)) addShellSurface(builder, surface, size * 0.15);
  return finishStill(builder);
};
