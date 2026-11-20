import type { I18n } from "@lingui/core";

import {
  PLAYER_AVATAR_GENDERS,
  type PlayerAvatarGender
} from "../../../render-common/workers/player-avatar";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { translateMessage } from "../../../shared/i18n/translate";
import { RACES } from "../../account/race-picker/helpers";
import { CUSTOMIZATION_MESSAGES as M } from "./messages";

const faces = import.meta.glob<string>("../../../../assets/ui-icons/portraits/faces/*.webp", {
  eager: true,
  import: "default",
  query: "?url"
});

/** Face images are cropped from the same rendered frame as the animated HUD sheet. */
const avatarFaceAsset = (nation: WorkerNation, gender: PlayerAvatarGender) =>
  faces[`../../../../assets/ui-icons/portraits/faces/${nation}-${gender}.webp`] ??
  faces[`../../../../assets/ui-icons/portraits/faces/roman-${gender}.webp`]!;

export interface AvatarGenderOption {
  checked: boolean;
  face: string;
  gender: PlayerAvatarGender;
  index: number;
  /** Accessible name: "Female Roman avatar". */
  label: string;
  /** Visible radio caption: "Female". */
  shortLabel: string;
  /** Only the selected radio (the first while none is selected) is in the tab order. */
  tabIndex: number;
  title: string;
}

const nationLabel = (nation: WorkerNation, i18n?: I18n) =>
  translateMessage(i18n, RACES.find(race => race.nation === nation)!.message);

/** Male/female face radios for one nation; visible labels are short, accessible names spell out the pair. */
export const getAvatarGenderOptions = (
  nation: WorkerNation,
  selected: PlayerAvatarGender | null,
  i18n?: I18n
): AvatarGenderOption[] => {
  const nativeNation = nationLabel(nation, i18n);
  return PLAYER_AVATAR_GENDERS.map((gender, index) => {
    const checked = gender === selected;
    const label = translateMessage(i18n, M.genderOption[gender], { nation: nativeNation });
    return {
      checked,
      face: avatarFaceAsset(nation, gender),
      gender,
      index,
      label,
      shortLabel: translateMessage(i18n, M.genderName[gender]),
      tabIndex: checked || (!selected && index === 0) ? 0 : -1,
      title: label
    };
  });
};
