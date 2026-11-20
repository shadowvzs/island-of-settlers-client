/** One canonical wind direction for rain, vegetation, snow drift and generation fields. */
export const PREVAILING_WIND = { x: 0.8, z: 0.35 } as const;

const length = Math.sqrt(PREVAILING_WIND.x * PREVAILING_WIND.x + PREVAILING_WIND.z * PREVAILING_WIND.z);

export const PREVAILING_WIND_DIRECTION = {
  x: PREVAILING_WIND.x / length,
  z: PREVAILING_WIND.z / length
} as const;
