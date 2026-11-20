/**
 * Development review seam (like `window.__rainbow`): a fixed cloud cover for sky/cloud captures.
 * Off in production builds by the DEV guard; the weather-driven value applies otherwise.
 */
export const cloudCoverOverride = () => {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  const value = (window as { __skyCloudCover?: number }).__skyCloudCover;
  return Number.isFinite(value) ? value : undefined;
};
