import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { SettlementIcon } from "../../components/settlement-icon";
import { Tabs } from "../../components/tabs";
import type { SettlementHudActions } from "../hud/types";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiStore } from "../ui-store";
import type { BuildToolRow, HomeSandboxButton, RoadCard } from "./build-helpers";
import { BuildingCardButton } from "./building-card";
import type { MainPanelVisibilityStore } from "./main-panel";
import { getRoadPreviewSource } from "./road-previews";
import { useBuildView } from "./use-build-view";

interface BuildToolButtonProps {
  row: BuildToolRow;
  onTool: (id: BuildToolRow["id"]) => void;
}
const BuildToolButton = ({ row, onTool }: BuildToolButtonProps) => (
  <button
    aria-label={row.label}
    aria-pressed={row.pressed}
    className="settlement-ui__card"
    title={row.title}
    type="button"
    onClick={() => onTool(row.id)}
  >
    {row.icon && <SettlementIcon name={row.icon} />}
    {row.caption && <span className="settlement-ui__build-card-name">{row.caption}</span>}
  </button>
);

interface RoadCardButtonProps {
  card: RoadCard;
  onTool: (id: BuildToolRow["id"]) => void;
}
const RoadCardButton = ({ card, onTool }: RoadCardButtonProps) => (
  <button
    aria-disabled={card.locked}
    aria-label={card.label}
    aria-pressed={card.pressed}
    className={card.className}
    data-road={card.id}
    title={card.title}
    type="button"
    onClick={() => onTool(card.id)}
  >
    <img alt="" decoding="sync" draggable={false} loading="lazy" src={getRoadPreviewSource(card.id)} />
    <span className="settlement-ui__build-card-name">{card.label}</span>
    <small>{card.speed}</small>
    {card.lockText && <span className="settlement-ui__card-lock">{card.lockText}</span>}
  </button>
);

interface HomeSandboxToggleProps {
  button: HomeSandboxButton;
  onToggle: () => void;
}
/** The home island's compact sandbox switch (pressed = every building and level open, no penalty). */
const HomeSandboxToggle = ({ button, onToggle }: HomeSandboxToggleProps) => (
  <IconButton
    className="settlement-ui__home-sandbox"
    icon="build"
    label={button.label}
    pressed={button.pressed}
    title={button.title}
    onClick={onToggle}
  />
);

type BuildViewProps = Pick<SettlementHudActions,
  "canSurvey" | "onHomeSandbox" | "onPickBuilding" | "onRoadTool" | "onSurveyJob"> & {
  panel: MainPanelVisibilityStore;
  store: SettlementUiStore;
};
/** Build view: road and survey tools, building categories with their cards, the selection line. */
export const BuildView = ({
  canSurvey, panel, store, onHomeSandbox, onPickBuilding, onRoadTool, onSurveyJob
}: BuildViewProps) => {
  const { i18n } = useLingui();
  const { detail, groups, homeSandbox, roads, tabIndex, tabsKey, tools, onHomeSandbox: onToggleSandbox, onPickCard,
    onTool } = useBuildView(store, panel, { canSurvey, onHomeSandbox, onPickBuilding, onRoadTool, onSurveyJob });
  return (
    <>
      <Tabs
        anchorPrefix="build.tab"
        idPrefix="settlement-buildings"
        initialIndex={tabIndex}
        items={[{ content: <>
          {roads.map(card => <RoadCardButton card={card} key={card.id} onTool={onTool} />)}
          {tools.map(row => <BuildToolButton key={row.id} row={row} onTool={onTool} />)}
        </>,
          id: "roads", label: i18n._(M.build.roads) }, ...groups.map(group => ({
          content: group.cards.map(card => (
            <BuildingCardButton card={card} key={card.id} onPickCard={onPickCard} />
          )),
          id: group.id,
          label: group.name
        }))]}
        key={tabsKey}
        label={i18n._(M.build.categories)}
        listClassName="settlement-ui__tabs"
        panelClassName="settlement-ui__cards"
        tabClassName="settlement-ui__tab"
      />
      <div className="settlement-ui__build-footer">
        <p className="settlement-ui__selection-detail">{detail}</p>
        {homeSandbox && <HomeSandboxToggle button={homeSandbox} onToggle={onToggleSandbox} />}
      </div>
    </>
  );
};
