import { useSetting } from "../../components/use-setting";
import { SETTINGS_MESSAGES } from "./messages";

export interface WorldSettingsOptions {
  critters: boolean;
  fog: boolean;
  /** True while the game's rules switch fog of war off (GS4a): the display option shows off and locked. */
  fogLocked?: () => boolean;
  setCritters: (enabled: boolean) => void;
  setFog: (visible: boolean) => void;
}

export const useWorldSettings = ({ critters, fog, fogLocked, setCritters, setFog }: WorldSettingsOptions) => {
  const [crittersShown, onCrittersChange] = useSetting(critters, setCritters);
  const [fogShown, onFogChange] = useSetting(fog, setFog);
  const locked = fogLocked?.() ?? false;
  return { critters: crittersShown, fog: fogShown && !locked, fogLocked: locked, fogTitle: fogTitle(locked),
    onCrittersChange, onFogChange };
};

/** The fog option's hint: the game's lock reason while locked, else what the display option does. */
const fogTitle = (locked: boolean) => {
  if (locked) return SETTINGS_MESSAGES.world.fogLocked;
  return SETTINGS_MESSAGES.world.fogTitle;
};

