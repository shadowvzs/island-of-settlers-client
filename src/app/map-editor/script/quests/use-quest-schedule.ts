import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import type { QuestDeadline, QuestRepeat } from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import { translateMessage } from "../../../../shared/i18n/translate";
import { numberLiteral } from "../factory";
import {
  CLAIM_PREVIEW_COUNT, DAY_MS, DAYS_IN_LONGEST_MONTH, DAYS_IN_WEEK, DEADLINE_KINDS, type DeadlineChoice,
  MONTHS_IN_YEAR, REFERENCE_YEAR, REPEAT_KINDS, SUNDAY_REFERENCE_UTC
} from "./constants";
import { QUEST_MESSAGES as M } from "./messages";
import {
  clockText, deadlineChoice, deadlineOf, minuteOfDay, repeatOf, wholeNumber, withCalendarField
} from "./quest-edits";
import { formatClaimDate, nextClaimDates } from "./repeat-preview";

/** Repeat and deadline fields of the quest form and the declared home rewards (design §7.2, §13.6). */

const ISO_MINUTE_LENGTH = 16;

const range = (count: number, first = 1) => Array.from({ length: count }, (_, index) => index + first);

/** `YYYY-MM-DDTHH:MM` (UTC) ↔ ms; the date input's text is read as UTC (owner round 5 item 6). */
export const utcInputText = (ms: number) => new Date(ms).toISOString().slice(0, ISO_MINUTE_LENGTH);
export const utcInputMs = (text: string) => Date.parse(`${text}:00Z`);

/** The calendar menus with "any" first; weekday and month names in the editor language. */
const calendarOptions = (locale: string, any: string) => {
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" });
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const anyOption = { key: "", label: any };
  return {
    days: [anyOption, ...range(DAYS_IN_LONGEST_MONTH).map(day => ({ key: String(day), label: String(day) }))],
    months: [anyOption, ...range(MONTHS_IN_YEAR).map(number => ({ key: String(number),
      label: month.format(Date.UTC(REFERENCE_YEAR, number - 1, 1)) }))],
    weekdays: [anyOption, ...range(DAYS_IN_WEEK, 0).map(day => ({ key: String(day),
      label: weekday.format(SUNDAY_REFERENCE_UTC + day * DAY_MS) }))]
  };
};

const fieldText = (value: number | undefined) => (value === undefined ? "" : String(value));

/** A repeat rule's fields, the next claim dates (local time with UTC) and its edits. */
export const useRepeatFields = (repeat: QuestRepeat, onChange: (repeat: QuestRepeat) => void) => {
  const { i18n } = useLingui();
  const { locale } = i18n;
  const text = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, string>) =>
    translateMessage(i18n, descriptor, values);
  const [now] = useState(() => Date.now());
  const dates = useMemo(() => nextClaimDates(repeat, now, CLAIM_PREVIEW_COUNT), [now, repeat]);
  const options = useMemo(() => calendarOptions(locale, translateMessage(i18n, M.anyValue)), [i18n, locale]);
  const calendar = repeat.kind === "calendar" ? repeat : null;
  return {
    claimDates: dates.map(utc => text(M.claimDate, formatClaimDate(utc, locale))),
    day: fieldText(calendar?.day),
    kind: repeat.kind,
    kinds: REPEAT_KINDS.map(key => ({ key, label: text(M.repeats[key]) })),
    maxClaims: repeat.kind === "onCompletion" ? fieldText(repeat.maxClaims ?? undefined) : "",
    month: fieldText(calendar?.month),
    options,
    repeat,
    time: clockText(calendar?.minuteUtc ?? 0),
    weekday: fieldText(calendar?.weekday),
    onCalendar: (field: "day" | "month" | "weekday", value: string) => onChange(withCalendarField(repeat, field,
      value)),
    onInterval: (field: "days" | "hours" | "minutes", value: string) => {
      if (repeat.kind === "interval") onChange({ ...repeat, [field]: wholeNumber(value) });
    },
    onKind: (kind: string) => onChange(repeatOf(kind as QuestRepeat["kind"], repeat)),
    onMaxClaims: (value: string) => {
      if (repeat.kind === "onCompletion") onChange({ ...repeat, maxClaims: wholeNumber(value) || null });
    },
    onRetry: (retryAfterFail: boolean) => onChange({ ...repeat, retryAfterFail }),
    onTime: (value: string) => {
      if (repeat.kind === "calendar") onChange({ ...repeat, minuteUtc: minuteOfDay(value) });
    }
  };
};

export type RepeatFieldsView = ReturnType<typeof useRepeatFields>;

/** A deadline's kind, its numbers or date (UTC input) and its edits. */
export const useDeadlineFields = (deadline: QuestDeadline | null,
  onChange: (deadline: QuestDeadline | null) => void) => {
  const { i18n } = useLingui();
  const at = deadline?.kind === "date" && deadline.at.k === "lit" ? Number(deadline.at.value) : null;
  return {
    choice: deadlineChoice(deadline),
    choices: DEADLINE_KINDS.map(key => ({ key, label: translateMessage(i18n, M.deadlines[key]) })),
    date: at === null ? "" : utcInputText(at),
    deadline,
    onChoice: (choice: string) => onChange(deadlineOf(choice as DeadlineChoice, Date.now())),
    onDate: (value: string) => {
      const ms = utcInputMs(value);
      if (deadline?.kind === "date" && Number.isFinite(ms)) onChange({ ...deadline, at: numberLiteral(ms) });
    },
    onDelay: (field: "days" | "hours" | "minutes", value: string) => {
      if (deadline?.kind === "dateAfterActivation") onChange({ ...deadline, [field]: wholeNumber(value) });
    },
    onSeconds: (value: string) => {
      if (deadline?.kind === "playTime" || deadline?.kind === "gameTime")
        onChange({ ...deadline, seconds: Math.max(1, wholeNumber(value)) });
    }
  };
};

export type DeadlineFieldsView = ReturnType<typeof useDeadlineFields>;
