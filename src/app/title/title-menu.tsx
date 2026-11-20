import { IconButton } from "../components/icon-button";
import type { TitlePageModel } from "./use-title-page";

type TitleMenuEntry = TitlePageModel["entries"][number];

interface TitleMenuProps {
  /** The administrator's links (empty for everyone else), below a divider. */
  adminEntries: TitlePageModel["adminEntries"];
  entries: TitlePageModel["entries"];
  label: string;
}

const TitleEntryButton = ({ entry }: { entry: TitleMenuEntry }) => (
  <IconButton
    caption={entry.label}
    className="title-page__entry"
    data={{ "data-title-entry": entry.id }}
    disabled={entry.disabled}
    icon={entry.icon}
    title={entry.title}
    onClick={entry.onClick}
  />
);

/**
 * The title entries as a column of icon + label buttons; a disabled entry says why in its tooltip. An
 * administrator's links use the same buttons below a divider (owner 2026-11-13).
 */
export const TitleMenu = ({ adminEntries, entries, label }: TitleMenuProps) => (
  <nav aria-label={label} className="title-page__menu">
    {entries.map(entry => <TitleEntryButton entry={entry} key={entry.id} />)}
    {adminEntries.length > 0 && <hr className="title-page__admin-divider" />}
    {adminEntries.map(entry => <TitleEntryButton entry={entry} key={entry.id} />)}
  </nav>
);
