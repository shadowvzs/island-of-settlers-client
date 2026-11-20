import { repeatWindow } from "../../../../../../island-of-settlers-shared/src/script/engine/repeat-windows";
import type { QuestRepeat } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import { CLAIM_PREVIEW_HORIZON_DAYS, DAY_MS, HOUR_MS, MINUTE_MS } from "./constants";

/**
 * The next claim dates of a repeat rule (design §7.2, §13.6: UTC grid, local-time preview): the moments the
 * engine's window index (`repeatWindow`, the same shared function) moves on after `fromUtc`. An interval grid is
 * anchored at the first activation; the preview assumes the quest is activated at `fromUtc`.
 */

const windowAt = (repeat: QuestRepeat, t: number, anchor: number) => repeatWindow(repeat, t, anchor);

/** The first minute in (start, start + span] whose window differs from the window at `start`. */
const firstChange = (repeat: QuestRepeat, start: number, span: number, step: number, anchor: number) => {
  const base = windowAt(repeat, start, anchor);
  for (let t = start + step; t <= start + span; t += step) if (windowAt(repeat, t, anchor) !== base) return t;
  return null;
};

/** The next window start after `t`: an hourly scan, then the exact minute inside that hour. */
const nextWindowStart = (repeat: QuestRepeat, t: number, anchor: number) => {
  const hour = firstChange(repeat, t, CLAIM_PREVIEW_HORIZON_DAYS * DAY_MS, HOUR_MS, anchor);
  if (hour === null) return null;
  return firstChange(repeat, hour - HOUR_MS, HOUR_MS, MINUTE_MS, anchor);
};

/** Up to `count` upcoming window starts (UTC ms); none for `once` and `onCompletion`. */
export const nextClaimDates = (repeat: QuestRepeat, fromUtc: number, count: number): number[] => {
  if (repeatWindow(repeat, fromUtc, fromUtc) === null) return [];
  const anchor = Math.floor(fromUtc / MINUTE_MS) * MINUTE_MS;
  const dates: number[] = [];
  let t = anchor;
  while (dates.length < count) {
    const next = nextWindowStart(repeat, t, anchor);
    if (next === null) break;
    dates.push(next);
    t = next;
  }
  return dates;
};

/** A claim date in the author's local time with its UTC moment ("12 Nov 2026, 01:00 (UTC 00:00)"). */
export const formatClaimDate = (utc: number, locale: string) => {
  const local = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(utc);
  const universal = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
    .format(utc);
  return { local, utc: universal };
};
