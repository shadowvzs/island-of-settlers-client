/** New-map presentation defaults; elapsed time, transitions and current weather live in game saves. */
export interface EnvironmentDefaults {
  hour: number;
  cycling: boolean;
  rain: boolean;
  snow: boolean;
}

export const validEnvironmentDefaults = (value: unknown): value is EnvironmentDefaults => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["hour", "cycling", "rain", "snow"].includes(key))) return false;
  return typeof fields.hour === "number" && Number.isFinite(fields.hour) && fields.hour >= 0 && fields.hour < 24 &&
    typeof fields.cycling === "boolean" && typeof fields.rain === "boolean" && typeof fields.snow === "boolean" &&
    !(fields.rain && fields.snow);
};
