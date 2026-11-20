import { ScriptIconButton } from "../icon-button";
import type { ScriptWorkspace } from "../script-workspace";
import { IssueList } from "../sentence-row";
import type { ScriptDialogs } from "../use-script-dialogs";
import { RewardLine } from "./reward-line";
import { RepeatFields } from "./schedule-fields";
import { type HomeRewardsView, useHomeRewards } from "./use-home-rewards";

type Card = HomeRewardsView["cards"][number];

interface CardProps {
  card: Card;
  view: HomeRewardsView;
}
/** One declared home reward: name, how often it is paid, its rewards, users and issues. */
const HomeRewardCard = ({ card, view }: CardProps) => {
  const { labels } = view;
  const { occurrence } = card.reward;
  return (
    <li className="script-variable" data-reward={card.id}>
      <div className="script-variable__head">
        <label>{labels.name}<input defaultValue={card.reward.name} key={`${card.id}:${card.reward.name}`}
          onBlur={event => view.onName(card.id, event.target.value)} /></label>
        <label>{labels.occurrence}<select value={occurrence.kind}
          onChange={event => view.onOccurrence(card.id, event.target.value)}>
          {view.occurrences.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        {occurrence.kind === "counter" && (
          <label>{labels.maxOccurrences}<input className="input-count" defaultValue={occurrence.maxOccurrences}
            key={occurrence.maxOccurrences} min={1} type="number"
            onBlur={event => view.onMaxOccurrences(card.id, event.target.value)} /></label>
        )}
        <ScriptIconButton className="script-variable__delete" icon="delete" label={card.deleteLabel}
          onClick={() => view.onDelete(card.reward)} />
      </div>
      {occurrence.kind === "window" && <RepeatFields repeat={occurrence.repeat} retry={false}
        onChange={repeat => view.onWindow(card.id, repeat)} />}
      <RewardLine editLabel={labels.edit} line={card.line} nothing={labels.nothing} />
      <p className="script-actor__users">{card.usedBy}</p>
      <IssueList issues={card.issues} />
    </li>
  );
};

interface HomeRewardsSectionProps {
  dialogs: ScriptDialogs;
  workspace: ScriptWorkspace;
}
/** "Home rewards triggers may grant" (design §4.14): the declared list under the quests. */
export const HomeRewardsSection = ({ dialogs, workspace }: HomeRewardsSectionProps) => {
  const view = useHomeRewards(workspace, dialogs);
  return (
    <details className="script-quest__declared">
      <summary>{view.labels.title} ({view.cards.length})</summary>
      <p className="script-form__note">{view.labels.info}</p>
      {view.modeNote && <p className="script-form__note" role="note">{view.modeNote}</p>}
      <ul className="script-variables__list">
        {view.cards.map(card => <HomeRewardCard card={card} key={card.id} view={view} />)}
      </ul>
      <button className="script-form__add" type="button" onClick={view.onAdd}>{view.labels.add}</button>
    </details>
  );
};
