import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";

import { PLAYER_AVATAR_GENDERS, type PlayerAvatarGender } from "../../../render-common/workers/player-avatar";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { getNextRovingIndex } from "../../components/helpers";
import { setPlayerAvatarGender } from "../../player-avatar/store";
import { usePlayerAvatarSelection } from "../../player-avatar/use-player-avatar";
import { getAvatarGenderOptions } from "./helpers";
import { CUSTOMIZATION_MESSAGES as M } from "./messages";

/** Face-radio state: selection, account-save status and roving keyboard focus. */
export const useAvatarGender = (nation: WorkerNation) => {
  const { i18n } = useLingui();
  const { gender } = usePlayerAvatarSelection();
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<MessageDescriptor | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const options = useMemo(() => getAvatarGenderOptions(nation, gender, i18n), [gender, i18n, nation]);
  const choose = (next: PlayerAvatarGender) => {

    if (next === gender || changing) return;
    setChanging(true);
    setMessage(null);
    void setPlayerAvatarGender(next)
      .then(result => {
        if (result === "failed") setMessage(M.localOnly);
        return undefined;
      })
      .catch(() => setMessage(M.localOnly))
      .finally(() => setChanging(false));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = getNextRovingIndex(event.key, index, PLAYER_AVATAR_GENDERS.length);
    if (next === null) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    choose(PLAYER_AVATAR_GENDERS[next]!);
  };
  const registerButton = (index: number) => (button: HTMLButtonElement | null) => {
    buttons.current[index] = button;
  };
  return { changing, choose, message, onKeyDown, options, registerButton, selected: gender };
};
