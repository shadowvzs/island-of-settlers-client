import type { ScriptActor } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import { ScriptIconButton } from "./icon-button";
import type { ScriptWorkspace } from "./script-workspace";
import { IssueList } from "./sentence-row";
import { QuestTextFields } from "./text-language-inputs";
import { type ActorPanelView, useActorPanel } from "./use-actor-panel";
import type { ScriptDialogs } from "./use-script-dialogs";

type Card = ActorPanelView["cards"][number];

interface CardProps {
  card: Card;
  view: ActorPanelView;
}

/** A spawned actor: type (catalog picker), count, owner, spawn region (or pick on map), look, start presence. */
const SpawnFields = ({ card, view }: CardProps) => {
  const actor = card.actor as Extract<ScriptActor, { binding: "spawn" }>;
  const { labels } = view;
  return (
    <div className="script-actor__fields">
      <label>{labels.type}<button className="script-slot" type="button" onClick={() => view.onType(actor)}>
        {card.typeText}</button></label>
      <label>{labels.count}<input className="input-count" defaultValue={actor.count} key={`${actor.id}:${actor.count}`}
        min={1} type="number" onBlur={event => view.onCount(actor, event.target.value)} /></label>
      <label>{labels.place}<select value={actor.place.region.id}
        onChange={event => view.onRegion(actor, event.target.value)}>
        {view.regions.map(region => <option key={region.key} value={region.key}>{region.label}</option>)}
      </select></label>
      <ScriptIconButton icon="pickOnMap" label={labels.pickRegion} onClick={() => view.onPickRegion(actor)} />
      <label>{labels.look}<select value={JSON.stringify(actor.look)}
        onChange={event => view.onLook(actor, event.target.value)}>
        {view.looks.map(look => <option key={look.key} value={look.key}>{look.label}</option>)}
      </select></label>
      <label><input checked={actor.spawnAtStart} type="checkbox"
        onChange={event => view.onField(actor, { spawnAtStart: event.target.checked })} />{labels.spawnAtStart}</label>
    </div>
  );
};

/** A placed actor: its bound map objects (remove, add by picking on the map) and start visibility. */
const PlacedFields = ({ card, view }: CardProps) => {
  const actor = card.actor as Extract<ScriptActor, { binding: "placed" }>;
  return (
    <div className="script-actor__fields">
      <ul className="script-actor__objects">
        {card.objects.map(object => (
          <li key={object.id}>{object.label}
            <ScriptIconButton icon="delete" label={object.removeLabel}
              onClick={() => view.onRemoveObject(actor, object.id)} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => view.onAddObject(actor)}>{view.labels.addObject}</button>
      <label><input checked={actor.hiddenAtStart} type="checkbox"
        onChange={event => view.onField(actor, { hiddenAtStart: event.target.checked })} />
      {view.labels.hiddenAtStart}</label>
    </div>
  );
};

const ActorCard = ({ card, view }: CardProps) => {
  const { actor } = card;
  const { labels } = view;
  return (
    <li className="script-actor" data-selected={card.selected}>
      <div className="script-actor__head">
        <label>{labels.name}<input defaultValue={actor.name} key={`${actor.id}:${actor.name}`}
          onBlur={event => view.onField(actor, { name: event.target.value })} /></label>
        <span className="script-actor__summary">{card.summary}</span>
        <ScriptIconButton icon="delete" label={card.deleteLabel} onClick={() => view.onDelete(actor)} />
      </div>
      {actor.binding === "spawn" && <SpawnFields card={card} view={view} />}
      {actor.binding === "placed" && <PlacedFields card={card} view={view} />}
      {card.displayName && <QuestTextFields label={labels.displayName} maxLength={view.displayNameLength}
        text={card.displayName} onCommit={name => view.onDisplayName(actor, name)} />}
      <div className="script-actor__fields">
        <label>{labels.owner}<select value={card.owner} onChange={event => view.onOwner(actor, event.target.value)}>
          {view.owners.map(owner => <option key={owner.key} value={owner.key}>{owner.label}</option>)}
        </select></label>
        <label><input checked={card.clearOnGone} type="checkbox"
          onChange={event => view.onClearOnGone(actor, event.target.checked)} />{labels.clearOnGone}</label>
      </div>
      <p className="script-actor__users">{card.usedBy}</p>
      <IssueList issues={card.issues} />
    </li>
  );
};

interface ActorPanelProps {
  dialogs: ScriptDialogs;
  workspace: ScriptWorkspace;
}
/** ACT9 actor panel: create an actor from a catalog type or by picking a placed object; usage list per actor. */
export const ActorPanel = ({ dialogs, workspace }: ActorPanelProps) => {
  const view = useActorPanel(workspace, dialogs);
  return (
    <section aria-label={view.labels.title} className="script-actors">
      <p className="script-form__note">{view.labels.info}</p>
      <div className="script-list__toolbar">
        <button type="button" onClick={view.onAddSpawn}>{view.labels.addSpawn}</button>
        <button type="button" onClick={view.onBindPlaced}>{view.labels.bindPlaced}</button>
      </div>
      {!view.cards.length && <p className="script-form__note">{view.labels.empty}</p>}
      <ul className="script-actors__list">
        {view.cards.map(card => <ActorCard card={card} key={card.id} view={view} />)}
      </ul>
    </section>
  );
};
