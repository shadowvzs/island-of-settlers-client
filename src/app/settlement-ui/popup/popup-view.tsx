import { useLingui } from "@lingui/react";

import { BuildingIcon } from "../../components/building-icon";
import { IconButton } from "../../components/icon-button";
import { Popup } from "../../components/popup";
import { ArtImage } from "../art-image";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { RewardIcons } from "../reward-icons/reward-icons";
import { type getPopupView, POPUP_TITLE_ID, type PopupActionButton } from "./helpers";

interface PopupActionProps {
  action: PopupActionButton;
  onSelect: () => void;
}
const PopupAction = ({ action, onSelect }: PopupActionProps) => {
  if (!action.icon) {
    return <button className={action.textClassName} type="button" onClick={onSelect}>{action.label}</button>;
  }
  return (
    <IconButton
      caption={action.caption}
      className={action.className}
      icon={action.icon}
      label={action.label}
      onClick={onSelect}
    />
  );
};

interface BuildingRowProps {
  buildings: ReturnType<typeof getPopupView>["buildings"];
}
const BuildingRow = ({ buildings }: BuildingRowProps) => {
  const { i18n } = useLingui();
  return (
  <ul aria-label={i18n._(M.popup.newBuildings)} className="settlement-popup__buildings">
    {buildings.map(building => (
      <li className="settlement-popup__building" key={building.type}>
        <BuildingIcon type={building.type} />
        <span>{building.label}</span>
      </li>
    ))}
  </ul>
  );
};

interface PopupViewProps {
  revision: number;
  view: ReturnType<typeof getPopupView>;
  onAction: (index: number) => void;
}
/** Result / confirmation card: art, title, message, rewards and the actions (the first takes focus). */
export const PopupView = ({ revision, view, onAction }: PopupViewProps) => (
  <Popup
    actions={view.actions.map((action, index) => (
      <PopupAction action={action} key={action.key} onSelect={() => onAction(index)} />
    ))}
    className={view.className}
    focusKey={revision}
    labelledBy={POPUP_TITLE_ID}
    tone={view.tone}
  >
    {view.art && <ArtImage art={view.art} />}
    <h2 id={POPUP_TITLE_ID}>{view.title}</h2>
    <p>{view.message}</p>
    {view.rewards && <RewardIcons view={view.rewards} />}
    {view.buildings.length > 0 && <BuildingRow buildings={view.buildings} />}
  </Popup>
);
