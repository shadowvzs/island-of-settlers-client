import {
  CREDIT_CATEGORIES,
  CREDIT_LICENCES,
  type CreditCategory,
  type CreditEntry,
  describeLicence,
  GAME_CREATOR,
  GAME_TITLE,
  getAttributionText,
  requiresAttribution
} from "../../src/app/settings/credits-data";

/** CREDITS.md rendered from the in-game credits data, so the file and the window never drift. */
const HEADER = [
  "# Credits",
  "",
  "<!-- Generated from src/app/settings/credits-data.ts by `npm run credits`; do not edit by hand. -->",
  "",
  `${GAME_TITLE} by **${GAME_CREATOR.name}** (${GAME_CREATOR.role.toLowerCase()}). The same list is`,
  "shown in the game under Settings > About > Credits. Licence and processing notes per asset:",
  "`../docs/reference/asset-credits.md` and each `assets/models/**/LICENSE.txt`.",
  ""
];

const TABLE_HEAD = ["| Title | Author | Licence | Source | Used for |", "| --- | --- | --- | --- | --- |"];

const escapeCell = (text: string) => text.replaceAll("|", "\\|");

const link = (text: string, url: string | undefined) => (url ? `[${text}](${url})` : text);

const formatLicence = (entry: CreditEntry) =>
  link(describeLicence(entry), CREDIT_LICENCES[entry.licence].url);

const formatRow = (entry: CreditEntry) => {
  const cells = [
    entry.title,
    link(entry.author, entry.authorUrl),
    formatLicence(entry),
    entry.sourceUrl ?? "",
    entry.usedFor
  ];
  return `| ${cells.map(escapeCell).join(" | ")} |`;
};

const formatAttributions = (entries: readonly CreditEntry[]) => {
  const attributed = entries.filter(requiresAttribution);
  if (!attributed.length) return [];
  return ["", "Required attributions:", "", ...attributed.map((entry) => `- ${getAttributionText(entry)}`)];
};

const formatCategory = (category: CreditCategory) => [
  `## ${category.title}`,
  "",
  ...(category.note ? [category.note, ""] : []),
  ...TABLE_HEAD,
  ...category.entries.map(formatRow),
  ...formatAttributions(category.entries),
  ""
];

export const renderCreditsMarkdown = () =>
  [...HEADER, ...CREDIT_CATEGORIES.flatMap(formatCategory)].join("\n");
