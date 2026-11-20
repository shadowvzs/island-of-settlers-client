import { useState } from "react";

/**
 * The image source to show, or null for the fallback: a missing image record (null source) and an image that
 * failed to load (removed blob, broken file) both fall back, without retrying the failed source.
 */
export const useCampaignImage = (source: string | null) => {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const imageSource = source === failedSource ? null : source;
  return { imageSource, onError: () => setFailedSource(source) };
};
