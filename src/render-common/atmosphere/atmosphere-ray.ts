import {
  ATMOSPHERE_MIN_DIRECTION_SQUARED,
  type AtmosphereProfile,
  type AtmosphereVec3,
  integrateAtmosphereHeightDensity,
  sanitizeAtmosphereFloat32,
} from "./atmosphere-height";

export interface AtmosphereBounds {
  readonly max: AtmosphereVec3;
  readonly min: AtmosphereVec3;
}

export interface AtmosphereRay {
  readonly origin: AtmosphereVec3;
  readonly direction: AtmosphereVec3;
  readonly length: number;
}

export interface AtmosphereSkyRayParams {
  bounds: AtmosphereBounds;
  direction: AtmosphereVec3;
  eye: AtmosphereVec3;
}

export interface AtmosphereSurfaceRayParams {
  bounds: AtmosphereBounds;
  eye: AtmosphereVec3;
  forward: AtmosphereVec3;
  orthographic: boolean;
  /** World depth of the current orthographic view; omitted keeps the legacy full-volume path. */
  orthoPathLength?: number;
  worldPosition: AtmosphereVec3;
}

const EMPTY_DIRECTION: AtmosphereVec3 = [0, 1, 0];
const EMPTY_VECTOR: AtmosphereVec3 = [0, 0, 0];
const AABB_PARALLEL_EPSILON = 1e-8;

const isFloat32Vector = (value: AtmosphereVec3): boolean =>
  value.every(
    component => Number.isFinite(component) && Number.isFinite(Math.fround(component)),
  );

/** Every component is finite after float32 uniform conversion. */
export const sanitizeAtmosphereVector = (value: AtmosphereVec3): AtmosphereVec3 => [
  sanitizeAtmosphereFloat32(value[0]),
  sanitizeAtmosphereFloat32(value[1]),
  sanitizeAtmosphereFloat32(value[2]),
];

export const emptyAtmosphereRay = (
  origin: AtmosphereVec3 = EMPTY_VECTOR,
): AtmosphereRay => ({
  origin,
  direction: EMPTY_DIRECTION,
  length: 0,
});

export const normalizeAtmosphereDirection = (
  value: AtmosphereVec3,
): AtmosphereVec3 | null => {
  if (!isFloat32Vector(value)) return null;
  const x = sanitizeAtmosphereFloat32(value[0]);
  const y = sanitizeAtmosphereFloat32(value[1]);
  const z = sanitizeAtmosphereFloat32(value[2]);
  const lengthSquared = x * x + y * y + z * z;
  if (!(lengthSquared > ATMOSPHERE_MIN_DIRECTION_SQUARED)) return null;
  if (!Number.isFinite(lengthSquared)) return null;
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  return [x * inverseLength, y * inverseLength, z * inverseLength];
};

export const sanitizeAtmosphereRay = (ray: AtmosphereRay): AtmosphereRay => {
  const origin = isFloat32Vector(ray.origin)
    ? sanitizeAtmosphereVector(ray.origin)
    : EMPTY_VECTOR;
  const direction = normalizeAtmosphereDirection(ray.direction);
  const length = sanitizeAtmosphereFloat32(ray.length);
  if (!direction || !(length > 0)) return emptyAtmosphereRay(origin);
  return { origin, direction, length };
};

export const sanitizeAtmosphereBounds = (
  bounds: AtmosphereBounds,
): AtmosphereBounds => {
  if (!isFloat32Vector(bounds.min) || !isFloat32Vector(bounds.max)) {
    return { max: EMPTY_VECTOR, min: EMPTY_VECTOR };
  }
  const first = sanitizeAtmosphereVector(bounds.min);
  const second = sanitizeAtmosphereVector(bounds.max);
  return {
    max: [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      Math.max(first[2], second[2]),
    ],
    min: [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      Math.min(first[2], second[2]),
    ],
  };
};

export const getAtmosphereBoundsDiagonal = (bounds: AtmosphereBounds): number => {
  const safeBounds = sanitizeAtmosphereBounds(bounds);
  const diagonal = Math.hypot(
    safeBounds.max[0] - safeBounds.min[0],
    safeBounds.max[1] - safeBounds.min[1],
    safeBounds.max[2] - safeBounds.min[2],
  );
  return Number.isFinite(diagonal) ? diagonal : 0;
};

const hasPositiveVolume = (bounds: AtmosphereBounds): boolean =>
  bounds.max[0] > bounds.min[0] &&
  bounds.max[1] > bounds.min[1] &&
  bounds.max[2] > bounds.min[2];

type SlabInterval = readonly [near: number, far: number];

const clipSlab = (
  origin: number,
  direction: number,
  slabMin: number,
  slabMax: number,
  nearT: number,
  farT: number,
): SlabInterval | null => {
  if (Math.abs(direction) < AABB_PARALLEL_EPSILON) {
    if (origin >= slabMin && origin <= slabMax) return [nearT, farT];
    return null;
  }
  const first = (slabMin - origin) / direction;
  const second = (slabMax - origin) / direction;
  const near = Math.max(nearT, Math.min(first, second));
  const far = Math.min(farT, Math.max(first, second));
  return near <= far ? [near, far] : null;
};

/** Clip a finite ray to the finite atmosphere volume, rejecting misses and flat volumes. */
export const clipAtmosphereRay = (
  ray: AtmosphereRay,
  bounds: AtmosphereBounds,
): AtmosphereRay => {
  const safeRay = sanitizeAtmosphereRay(ray);
  const safeBounds = sanitizeAtmosphereBounds(bounds);
  if (!(safeRay.length > 0) || !hasPositiveVolume(safeBounds)) {
    return emptyAtmosphereRay(safeRay.origin);
  }
  let interval: SlabInterval | null = [0, safeRay.length];
  for (const axis of [0, 1, 2] as const) {
    if (!interval) break;
    interval = clipSlab(
      safeRay.origin[axis],
      safeRay.direction[axis],
      safeBounds.min[axis],
      safeBounds.max[axis],
      interval[0],
      interval[1],
    );
  }
  if (!interval || !(interval[1] - interval[0] > 0)) {
    return emptyAtmosphereRay(safeRay.origin);
  }
  const [nearT, farT] = interval;
  const clippedOrigin: AtmosphereVec3 = [
    Math.min(
      Math.max(safeRay.origin[0] + safeRay.direction[0] * nearT, safeBounds.min[0]),
      safeBounds.max[0],
    ),
    Math.min(
      Math.max(safeRay.origin[1] + safeRay.direction[1] * nearT, safeBounds.min[1]),
      safeBounds.max[1],
    ),
    Math.min(
      Math.max(safeRay.origin[2] + safeRay.direction[2] * nearT, safeBounds.min[2]),
      safeBounds.max[2],
    ),
  ];
  const length = sanitizeAtmosphereFloat32(farT - nearT);
  if (!(length > 0)) return emptyAtmosphereRay(clippedOrigin);
  return {
    origin: sanitizeAtmosphereVector(clippedOrigin),
    direction: safeRay.direction,
    length,
  };
};

/**
 * Perspective: actual eye to the surface. Orthographic: parallel forward, starting two volume
 * diagonals upstream of the surface, or the supplied current view depth when the camera adapter
 * has one; the artificial camera offset is never consulted.
 */
export const atmosphereSurfaceRay = ({
  bounds,
  eye,
  forward,
  orthographic,
  orthoPathLength,
  worldPosition,
}: AtmosphereSurfaceRayParams): AtmosphereRay => {
  if (!isFloat32Vector(worldPosition)) return emptyAtmosphereRay();
  const safeWorldPosition = sanitizeAtmosphereVector(worldPosition);
  const diagonal = getAtmosphereBoundsDiagonal(bounds);
  if (!(diagonal > 0)) return emptyAtmosphereRay(safeWorldPosition);
  if (orthographic) {
    const direction = normalizeAtmosphereDirection(forward);
    if (!direction) return emptyAtmosphereRay(safeWorldPosition);
    const fallbackLength = 2 * diagonal;
    const requestedLength = orthoPathLength !== undefined && Number.isFinite(orthoPathLength)
      ? Math.max(0, orthoPathLength)
      : fallbackLength;
    let length = Math.min(fallbackLength, requestedLength);
    if (orthoPathLength !== undefined && isFloat32Vector(eye)) {
      // Do not trace past the actual camera plane.
      const cameraDepth = (safeWorldPosition[0] - eye[0]) * direction[0] +
        (safeWorldPosition[1] - eye[1]) * direction[1] +
        (safeWorldPosition[2] - eye[2]) * direction[2];
      length = Math.min(length, Math.max(0, cameraDepth));
    }
    length = sanitizeAtmosphereFloat32(length);
    if (!(length > 0)) return emptyAtmosphereRay(safeWorldPosition);
    const upstreamOrigin: AtmosphereVec3 = [
      safeWorldPosition[0] - direction[0] * length,
      safeWorldPosition[1] - direction[1] * length,
      safeWorldPosition[2] - direction[2] * length,
    ];
    return { origin: upstreamOrigin, direction, length };
  }
  if (!isFloat32Vector(eye)) return emptyAtmosphereRay();
  const safeEye = sanitizeAtmosphereVector(eye);
  const offset: AtmosphereVec3 = [
    safeWorldPosition[0] - safeEye[0],
    safeWorldPosition[1] - safeEye[1],
    safeWorldPosition[2] - safeEye[2],
  ];
  const direction = normalizeAtmosphereDirection(offset);
  if (!direction) return emptyAtmosphereRay(safeEye);
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  return { origin: safeEye, direction, length: distance };
};

/** Actual eye and normalized direction, traced through at most two volume diagonals. */
export const atmosphereSkyRay = ({
  bounds,
  direction,
  eye,
}: AtmosphereSkyRayParams): AtmosphereRay => {
  if (!isFloat32Vector(eye)) return emptyAtmosphereRay();
  const safeEye = sanitizeAtmosphereVector(eye);
  const safeDirection = normalizeAtmosphereDirection(direction);
  const diagonal = getAtmosphereBoundsDiagonal(bounds);
  if (!safeDirection || !(diagonal > 0)) return emptyAtmosphereRay(safeEye);
  return { origin: safeEye, direction: safeDirection, length: 2 * diagonal };
};

/** CPU mirror of atmosphereOpticalDepth for deterministic tests and profile selection. */
export const atmosphereOpticalDepth = (
  ray: AtmosphereRay,
  bounds: AtmosphereBounds,
  profile: AtmosphereProfile,
  pass = true,
): number => {
  if (!pass) return 0;
  const clipped = clipAtmosphereRay(ray, bounds);
  if (!(clipped.length > 0)) return 0;
  return integrateAtmosphereHeightDensity({
    directionY: clipped.direction[1],
    length: clipped.length,
    profile,
    startHeight: clipped.origin[1],
  });
};
