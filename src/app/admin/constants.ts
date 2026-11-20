import applyIconUrl from "../../../assets/ui-icons/actions/apply.webp?url";
import cancelIconUrl from "../../../assets/ui-icons/actions/cancel.webp?url";
import resetIconUrl from "../../../assets/ui-icons/actions/demolish.webp?url";
import restoreIconUrl from "../../../assets/ui-icons/actions/import.webp?url";
import cachesIconUrl from "../../../assets/ui-icons/actions/inventory.webp?url";
import verifyIconUrl from "../../../assets/ui-icons/actions/scout.webp?url";
import scrollIconUrl from "../../../assets/ui-icons/actions/scroll.webp?url";
import banIconUrl from "../../../assets/ui-icons/actions/skull.webp?url";
import reloadIconUrl from "../../../assets/ui-icons/camera/rotate-right.png?url";
import clearSavesIconUrl from "../../../assets/ui-icons/clear-saves.svg?url";
import saveIconUrl from "../../../assets/ui-icons/floppy-disk.webp?url";
import recreateIconUrl from "../../../assets/ui-icons/recreate-database.svg?url";

/** The Users placeholder lists the first accounts only (owner Q8). */
export const USER_LIST_LIMIT = 100;
/** The footer reads the newest revision of the history route. */
export const FOOTER_REVISION_LIMIT = 1;
/** An expired access token: renew once and retry. */
export const HTTP_UNAUTHORIZED = 401;
/** A shortened account or revision id in the footer when no name is known. */
export const SHORT_ID_LENGTH = 8;

/** Compact icon buttons of the window (existing rendered UI icons; no new artwork). */
export const ADMIN_ICONS = Object.freeze({
  apply: applyIconUrl,
  ban: banIconUrl,
  caches: cachesIconUrl,
  cancel: cancelIconUrl,
  clearSaves: clearSavesIconUrl,
  preset: scrollIconUrl,
  recreate: recreateIconUrl,
  reload: reloadIconUrl,
  reset: resetIconUrl,
  restore: restoreIconUrl,
  save: saveIconUrl,
  verify: verifyIconUrl
});
export type AdminIconName = keyof typeof ADMIN_ICONS;
