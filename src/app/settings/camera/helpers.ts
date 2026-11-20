import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { type CameraBookmark,MAX_CAMERA_BOOKMARKS } from "../../camera-bookmarks";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";

/** Which zoom buttons can still zoom (false: the button looks disabled at its limit). */
interface ZoomLimits {
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/** One shared object per combination, so a store publishes only when a limit actually changes. */
const ZOOM_LIMITS: readonly (readonly ZoomLimits[])[] = [
  [{ canZoomIn: false, canZoomOut: false }, { canZoomIn: false, canZoomOut: true }],
  [{ canZoomIn: true, canZoomOut: false }, { canZoomIn: true, canZoomOut: true }]
];

export const getZoomLimits = (canZoomIn: boolean, canZoomOut: boolean) =>
  ZOOM_LIMITS[Number(canZoomIn)]![Number(canZoomOut)]!;

/** Bookmark status line: the count (saved with the game) or why a save was refused. */
export const getBookmarkStatus = (count: number, invalidName: boolean, i18n?: I18n) => invalidName
  ? translateMessage(i18n, M.camera.statusInvalid)
  : translateMessage(i18n, M.camera.status, { count, max: MAX_CAMERA_BOOKMARKS });

/** One bookmark row: its go / delete button names and its list index. */
export interface BookmarkRow {
  deleteLabel: string;
  goLabel: string;
  index: number;
  key: string;
  name: string;
}

export const getBookmarkRows = (bookmarks: readonly CameraBookmark[], i18n?: I18n): BookmarkRow[] =>
  bookmarks.map(({ name }, index) => ({
    deleteLabel: translateMessage(i18n, M.camera.deleteBookmark, { name }),
    goLabel: translateMessage(i18n, M.camera.goTo, { name }),
    index,
    key: `${index}:${name}`,
    name
  }));
