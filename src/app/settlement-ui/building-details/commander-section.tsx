import { useLingui } from "@lingui/react";

import type { CommanderRecruitAvailability, CommanderSnapshot } from "../../../shared/settlement/settlement-commander";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { RankChevrons } from "../rank-chevrons";
import { getCommanderView } from "./commander-helpers";
import { CommanderRecruitment } from "./commander-recruitment";

interface CommanderSectionProps {
  commander?: CommanderSnapshot;
  nation: string;
  recruit?: CommanderRecruitAvailability;
  uid: number;
  onLevelUp?: (uid: number) => true | string;
  onRecruit?: (uid: number, definitionId?: string) => true | string;
}

/** The Commander's Lodge: paid recruitment, level/XP, health, readiness and authorised level-up. */
export const CommanderSection = ({
  commander, nation, recruit, uid, onLevelUp, onRecruit
}: CommanderSectionProps) => {
  const { i18n } = useLingui();
  const view = getCommanderView(commander, recruit, nation, i18n);
  if (view.empty) {
    return (
      <section aria-label={i18n._(M.details.commander.aria)} className="settlement-ui__commander">
        <b>{view.heading}</b>
        <p className="settlement-ui__section-description">{i18n._(M.details.commander.empty)}</p>
        <CommanderRecruitment nation={nation} recruit={recruit} uid={uid} onRecruit={onRecruit} />
      </section>
    );
  }
  return (
    <section aria-label={i18n._(M.details.commander.aria)} className="settlement-ui__commander"
      data-commander-status={view.blockReason ?? "ready"}>
      <div className="settlement-ui__commander-heading">
        <span className="settlement-ui__soldier-portrait">
          <img alt="" draggable={false} src={view.portrait} />
          <RankChevrons level={commander!.level} />
        </span>
        <span className="settlement-ui__commander-name">
          <b>{view.name}</b>
          <small>{view.role} · {view.style} · {view.loadout}</small>
        </span>
        <span className="settlement-ui__commander-level-text">{view.levelText}</span>
      </div>
      <div aria-label={view.hpText} aria-valuemax={Math.ceil(commander!.maximumHp)}
        aria-valuemin={0} aria-valuenow={Math.ceil(commander!.hp)} className="settlement-ui__commander-health"
        role="progressbar">
        <span style={{ width: `${Math.round(view.hpFraction * 1000) / 10}%` }} />
      </div>
      <small>{view.hpText}</small>
      {view.hpRequirementText && <small className="settlement-ui__commander-warning">{view.hpRequirementText}</small>}
      <CommanderRecruitment nation={nation} recruit={recruit} uid={uid} onRecruit={onRecruit} />
      <small>{view.xpText}</small>
      <small>{view.aura}</small>
      <small>{view.deckText}</small>
      <small>{i18n._(M.details.commander.restingRate)}</small>
      <p className="settlement-ui__commander-status">{view.status}</p>
      {view.recoveryText && view.blockReason !== "recovering" &&
        <small>{view.recoveryText}</small>}
      {view.canLevelUp && onLevelUp && (
        <button
          aria-label={i18n._(M.details.commander.levelUp)}
          className="settlement-ui__button settlement-ui__commander-level-up"
          title={i18n._(M.details.commander.levelUpTitle)}
          type="button"
          onClick={() => onLevelUp(uid)}
        >
          {i18n._(M.details.commander.levelUp)}
        </button>
      )}
    </section>
  );
};
