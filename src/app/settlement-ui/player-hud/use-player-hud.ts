import { useLingui } from "@lingui/react";
import { type CSSProperties, useMemo, useRef } from "react";

import { useOnlineFeatures } from "../../backend/use-online-features";
import { useStoreSelector } from "../../components/use-store-selector";
import { usePlayerAvatarGender } from "../../player-avatar/use-player-avatar";
import type { SettlementUiStore } from "../ui-store";
import { getPlayerHudClassName, getPortraitStyle, getPortraitToggle, isSamePlayerHud, selectPlayerHud } from "./helpers";
import { usePortraitAnimation, usePortraitHidden, usePortraitSize } from "./use-portrait";

/** The player corner's values, the remembered portrait toggle and the animated portrait's element. */
export const usePlayerHud = (store: SettlementUiStore, hasExplorationEntry = false) => {
  const { i18n } = useLingui();
  const select = useMemo(() => (snapshot: Parameters<typeof selectPlayerHud>[0]) =>
    selectPlayerHud(snapshot, i18n), [i18n]);
  const model = useStoreSelector(store, select, isSamePlayerHud, true, i18n.locale);
  const { onTogglePortrait, portraitHidden: portraitHiddenChoice } = usePortraitHidden();
  // The level button is the portrait toggle: without it (progression off) the portrait always shows.
  const portraitHidden = portraitHiddenChoice && (model?.levelShown ?? true);
  const portraitRef = useRef<HTMLButtonElement>(null);
  const size = usePortraitSize();
  const nation = model?.nation ?? "roman";
  const avatarGender = usePlayerAvatarGender();
  const { shop: shopOffered } = useOnlineFeatures();
  usePortraitAnimation(portraitRef, portraitHidden || !model);
  return {
    className: getPlayerHudClassName(portraitHidden, hasExplorationEntry),
    model,
    portraitHidden,
    portraitRef,
    portraitStyle: useMemo(
      () => getPortraitStyle(nation, avatarGender, size) as CSSProperties,
      [avatarGender, nation, size]
    ),
    shopOffered,
    toggle: getPortraitToggle(portraitHidden, model?.experienceTotal ?? "", i18n),
    onTogglePortrait
  };
};
