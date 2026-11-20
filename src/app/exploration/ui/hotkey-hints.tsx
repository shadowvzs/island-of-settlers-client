import { useLingui } from "@lingui/react";

import { getCommanderHintRows, HINTS_LABEL } from "../../commander-control/shortcut-hints";
import { useExternalStore } from "../../components/external-store";
import { type CommanderHotkeyAction, formatHotkeyCode, type HotkeyAction, type HotkeyBindings, hotkeySettings } from "../../settings/hotkeys/bindings";
import { hotkeyHintVisibility } from "../../settings/hotkeys/hint-visibility";
import { HOTKEY_MESSAGES } from "../../settings/hotkeys/messages";
import { explorationInputPolicy, type ExplorationPhase } from "../contracts";
import type { ExplorationOverlayView } from "./view-model";

type HintAction = Exclude<HotkeyAction,
  CommanderHotkeyAction|`army${string}`|"buildingNames"|"cameraRotateLeft"|"cameraRotateRight"|"cinematic"|"back"|
  "hideHud"|"toggleHotkeys">;
export const possessedHintKeys = (
  bindings:HotkeyBindings, spyglass:boolean, actorType = "Scout", phase:ExplorationPhase = "possessed"
) => {
  const policy=explorationInputPolicy(phase,actorType);
  const allowed=(action:HintAction)=>{
    if (action === "possessedJump") return policy.jump;
    return policy[action];
  };
  const enabled = (actions:readonly HintAction[]) => actions.filter(allowed).map(action=>bindings[action]).filter(Boolean);
  const zoom:string[] = [];
  if (spyglass) zoom.push(...enabled(["zoomIn","zoomOut"]));
  return {
    movement:enabled(["forward","backward","turnLeft","turnRight"]),
    jump:enabled(["possessedJump"]),spyglass:enabled(["spyglass"]),zoom,
    fullscreen:enabled(["fullscreen"]),back:[...new Set([bindings.back,"Escape"])].filter(Boolean)
  };
};

export const ExplorationHotkeyHints = ({ view, escapeLabel }:{ view:ExplorationOverlayView;escapeLabel:string }) => {
  const { i18n } = useLingui();
  const bindings=useExternalStore(hotkeySettings);
  const visible=useExternalStore(hotkeyHintVisibility);
  const keys=possessedHintKeys(bindings,view.spyglassPressed,view.actorType,view.phase);
  let toggleKey="";
  if (explorationInputPolicy(view.phase,view.actorType).toggleHotkeys) toggleKey=bindings.toggleHotkeys;
  const rows=[
    { id:"movement",keys:keys.movement,label:view.joystickLabel },
    { id:"jump",keys:keys.jump,label:i18n._(HOTKEY_MESSAGES.actions.possessedJump) },
    { id:"spyglass",keys:keys.spyglass,label:view.spyglassLabel },
    { id:"zoom",keys:keys.zoom,label:view.spyglassZoomLabel },
    ...getCommanderHintRows(bindings,view.actorType,i18n),
    { id:"fullscreen",keys:keys.fullscreen,label:view.fullscreenLabel },
    { id:"back",keys:keys.back,label:escapeLabel },
    { id:"toggleHotkeys",keys:[toggleKey],label:i18n._(HINTS_LABEL) }
  ].filter(row=>row.keys.some(Boolean));
  if (!visible) return null;
  let className="exploration-ui__keys";
  if (view.actorType === "commander") className += " exploration-ui__keys--commander";
  return (
    <div aria-hidden="true" className={className}>
      {rows.map(row=>(
        <div className="exploration-ui__keys-row" key={row.id}>
          {row.keys.filter(Boolean).map(code=><kbd key={code}>{formatHotkeyCode(code)}</kbd>)}
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
};
