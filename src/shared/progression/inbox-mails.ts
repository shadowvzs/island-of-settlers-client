import type { ScriptMailEffect } from "../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import type { QuestText } from "../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { ScriptMail } from "../../../../island-of-settlers-shared/src/script/types/ui";
import { type BattleMessage, validBattleMessage } from "./battle-messages";
import { MAIL_GOODS_LIMIT, MAIL_TEXT_LIMIT } from "./constants";

/** The player's inbox (trigger design §6.12): battle reports and scripted mails, newest first. */
export type InboxMail = BattleMessage | ScriptMail;

export const isScriptMail = (mail: InboxMail): mail is ScriptMail => mail.kind === "script";

const validMailText = (text: unknown): text is QuestText => {
  if (!text || typeof text !== "object" || Array.isArray(text)) return false;
  const record = text as Record<string, unknown>;
  if (typeof record.en !== "string") return false;
  return Object.entries(record).every(([key, value]) => key === "values" ||
    (typeof value === "string" && value.length <= MAIL_TEXT_LIMIT));
};

const validGoods = (attachments: unknown) => {
  if (attachments === null) return true;
  const goods = (attachments as { goods?: unknown } | undefined)?.goods;
  return Array.isArray(goods) && goods.length <= MAIL_GOODS_LIMIT && goods.every(line =>
    line && typeof line.ware === "string" && Number.isSafeInteger(line.amount) && line.amount >= 0);
};

export const validScriptMail = (value: unknown): value is ScriptMail => {
  const mail = value as Partial<ScriptMail> | null;
  return Boolean(mail) && mail!.kind === "script" && typeof mail!.id === "string" && mail!.id.startsWith("mail:") &&
    typeof mail!.island === "string" && Number.isFinite(mail!.date) && typeof mail!.read === "boolean" &&
    validMailText(mail!.title) && validMailText(mail!.body) && validGoods(mail!.attachments);
};

export const validInboxMails = (value: unknown): value is InboxMail[] => value === undefined ||
  (Array.isArray(value) && value.every(mail => validScriptMail(mail) || validBattleMessage(mail)));

/** A script `sendMail` effect as a stored, unread inbox mail of the island it was sent from. */
export const createScriptMail = (effect: ScriptMailEffect, island: string): ScriptMail => ({
  attachments: effect.attachments && { goods: effect.attachments.goods.map(line => ({ ...line })) },
  body: effect.body, date: effect.date, id: effect.id, island, kind: "script", read: false, title: effect.title
});

/** Adds mails newest first; a mail id already present is never written twice (idempotent fold). */
export const addInboxMails = (inbox: readonly InboxMail[] | undefined, mails: readonly ScriptMail[]) => {
  const current = inbox ?? [];
  const known = new Set(current.map(mail => mail.id));
  const fresh: InboxMail[] = [];
  for (const mail of mails) {
    if (known.has(mail.id)) continue;
    known.add(mail.id);
    fresh.unshift(mail);
  }
  if (fresh.length === 0) return null;
  return [...fresh, ...current];
};
