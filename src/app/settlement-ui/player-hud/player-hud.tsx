import { useLingui } from "@lingui/react";
import type { CSSProperties, RefObject } from "react";

import { SettlementIcon } from "../../components/settlement-icon";
import { ExplorationEntry } from "../../exploration/ui/entry-button";
import { useExplorationEntryPresence } from "../../exploration/ui/use-exploration-entry";
import { HUD_MESSAGES } from "../hud/messages";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { progressionIcon } from "../player-hud-helpers";
import type { SettlementUiStore } from "../ui-store";
import type { PlayerHudModel } from "./helpers";
import { usePlayerHud } from "./use-player-hud";

interface HudImageProps {
  className: string;
  source: string;
}
const HudImage = ({ className, source }: HudImageProps) => (
  <img alt="" className={className} draggable={false} src={source} />
);

interface BadgeProps {
  hidden: boolean;
  text: string;
}
const Badge = ({ hidden, text }: BadgeProps) => (
  <span className="player-hud__quest-badge" hidden={hidden}>{text}</span>
);

interface PortraitProps {
  portraitRef: RefObject<HTMLButtonElement | null>;
  style: CSSProperties;
  onOpenQuests: () => void;
}
const Portrait = ({ portraitRef, style, onOpenQuests }: PortraitProps) => {
  const { i18n } = useLingui();
  const label = i18n._(M.hud.player.openQuests);
  return (
  <button
    aria-label={label}
    className="player-hud__portrait"
    data-ui-anchor="hud.portrait"
    ref={portraitRef}
    style={style}
    title={label}
    type="button"
    onClick={onOpenQuests}
  >
    <HudImage className="player-hud__frame" source={progressionIcon("portrait-frame")} />
  </button>
  );
};

/** A small brass padlock on the level star: a map fixes or caps the level (plan §9.4). */
const LevelLock = () => (
  <svg aria-hidden="true" className="player-hud__level-lock" viewBox="0 0 16 16">
    <defs>
      <linearGradient id="player-hud-lock-body" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#f6d47a" />
        <stop offset=".55" stopColor="#c8922e" />
        <stop offset="1" stopColor="#8a5a14" />
      </linearGradient>
      <linearGradient id="player-hud-lock-shackle" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#6d6f76" />
        <stop offset=".5" stopColor="#e3e6ec" />
        <stop offset="1" stopColor="#7c7f87" />
      </linearGradient>
    </defs>
    <path d="M4.6 7.4V5.2a3.4 3.4 0 0 1 6.8 0v2.2" fill="none" stroke="#3a2a10" strokeWidth="3" />
    <path d="M4.6 7.4V5.2a3.4 3.4 0 0 1 6.8 0v2.2" fill="none" stroke="url(#player-hud-lock-shackle)"
      strokeWidth="1.7" />
    <rect fill="url(#player-hud-lock-body)" height="7.6" rx="1.6" stroke="#3a2a10" strokeWidth=".9" width="11"
      x="2.5" y="7" />
    <path d="M3.4 8.3h9.2" stroke="#fff3c4" strokeLinecap="round" strokeOpacity=".75" strokeWidth=".7" />
    <circle cx="8" cy="10.2" fill="#3a2a10" r="1.15" />
    <path d="M8 10.4v2.2" stroke="#3a2a10" strokeLinecap="round" strokeWidth="1.1" />
  </svg>
);

interface LevelButtonProps {
  model: PlayerHudModel;
  portraitHidden: boolean;
  toggle: { label: string; title: string };
  onTogglePortrait: () => void;
}
/** The level star (compact, alone) or with the experience bar where the rules show one; the portrait toggle. */
const LevelButton = ({ model, portraitHidden, toggle, onTogglePortrait }: LevelButtonProps) => (
  <button
    aria-label={toggle.label}
    aria-pressed={portraitHidden}
    className={model.levelClassName}
    title={toggle.title}
    type="button"
    onClick={onTogglePortrait}
  >
    <span className="player-hud__level">
      <HudImage className="player-hud__star" source={progressionIcon("level-star")} />
      <b>{model.level}</b>
      {model.levelLocked && <LevelLock />}
    </span>
    {model.experienceShown && (
      <span className="player-hud__experience-body">
        <small>{model.experienceText}</small>
        <span className="player-hud__bar"><i style={{ width: model.experienceFill }} /></span>
      </span>
    )}
  </button>
);

interface GemCounterProps {
  gems: string;
  shopOffered: boolean;
  onOpenShop: () => void;
}
/** The gem count; it opens the gem shop only while this game offers the shop (else a read-only chip). */
const GemCounter = ({ gems, shopOffered, onOpenShop }: GemCounterProps) => {
  const { i18n } = useLingui();
  const label = i18n._(HUD_MESSAGES.player.gems);
  const content = (
    <>
      <HudImage className="player-hud__gem" source={progressionIcon("gem")} />
      <b>{gems}</b>
    </>
  );
  if (!shopOffered)
    return (
      <span aria-label={label} className="player-hud__gems player-hud__gems--readonly" title={label}>
        {content}
      </span>
    );
  return (
    <button
      aria-label={label}
      className="player-hud__gems"
      data-ui-anchor="hud.gemShop"
      title={label}
      type="button"
      onClick={onOpenShop}
    >
      {content}
    </button>
  );
};

interface CountersProps {
  model: PlayerHudModel;
  portraitHidden: boolean;
  shopOffered: boolean;
  toggle: { label: string; title: string };
  onOpenShop: () => void;
  onTogglePortrait: () => void;
}
const Counters = ({ model, portraitHidden, shopOffered, toggle, onOpenShop, onTogglePortrait }: CountersProps) => (
    <div className="player-hud__counters">
      {model.levelShown && (
        <LevelButton
          model={model}
          portraitHidden={portraitHidden}
          toggle={toggle}
          onTogglePortrait={onTogglePortrait}
        />
      )}
      <GemCounter gems={model.gems} shopOffered={shopOffered} onOpenShop={onOpenShop} />
      {model.populationText && (
        <span aria-label={model.populationLabel} className="player-hud__population" title={model.populationLabel}>
          <SettlementIcon name="people" />
          <b>{model.populationText}</b>
        </span>
      )}
    </div>
);

interface QuestActionsProps {
  model: PlayerHudModel;
  onOpenMessages: () => void;
  onOpenQuests: () => void;
  onOpenTalents: () => void;
}
const QuestActions = ({ model, onOpenMessages, onOpenQuests, onOpenTalents }: QuestActionsProps) => (
  <div className="player-hud__quest-actions">
    <button
      aria-label={model.questLabel}
      className={model.questClassName}
      data-ui-anchor="hud.quests"
      title={model.questLabel}
      type="button"
      onClick={onOpenQuests}
    >
      <HudImage className="player-hud__scroll" source={progressionIcon("quest-scroll")} />
      <Badge hidden={!model.questReady} text={model.questBadge} />
    </button>
    <button
      aria-label={model.inboxLabel}
      className="player-hud__quests player-hud__inbox"
      data-ui-anchor="hud.messages"
      title={model.inboxLabel}
      type="button"
      onClick={onOpenMessages}
    >
      <SettlementIcon name="notice" />
      <Badge hidden={!model.inboxUnread} text={model.inboxBadge} />
    </button>
    {model.talentsShown && (
      <button
        aria-label={model.talentLabel}
        className="player-hud__quests player-hud__talents"
        data-ui-anchor="hud.talents"
        title={model.talentLabel}
        type="button"
        onClick={onOpenTalents}
      >
        <HudImage className="player-hud__scroll" source={progressionIcon("level-star")} />
        <Badge hidden={!model.talentReady} text={model.talentBadge} />
      </button>
    )}
  </div>
);

interface PlayerHudViewProps {
  className: string;
  model: PlayerHudModel;
  portraitHidden: boolean;
  portraitRef: RefObject<HTMLButtonElement | null>;
  portraitStyle: CSSProperties;
  /** False while the game's shop switch is off: the gem count stays, its shop entry is gone. Default true. */
  shopOffered?: boolean;
  toggle: { label: string; title: string };
  onOpenMessages: () => void;
  onOpenQuests: () => void;
  onOpenShop: () => void;
  onOpenTalents: () => void;
  onTogglePortrait: () => void;
}

/**
 * Player corner: animated portrait, level star, experience bar, gems, exploration entry, quest
 * book and inbox. The exploration action is a sibling row: it never steals the portrait's quest
 * click or overlaps its level badge, and it stays beside the counters when the portrait is hidden.
 */
export const PlayerHudView = ({
  className,
  model,
  portraitHidden,
  portraitRef,
  portraitStyle,
  shopOffered = true,
  toggle,
  onOpenMessages,
  onOpenQuests,
  onOpenShop,
  onOpenTalents,
  onTogglePortrait
}: PlayerHudViewProps) => {
  const { i18n } = useLingui();
  return (
    <aside aria-label={i18n._(HUD_MESSAGES.player.label)} className={className}>
      <Portrait portraitRef={portraitRef} style={portraitStyle} onOpenQuests={onOpenQuests} />
      <Counters
        model={model}
        portraitHidden={portraitHidden}
        shopOffered={shopOffered}
        toggle={toggle}
        onOpenShop={onOpenShop}
        onTogglePortrait={onTogglePortrait}
      />
      <ExplorationEntry />
      <QuestActions
        model={model}
        onOpenMessages={onOpenMessages}
        onOpenQuests={onOpenQuests}
        onOpenTalents={onOpenTalents}
      />
    </aside>
  );
};

interface PlayerHudProps {
  store: SettlementUiStore;
  onOpenMessages: () => void;
  onOpenQuests: () => void;
  onOpenShop: () => void;
  onOpenTalents: () => void;
}

/** Connected player corner; uses the existing portrait/XP toggle owners unchanged. */
export const PlayerHud = ({ store, onOpenMessages, onOpenQuests, onOpenShop, onOpenTalents }: PlayerHudProps) => {
  const hasExplorationEntry = useExplorationEntryPresence();
  const { className, model, portraitHidden, portraitRef, portraitStyle, shopOffered, toggle, onTogglePortrait } =
    usePlayerHud(store, hasExplorationEntry);
  if (!model) return null;
  return (
    <PlayerHudView
      className={className}
      model={model}
      portraitHidden={portraitHidden}
      portraitRef={portraitRef}
      portraitStyle={portraitStyle}
      shopOffered={shopOffered}
      toggle={toggle}
      onOpenMessages={onOpenMessages}
      onOpenQuests={onOpenQuests}
      onOpenShop={onOpenShop}
      onOpenTalents={onOpenTalents}
      onTogglePortrait={onTogglePortrait}
    />
  );
};
