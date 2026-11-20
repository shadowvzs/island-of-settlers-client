import { useLingui } from "@lingui/react";

import { BuildingIcon } from "../../components/building-icon";
import { Tabs } from "../../components/tabs";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import type { getBuildingRegisterCard } from "./helpers";
import { type BuildingRegisterActions, useBuildingRegister } from "./use-building-register";

type BuildingRegisterCard = ReturnType<typeof getBuildingRegisterCard>;

interface RegisterCardProps {
  card: BuildingRegisterCard;
  onVisit: (type: number) => void;
}
const RegisterCard = ({ card, onVisit }: RegisterCardProps) => {
  const { i18n } = useLingui();
  return (
  <button
    aria-label={card.label}
    className="settlement-ui__card settlement-ui__building-register-card"
    data-building-type={card.id}
    data-completed={card.built}
    data-sites={card.sites}
    disabled={card.disabled}
    title={card.title}
    type="button"
    onClick={() => onVisit(card.id)}
  >
    <BuildingIcon type={card.id} />
    <span>{card.name}</span>
    <span className="settlement-ui__building-register-counts">
      <b title={i18n._(M.register.built)}>{card.built}</b>
      <small title={i18n._(M.register.underConstruction)}>{card.sites}</small>
    </span>
  </button>
  );
};

interface BuildingRegisterGroupView {
  cards: readonly BuildingRegisterCard[];
  id: string;
  label: string;
}
interface BuildingRegisterViewProps {
  groups: readonly BuildingRegisterGroupView[];
  onVisit: (type: number) => void;
}
const BuildingRegisterView = ({ groups, onVisit }: BuildingRegisterViewProps) => {
  const { i18n } = useLingui();
  return (
  <>
    <p className="settlement-ui__section-description">{i18n._(M.register.description)}</p>
    <Tabs
      idPrefix="settlement-building-register"
      items={groups.map(group => ({
        content: (
          <div aria-label={group.label} className="settlement-ui__building-register-grid">
            {group.cards.map(card => <RegisterCard card={card} key={card.id} onVisit={onVisit} />)}
          </div>
        ),
        id: group.id,
        label: group.label
      }))}
      label={i18n._(M.register.overview)}
      listClassName="settlement-ui__tabs settlement-ui__building-register-tabs"
      panelClassName="settlement-ui__building-register-panel"
      tabClassName="settlement-ui__tab"
    />
  </>
  );
};

interface BuildingRegisterProps {
  actions: BuildingRegisterActions;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** Building overview: built and under-construction counts per type, in build menu order. */
export const BuildingRegister = ({ actions, store, visibility }: BuildingRegisterProps) => (
  <BuildingRegisterView {...useBuildingRegister(store, visibility, actions)} />
);
