import type { PlayerItemId } from "../../shared/progression/player-inventory";
import { getHelmetUrl } from "../account/race-picker/helpers";
import { usePlayerAvatarSelection } from "../player-avatar/use-player-avatar";
import { ChooseNationIcon } from "./choose-nation-icon";
import { roadDecorationIconUrl } from "./road-decoration-presentation";

export const PlayerItemIcon = ({ item }:{ item:PlayerItemId }) => {
  const { nation }=usePlayerAvatarSelection();
  if (item === "chooseNation") return <ChooseNationIcon />;
  const decoration = roadDecorationIconUrl(item);
  if (decoration) return <img alt="" draggable={false} src={decoration} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
  return (
    <span aria-hidden="true" className="commander-recovery-icon">
      <img alt="" draggable={false} src={getHelmetUrl(nation)} />
      <svg focusable="false" viewBox="0 0 32 32"><path d="M16 28 4 16C-5 5 10-3 16 7 22-3 37 5 28 16Z" /></svg>
    </span>
  );
};
