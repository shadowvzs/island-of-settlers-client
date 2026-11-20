import { useLingui } from "@lingui/react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { displayNationName, translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { type CommanderDefinition, type CommanderRecruitAvailability, commanderRecruitCatalog } from "../../../shared/settlement/settlement-commander";
import { IconButton } from "../../components/icon-button";
import { WindowFrame } from "../../components/window/window-frame";
import { commanderPortrait } from "../../settlement/army-icons";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { RankChevrons } from "../rank-chevrons";
import { commanderAuraText, commanderLoadoutText, commanderRoleText, commanderStyleText, getCommanderView } from "./commander-helpers";

import "./commander-recruitment.css";

interface Props {
  nation: string;
  recruit?: CommanderRecruitAvailability;
  uid: number;
  onRecruit?: (uid: number, definitionId?: string) => true | string;
}

/** The selected catalog entry: national identity, fixed role/gear/aura and its own live price. */
export const CommanderRecruitDetails = ({ definition, nation, recruit }: {
  definition: CommanderDefinition; nation: string; recruit: CommanderRecruitAvailability;
}) => {
  const { i18n } = useLingui();
  const view = getCommanderView(undefined, recruit, nation, i18n);
  return (
    <section className="commander-selector__detail" data-commander-definition={definition.id}>
      <h3>{displayNationName(nation, i18n)} · {i18n._(M.details.commander.heading)}</h3>
      <p>{commanderRoleText({ definition }, i18n)} · {commanderStyleText({ definition }, i18n)} · {commanderLoadoutText({ definition }, i18n)}</p>
      <p>{commanderAuraText({ aura: definition.aura }, i18n)}</p>
      <div aria-label={i18n._(M.details.commander.recruitCost)} className="settlement-ui__commander-cost" role="group">
        {view.costRows.map(row => (
          <span className="settlement-ui__commander-cost-row" data-ware={row.ware} key={row.ware}>
            <img alt="" draggable={false} src={row.icon} /><span>{row.name}</span>
            <output aria-label={row.label}>{row.count}</output>
          </span>
        ))}
      </div>
      <small>{i18n._(M.details.commander.recruitRequirement)}</small>
      <small>{view.idleSettlers}</small>
      {view.missingText && <p className="settlement-ui__commander-warning">{view.missingText}</p>}
      {view.reason && <p className="settlement-ui__commander-warning">{view.reason}</p>}
    </section>
  );
};

/** The Lodge's icon opens a fresh catalog selection; goods are paid only inside the window. */
export const CommanderRecruitment = ({ nation, onRecruit, recruit, uid }: Props) => {
  const { i18n } = useLingui();
  const titleId = useId();
  const catalog = commanderRecruitCatalog(nation as WorkerNation) ?? [];
  const [selectedId, select] = useState(catalog[0]?.id);
  const [visible, show] = useState(false);
  const [opened, setOpened] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const selected = catalog.find(definition => definition.id === selectedId) ?? catalog[0];
  const owned = Boolean(recruit?.hasCommander || recruit?.canRecruitMore === false);
  const blocked = !recruit || !catalog.length || owned;
  const choice = selected && recruit && (recruit.choices?.find(entry => entry.definitionId === selected.id) ??
    { ...recruit, cost: selected.recruitCost });
  useEffect(() => {
    if (!visible) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); show(false); }
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [visible]);
  let tooltip = i18n._(M.details.commander.recruit);
  if (blocked && recruit?.reason) tooltip = translateDomainText(recruit.reason, i18n);
  const confirm = () => {
    if (!selected || !choice?.available) return;
    const result = onRecruit?.(uid, selected.id);
    if (result === true) show(false);
    else if (typeof result === "string") setError(translateDomainText(result, i18n));
  };
  return <>
    <IconButton className="settlement-ui__commander-open-selector" disabled={blocked} hasPopup="dialog"
      icon="handshake" label={i18n._(M.details.commander.recruit)}
      title={tooltip}
      onClick={() => { select(catalog[0]?.id); setError(null); show(true); setOpened(value => value + 1); }} />
    {visible && selected && choice && createPortal(
      <div className="settlement-ui commander-selector-layer" onPointerDown={event => event.stopPropagation()}>
        <WindowFrame className="commander-selector-window" name={i18n._(M.details.commander.selector)}
          opened={opened} title={i18n._(M.details.commander.selector)} titleId={titleId} visible
          onClose={() => show(false)}>
          <div className="commander-selector__content">
            <div aria-label={i18n._(M.details.commander.selector)} className="commander-selector__choices" role="radiogroup">
              {catalog.map(definition => <button aria-checked={definition.id === selected.id}
                aria-label={`${displayNationName(nation, i18n)} · ${commanderRoleText({ definition }, i18n)} · ${translateMessage(i18n, M.details.commander.level, { level: 1 })}`}
                className="settlement-ui__button commander-selector__option" data-commander-choice={definition.id}
                key={definition.id} role="radio" type="button" onClick={() => { select(definition.id); setError(null); }}>
                <span className="settlement-ui__soldier-portrait"><img alt="" draggable={false} src={commanderPortrait(definition.icon)} />
                  <RankChevrons level={1} /></span>
              </button>)}
            </div>
            <CommanderRecruitDetails definition={selected} nation={nation} recruit={choice} />
            {error && <p role="alert">{error}</p>}
            <button className="settlement-ui__button settlement-ui__commander-recruit" disabled={!choice.available || !onRecruit}
              type="button" onClick={confirm}>{i18n._(M.details.commander.recruit)}</button>
          </div>
        </WindowFrame>
      </div>, document.body)}
  </>;
};
