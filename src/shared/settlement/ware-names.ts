import { wareEntry } from "@shared/catalog";

import { translateMessage } from "../i18n/translate";

/**
 * English ware display names and count forms, read from the shared content catalog (`text.name.en`,
 * `text.plural.en`). Deliberately Lingui-free at runtime: it is part of the server replay bundle
 * (guarded by tests/server-bundle-imports.test.ts); `translate.ts` imports Lingui types only.
 */
const capitalize = (ware: string) => ware.length ? ware[0]!.toUpperCase() + ware.slice(1) : ware;

/** Display name of a ware whose id is not its name; unknown save ids keep the old humanized form. */
export const wareDisplayName = (ware: string) => wareEntry(ware)?.text.name.en ?? capitalize(ware);

/** Regular English plural of an unknown save id: "Sword" → "Swords", "Box" → "Boxes", "Ruby" → "Rubies". */
const pluralize = (noun: string) => {
  if (/(s|sh|ch|x|z)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
};

/**
 * The ware's name for a count: "Sword" / "Swords", "Armor set" / "Armor sets", "Stone" for any count. Countable
 * wares carry an ICU plural; mass nouns and names that are already plural have none.
 */
export const wareNameForCount = (ware: string, count: number) => {
  const entry = wareEntry(ware);
  const plural = entry?.text.plural;
  if (plural) return translateMessage(undefined, { id: plural.key, message: plural.en }, { count });
  if (entry || count === 1) return wareDisplayName(ware);
  return pluralize(wareDisplayName(ware));
};
