import {
  CAMPAIGN_IMAGE_MAX_BYTES, CAMPAIGN_IMAGE_MAX_EDGE, CAMPAIGN_IMAGE_MIME_TYPE
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { IMAGE_SCALE_STEPS, RAW_IMAGE_MAX_BYTES, WEBP_QUALITIES } from "./constants";

/** Why an upload was refused: too large before decoding, unreadable, or no WebP fits the size limit. */
export type ImageRefusal = "tooLarge" | "unreadable" | "tooDetailed";

export class CampaignImageRefused extends Error {
  readonly reason: ImageRefusal;

  constructor(reason: ImageRefusal) {
    super(`Campaign image refused: ${reason}`);
    this.name = "CampaignImageRefused";
    this.reason = reason;
  }
}

/** One encode attempt: output size and WebP quality. */
export interface EncodeAttempt {
  height: number;
  quality: number;
  width: number;
}

/**
 * Encode attempts from best to smallest (owner 2026-11-09: WebP, at most 1024 px and ~300 KB): the image is
 * first fitted into 1024 px, then each scale step tries every quality before shrinking further. Never upscales.
 */
export const encodeAttempts = (width: number, height: number): EncodeAttempt[] => {
  const fit = Math.min(1, CAMPAIGN_IMAGE_MAX_EDGE / Math.max(width, height, 1));
  return IMAGE_SCALE_STEPS.flatMap(step => WEBP_QUALITIES.map(quality => ({
    height: Math.max(1, Math.round(height * fit * step)),
    quality,
    width: Math.max(1, Math.round(width * fit * step))
  })));
};

export interface ProcessedImage {
  bytes: Uint8Array;
  height: number;
  width: number;
}

const encode = async (bitmap: ImageBitmap, attempt: EncodeAttempt) => {
  const canvas = new OffscreenCanvas(attempt.width, attempt.height);
  const context = canvas.getContext("2d");
  if (!context) throw new CampaignImageRefused("unreadable");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, attempt.width, attempt.height);
  return canvas.convertToBlob({ quality: attempt.quality, type: CAMPAIGN_IMAGE_MIME_TYPE });
};

const decode = async (file: Blob) => {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new CampaignImageRefused("unreadable");
  }
};

/** Decodes an uploaded file and re-encodes it as a WebP within the campaign image limits (browser only). */
export const processCampaignImage = async (file: Blob): Promise<ProcessedImage> => {
  if (file.size > RAW_IMAGE_MAX_BYTES) throw new CampaignImageRefused("tooLarge");
  const bitmap = await decode(file);
  try {
    for (const attempt of encodeAttempts(bitmap.width, bitmap.height)) {
      const blob = await encode(bitmap, attempt);
      if (blob.type !== CAMPAIGN_IMAGE_MIME_TYPE) throw new CampaignImageRefused("unreadable");
      if (blob.size <= CAMPAIGN_IMAGE_MAX_BYTES)
        return { bytes: new Uint8Array(await blob.arrayBuffer()), height: attempt.height, width: attempt.width };
    }
  } finally {
    bitmap.close();
  }
  throw new CampaignImageRefused("tooDetailed");
};
