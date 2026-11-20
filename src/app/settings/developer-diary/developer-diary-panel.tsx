import { useLingui } from "@lingui/react";

import { mountReactIsland } from "../../components/react-island";
import { type DiaryEntryView, getDiaryEntryViews } from "./helpers";
import { DEVELOPER_DIARY_MESSAGES } from "./messages";

interface DiaryEntryProps {
  entry: DiaryEntryView;
}
const DiaryEntry = ({ entry }: DiaryEntryProps) => (
  <article>
    <time dateTime={entry.date}>{entry.dateLabel}</time>
    <h3>{entry.title}</h3>
    <ul>
      {entry.changes.map(change => <li key={change}>{change}</li>)}
    </ul>
  </article>
);

interface DeveloperDiaryPanelProps {
  /** Prebuilt views for tests; the live panel resolves them in the active locale. */
  entries?: readonly DiaryEntryView[];
}
/** Body of the Game News window: a short intro, then every entry newest first. */
export const DeveloperDiaryPanel = (props: DeveloperDiaryPanelProps) => {
  const { i18n } = useLingui();
  const views = props.entries ?? getDiaryEntryViews(i18n);
  return (
    <>
      <p className="developer-diary__intro">{i18n._(DEVELOPER_DIARY_MESSAGES.intro)}</p>
      {views.map(entry => <DiaryEntry entry={entry} key={entry.date} />)}
    </>
  );
};

export const mountDeveloperDiaryPanel = (container: HTMLElement) =>
  mountReactIsland(container, <DeveloperDiaryPanel />);
