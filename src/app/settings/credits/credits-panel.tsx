import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { mountReactIsland } from "../../components/react-island";
import { GAME_CREATOR, GAME_TITLE } from "../credits-data";
import {
  type CreditCategoryView,
  type CreditEntryView,
  type CreditLicenceLinkView,
  type CreditLinkView,
  getCreditCategoryViews,
  getMusicLicenceLinks
} from "./helpers";
import { CREDITS_MESSAGES } from "./messages";

interface ExternalLinkProps {
  className: string;
  href: string;
  text: string;
}
/** Opens a new tab without giving the page access to the game. */
const ExternalLink = ({ className, href, text }: ExternalLinkProps) => (
  <a className={className} href={href} rel="noopener noreferrer" target="_blank">{text}</a>
);

const OptionalLink = ({ className, href, text }: CreditLinkView) => {
  if (!href) return <span className={className}>{text}</span>;
  return <ExternalLink className={className} href={href} text={text} />;
};

const CreatorBlock = () => {
  const { i18n } = useLingui();
  return (
    <section aria-label={i18n._(CREDITS_MESSAGES.creator)} className="credits-window__creator">
      <p className="credits-window__game">{GAME_TITLE}</p>
      <p className="credits-window__creator-name">{GAME_CREATOR.name}</p>
      <p className="credits-window__creator-role">{i18n._(CREDITS_MESSAGES.creatorRole)}</p>
    </section>
  );
};

interface MusicLicencesProps {
  links: readonly CreditLicenceLinkView[];
}
const MusicLicences = ({ links }: MusicLicencesProps) => {
  const { i18n } = useLingui();
  const heading = i18n._(CREDITS_MESSAGES.music.heading);
  return (
    <section aria-label={heading} className="credits-window__category">
      <h3 className="credits-window__heading">{heading}</h3>
      <p className="credits-window__note">{i18n._(CREDITS_MESSAGES.music.note)}</p>
      <ul className="credits-window__list">
        {links.map(link => (
          <li key={link.label}><ExternalLink className="credits-window__link" href={link.href} text={link.label} /></li>
        ))}
      </ul>
    </section>
  );
};

interface CreditEntryProps {
  entry: CreditEntryView;
}
const CreditEntryItem = ({ entry }: CreditEntryProps) => {
  const { i18n } = useLingui();
  const byline = translateMessage(i18n, CREDITS_MESSAGES.byAuthor, { author: entry.author.text });
  return (
    <li className="credits-entry">
      <div className="credits-entry__head">
        <OptionalLink {...entry.title} />
        <OptionalLink {...entry.licence} />
      </div>
      <p className="credits-entry__author"><OptionalLink {...entry.author} text={byline} /></p>
      <p className="credits-entry__use">{entry.usedFor}</p>
      {entry.attribution && <p className="credits-entry__attribution">{entry.attribution}</p>}
    </li>
  );
};

interface CreditCategoryProps {
  category: CreditCategoryView;
}
const CreditCategorySection = ({ category }: CreditCategoryProps) => (
  <section aria-labelledby={category.headingId} className="credits-window__category">
    <h3 className="credits-window__heading" id={category.headingId}>{category.title}</h3>
    {category.note && <p className="credits-window__note">{category.note}</p>}
    <ul className="credits-window__list">
      {category.entries.map(entry => <CreditEntryItem entry={entry} key={entry.key} />)}
    </ul>
  </section>
);

interface CreditsPanelProps {
  /** Prebuilt views for tests and previews; the live panel resolves them in the active locale. */
  categories?: readonly CreditCategoryView[];
  musicLinks?: readonly CreditLicenceLinkView[];
}
/** Body of the Credits window: creator, music licences, then every credits group. */
export const CreditsPanel = (props: CreditsPanelProps) => {
  const { i18n } = useLingui();
  const categoryViews = props.categories ?? getCreditCategoryViews(i18n);
  const links = props.musicLinks ?? getMusicLicenceLinks(i18n);
  return (
    <>
      <CreatorBlock />
      <MusicLicences links={links} />
      {categoryViews.map(category => <CreditCategorySection category={category} key={category.id} />)}
    </>
  );
};

export const mountCreditsPanel = (container: HTMLElement) => mountReactIsland(container, <CreditsPanel />);
