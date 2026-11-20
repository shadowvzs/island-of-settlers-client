/** A finite world-space or device-space vector. */
export type AtmosphereVec3 = readonly [number, number, number];

export interface AtmosphereProfile {
  /** Extinction coefficient in inverse world units. */
  extinction: number;
  /** Positive exponential density falloff in inverse world units. */
  falloff: number;
  /** Height at and below which density stays constant. */
  referenceHeight: number;
}

export interface AtmosphereHeightSegment {
  directionY: number;
  length: number;
  profile: AtmosphereProfile;
  startHeight: number;
}

/** The shader clamps its final optical depth to this value. */
export const ATMOSPHERE_MAX_OPTICAL_DEPTH = 32;

/** Directions shorter than this are degenerate rather than very nearly horizontal. */
export const ATMOSPHERE_MIN_DIRECTION_SQUARED = 1e-12;

/** Slab directions below this share are parallel to the slab plane. */
export const ATMOSPHERE_PARALLEL_EPSILON = 1e-8;

/** Below this |q| the exponential integral uses its Taylor series. */
export const ATMOSPHERE_SMALL_Q = 1e-3;

/** A finite float32 value; invalid CPU input becomes zero before it reaches a uniform. */
export const sanitizeAtmosphereFloat32 = (value: number): number => {
  const rounded = Math.fround(value);
  return Number.isFinite(rounded) ? rounded : 0;
};

export const sanitizeAtmosphereProfile = (
  profile: AtmosphereProfile,
): AtmosphereProfile => ({
  extinction: Math.max(sanitizeAtmosphereFloat32(profile.extinction), 0),
  falloff: Math.max(sanitizeAtmosphereFloat32(profile.falloff), 0),
  referenceHeight: sanitizeAtmosphereFloat32(profile.referenceHeight),
});

/** Pack the profile exactly as uAtmosphereProfile. */
export const toAtmosphereProfileUniform = (
  profile: AtmosphereProfile,
  orthographic: boolean,
): readonly [number, number, number, number] => {
  const safeProfile = sanitizeAtmosphereProfile(profile);
  return [
    safeProfile.extinction,
    safeProfile.falloff,
    safeProfile.referenceHeight,
    orthographic ? 1 : 0,
  ];
};

/** Density is constant below the reference height and falls exponentially above it. */
export const atmosphereDensityAtHeight = (
  profile: AtmosphereProfile,
  height: number,
): number => {
  const safeProfile = sanitizeAtmosphereProfile(profile);
  if (safeProfile.extinction <= 0 || !Number.isFinite(height)) return 0;
  const aboveReference = Math.max(height - safeProfile.referenceHeight, 0);
  const density = safeProfile.extinction * Math.exp(-safeProfile.falloff * aboveReference);
  return Number.isFinite(density) ? density : 0;
};

/**
 * g(q) = (1 - exp(-q)) / q, evaluated by its Taylor series near zero so that a nearly
 * horizontal ray stays finite and loses no useful precision.
 */
const smallQIntegral = (q: number): number =>
  1 - q * (0.5 - q * (1 / 6 - q * (1 / 24 - q / 120)));

const belowReferenceLength = (
  startHeight: number,
  endHeight: number,
  directionY: number,
  length: number,
  referenceHeight: number,
): number => {
  let belowLength = 0;
  if (directionY > 0) {
    if (startHeight < referenceHeight) {
      if (endHeight <= referenceHeight) belowLength = length;
      else belowLength = (referenceHeight - startHeight) / directionY;
    }
  } else if (directionY < 0) {
    if (startHeight <= referenceHeight) belowLength = length;
    else if (endHeight < referenceHeight) {
      belowLength = (referenceHeight - endHeight) / -directionY;
    }
  } else if (startHeight <= referenceHeight) {
    belowLength = length;
  }
  return Math.min(Math.max(belowLength, 0), length);
};

/**
 * Integrated density above the reference, divided by extinction. For large |q| the endpoint
 * quotient is the stable 1/q form; for small |q| the series avoids catastrophic cancellation.
 */
const integrateAboveReference = (
  profile: AtmosphereProfile,
  startHeight: number,
  endHeight: number,
  length: number,
): number => {
  const startDensity = Math.exp(-profile.falloff * startHeight);
  if (profile.falloff <= 0) return startDensity * length;
  const q = profile.falloff * (endHeight - startHeight);
  let integrated = 0;
  if (Math.abs(q) < ATMOSPHERE_SMALL_Q) {
    integrated = startDensity * length * smallQIntegral(q);
  } else {
    const endDensity = Math.exp(-profile.falloff * endHeight);
    integrated = ((startDensity - endDensity) * length) / q;
  }
  return integrated > 0 && Number.isFinite(integrated) ? integrated : 0;
};

const boundOpticalDepth = (opticalDepth: number): number => {
  if (!(opticalDepth > 0)) return 0;
  return Math.min(opticalDepth, ATMOSPHERE_MAX_OPTICAL_DEPTH);
};

/** Exact analytical integral for one ray segment, including a reference-height crossing. */
export const integrateAtmosphereHeightDensity = ({
  directionY,
  length,
  profile,
  startHeight,
}: AtmosphereHeightSegment): number => {
  if (!Number.isFinite(directionY) || !Number.isFinite(startHeight)) return 0;
  if (!Number.isFinite(length) || length <= 0) return 0;
  const safeProfile = sanitizeAtmosphereProfile(profile);
  if (safeProfile.extinction <= 0) return 0;
  const endHeight = startHeight + directionY * length;
  if (!Number.isFinite(endHeight)) return 0;
  const belowLength = belowReferenceLength(
    startHeight,
    endHeight,
    directionY,
    length,
    safeProfile.referenceHeight,
  );
  const aboveLength = length - belowLength;
  const aboveStart = Math.max(startHeight - safeProfile.referenceHeight, 0);
  const aboveEnd = Math.max(endHeight - safeProfile.referenceHeight, 0);
  const aboveDensity = integrateAboveReference(
    safeProfile,
    aboveStart,
    aboveEnd,
    aboveLength,
  );
  return boundOpticalDepth(safeProfile.extinction * (belowLength + aboveDensity));
};
