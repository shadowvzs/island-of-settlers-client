import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import { type Bounds, faceBox, facePoint, faceSize, type WallFace } from "./nubian-decor-faces";

/** Painted designs per decor shape; the renderer's atlases hold exactly these. */
export const NUBIAN_DECOR_VARIANTS = { hat: 2, shield: 3, skull: 2, textile: 4, vase: 3 } as const;

export type NubianDecorKind = "hat" | "jars" | "shield" | "skull" | "textile";

/** One prop assembly, placed against a face: its parts and the space it takes in front of the wall. */
export interface DecorAssembly {
  occupied: Bounds;
  parts: BuildingPart[];
}
/** Where an assembly goes: `along` is its centre on the wall, `y` its kind's reference height. */
export interface DecorSpot {
  along: number;
  detailed: boolean;
  face: WallFace;
  variant: number;
  y: number;
}

const STAGE = 4;
/** Pegs and brackets are set this deep into the mud brick. */
const EMBED = 0.006;

/** A square wooden peg from inside the wall out to `out`. */
const peg = (
  face: WallFace,
  along: number,
  y: number,
  out: number,
  thickness = 0.016
): BuildingPart => ({
  position: facePoint(face, along, y, (out - EMBED) / 2),
  shape: "box",
  size: faceSize(face, thickness, thickness, out + EMBED),
  stage: STAGE,
  surface: "wood"
});

/** A cylinder lying along the wall (a hanging rod). */
const rodAlong = (
  face: WallFace,
  along: number,
  y: number,
  out: number,
  length: number,
  radius: number,
  detailed: boolean
): BuildingPart => ({
  position: facePoint(face, along, y, out),
  radialSegments: detailed ? 6 : 4,
  rotation: face.along === 0 ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
  shape: "cylinder",
  size: [radius * 2, length, radius * 2],
  stage: STAGE,
  surface: "wood"
});

/** A +Z-facing shaped part turned to face outward, its back `back` off the wall. */
const facing = (
  spot: DecorSpot,
  shape: BuildingPart["shape"],
  size: Point3,
  center: [number, number],
  back: number,
  tilt = 0
): BuildingPart => ({
  decorVariant: spot.variant,
  position: facePoint(spot.face, center[0], center[1], back + size[2] / 2),
  rotation: [tilt, spot.face.yaw, 0],
  shape,
  size,
  stage: STAGE,
  surface: "nubian-decor"
});

/** A part tilted within the wall plane by `angle` (spears crossing behind a shield). */
const inWallPlane = (face: WallFace, size: Point3, angle: number) =>
  face.axis === 2
    ? { rotation: [0, 0, angle] as Point3, size }
    : { rotation: [angle, 0, 0] as Point3, size: [size[2], size[1], size[0]] as Point3 };

const TEXTILE_ASPECT = 1.4;
const TEXTILE_ROD_OUT = 0.03;
const TEXTILE_ROD_RADIUS = 0.011;

/**
 * A woven palm-fibre hanging on a wooden rod: High hangs the rod on two pegs, Minimal sets it
 * against the wall. The cloth's top hem wraps the rod; `y` is the rod height.
 */
export const textileAssembly = (spot: DecorSpot, width: number): DecorAssembly => {
  const { along, detailed, face, y } = spot,
    height = width * TEXTILE_ASPECT;
  const out = detailed ? TEXTILE_ROD_OUT : TEXTILE_ROD_RADIUS;
  const parts: BuildingPart[] = [
    rodAlong(face, along, y, out, width + 0.05, TEXTILE_ROD_RADIUS, detailed),
    {
      decorVariant: spot.variant,
      position: facePoint(face, along, y - height / 2 + 0.012, out),
      rotation: [0, face.yaw, 0],
      shape: "nubian-textile",
      size: [width, height, 0.01],
      stage: STAGE,
      surface: "nubian-textile"
    }
  ];
  if (detailed)
    for (const side of [-1, 1])
      parts.push(peg(face, along + side * (width / 2 + 0.012), y, TEXTILE_ROD_OUT, 0.014));
  return {
    occupied: faceBox(
      face,
      [along - width / 2 - 0.025, along + width / 2 + 0.025],
      [y - height + 0.012, y + TEXTILE_ROD_RADIUS],
      [0.004, out + 0.035]
    ),
    parts
  };
};

const SHIELD_SIZE: Point3 = [0.27, 0.41, 0.06];
const SHIELD_BACK = 0.028;
const SPEAR_LENGTH = 0.54;
const SPEAR_ANGLE = 0.42;
const SPEAR_OUT = 0.014;

/** Two forged spears crossed behind the shield, each with a leaf-shaped iron blade. */
const crossedSpears = (face: WallFace, along: number, y: number) =>
  [-1, 1].flatMap((side) => {
    const angle = side * SPEAR_ANGLE,
      shaft = inWallPlane(face, [0.022, SPEAR_LENGTH, 0.022], angle);
    const blade = inWallPlane(face, [0.042, 0.13, 0.012], angle);
    // In-plane direction of the shaft's +Y end, from the same rotation as the geometry.
    const lean = face.axis === 2 ? -DMath.sin(angle) : DMath.sin(angle);
    const reach = SPEAR_LENGTH / 2 + 0.055;
    return [
      {
        position: facePoint(face, along, y, SPEAR_OUT),
        shape: "cylinder",
        radialSegments: 5,
        ...shaft,
        stage: STAGE,
        surface: "wood"
      },
      {
        position: facePoint(face, along + lean * reach, y + DMath.cos(angle) * reach, SPEAR_OUT),
        shape: "sphere",
        radialSegments: 4,
        ...blade,
        stage: STAGE,
        surface: "iron"
      }
    ] as BuildingPart[];
  });

/** A tall painted hide shield on a peg, optionally with two spears crossed behind it. `y` is its centre. */
export const shieldAssembly = (spot: DecorSpot, spears: boolean): DecorAssembly => {
  const { along, face, y } = spot;
  const parts = [
    peg(face, along, y, SHIELD_BACK + 0.004, 0.02),
    facing(spot, "nubian-shield", SHIELD_SIZE, [along, y], SHIELD_BACK)
  ];
  if (spears) parts.push(...crossedSpears(face, along, y));
  const halfWidth = spears ? DMath.sin(SPEAR_ANGLE) * (SPEAR_LENGTH / 2 + 0.12) : SHIELD_SIZE[0] / 2;
  const halfHeight = spears
    ? DMath.cos(SPEAR_ANGLE) * (SPEAR_LENGTH / 2 + 0.12)
    : SHIELD_SIZE[1] / 2;
  return {
    occupied: faceBox(
      face,
      [along - halfWidth, along + halfWidth],
      [y - halfHeight, y + halfHeight],
      [0.004, SHIELD_BACK + SHIELD_SIZE[2]]
    ),
    parts
  };
};

/** Cattle bucranium (lyre horns) or oryx skull (long horns sweeping up); `y` is the skull centre. */
const SKULL_SIZES: readonly Point3[] = [
  [0.42, 0.37, 0.08],
  [0.21, 0.56, 0.07]
];
const SKULL_BACK = 0.012;

export const skullHeight = (variant: number) => SKULL_SIZES[variant]![1];

export const skullAssembly = (spot: DecorSpot): DecorAssembly => {
  const { along, face, y } = spot,
    size = SKULL_SIZES[spot.variant]!;
  const parts = [
    peg(face, along, y, SKULL_BACK + 0.01, 0.02),
    facing(spot, "nubian-skull", size, [along, y], SKULL_BACK)
  ];
  return {
    occupied: faceBox(
      face,
      [along - size[0] / 2, along + size[0] / 2],
      [y - size[1] / 2, y + size[1] / 2],
      [0.004, SKULL_BACK + size[2]]
    ),
    parts
  };
};

const HAT_SIZE: Point3 = [0.3, 0.12, 0.3];
const HAT_BACK = 0.006;

/** A palm-leaf sun hat hung by its crown on a peg, brim against the wall; `y` is the hat centre. */
export const hatAssembly = (spot: DecorSpot): DecorAssembly => {
  const { along, face, y } = spot;
  // Lying on its back the crown points outward: local Y becomes the outward normal.
  const hat: BuildingPart = {
    ...facing(spot, "nubian-hat", HAT_SIZE, [along, y], 0, Math.PI / 2),
    position: facePoint(face, along, y, HAT_BACK + HAT_SIZE[1] / 2)
  };
  return {
    occupied: faceBox(
      face,
      [along - HAT_SIZE[0] / 2, along + HAT_SIZE[0] / 2],
      [y - HAT_SIZE[2] / 2, y + HAT_SIZE[2] / 2],
      [0.004, HAT_BACK + HAT_SIZE[1]]
    ),
    parts: [peg(face, along, y, HAT_BACK + 0.05, 0.018), hat]
  };
};

/** Jar sizes: a tall water jar, then a smaller painted pot beside it. */
const JARS: readonly Point3[] = [
  [0.18, 0.28, 0.18],
  [0.13, 0.18, 0.13]
];
/** Jars stand clear of the footing course along the wall. */
const JAR_STANDOFF = 0.035;

/** Two painted jars on the ground before the wall, the smaller one on the `away` side. */
export const jarsAssembly = (spot: DecorSpot, away: 1 | -1): DecorAssembly => {
  const { along, face } = spot;
  const [large, small] = JARS as [Point3, Point3];
  const smallAlong = along + away * (large[0] / 2 + small[0] / 2 + 0.012);
  const jar = (size: Point3, at: number, variant: number): BuildingPart => ({
    decorVariant: variant,
    position: facePoint(face, at, size[1] / 2, JAR_STANDOFF + size[0] / 2),
    rotation: [0, face.yaw, 0],
    shape: "nubian-vase",
    size,
    stage: STAGE,
    surface: "nubian-decor"
  });
  const second = (spot.variant + 1) % NUBIAN_DECOR_VARIANTS.vase;
  const ends = [along - (away * large[0]) / 2, smallAlong + (away * small[0]) / 2].sort(
    (a, b) => a - b
  ) as [number, number];
  return {
    occupied: faceBox(face, ends, [0, large[1]], [JAR_STANDOFF, JAR_STANDOFF + large[0]]),
    parts: [jar(large, along, spot.variant), jar(small, smallAlong, second)]
  };
};
