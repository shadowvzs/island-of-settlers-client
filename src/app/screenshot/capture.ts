import { downloadBlob } from "../helpers";
import { SCREENSHOT_EXTENSION, SCREENSHOT_MIME } from "./constants";

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** Local date-time file name without a prefix: `2026-11-13_20-05-09.png`. */
export const screenshotFileName = (date: Date) => {
  const day = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  const time = `${twoDigits(date.getHours())}-${twoDigits(date.getMinutes())}-${twoDigits(date.getSeconds())}`;
  return `${day}_${time}.${SCREENSHOT_EXTENSION}`;
};

/**
 * Captures the canvas as the player sees the current frame. Call it inside the same task as the
 * render that drew the frame: the WebGL drawing buffer is cleared when that task ends.
 */
export const saveScreenshot = (canvas: HTMLCanvasElement, date = new Date()) => {
  const fileName = screenshotFileName(date);
  try {
    canvas.toBlob(blob => {
      if (!blob) {
        console.warn("Screenshot capture failed");
        return;
      }
      downloadBlob(blob, fileName);
    }, SCREENSHOT_MIME);
  } catch (error) {
    console.warn("Screenshot capture failed", error);
  }
};
