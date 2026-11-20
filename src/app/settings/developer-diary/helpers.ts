import type { I18n } from "@lingui/core";

import { DEVELOPER_DIARY, type DeveloperDiaryEntry } from "../developer-diary-data";

export interface DiaryEntryView {
  changes: readonly string[];
  date: string;
  dateLabel: string;
  title: string;
}

/** Long date of an ISO day ("2026-10-18"), the same in every time zone, in the active locale. */
export const formatDiaryDate = (date: string, locale?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const toEntryView = (entry: DeveloperDiaryEntry, i18n?: I18n): DiaryEntryView => ({
  changes: entry.changes,
  date: entry.date,
  dateLabel: formatDiaryDate(entry.date, i18n?.locale),
  title: entry.title
});

/** Diary entries, newest first, prepared for the view; article text stays English. */
export const getDiaryEntryViews = (i18n?: I18n) => DEVELOPER_DIARY.map(entry => toEntryView(entry, i18n));
