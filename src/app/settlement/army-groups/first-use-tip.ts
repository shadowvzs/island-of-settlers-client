import { flagCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";

const tipSeen = definePreference(PREFERENCES.armyControlsTip, flagCodec(false));

/**
 * The soldier-controls tip (military controls §11): shown once per browser profile, the first time soldiers
 * are selected. Storage may refuse the write; the tip then still shows only once in this session.
 */
export const createArmyFirstUseTip = (
  show: () => void, preference: Pick<typeof tipSeen, "read" | "write"> = tipSeen
) => {
  let seen = preference.read();
  return (selectedCount: number) => {
    if (seen || selectedCount === 0) return;
    seen = true;
    preference.write(true);
    show();
  };
};
