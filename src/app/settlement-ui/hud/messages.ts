import { msg } from "@lingui/core/macro";

/** Always-visible HUD shell copy: launchers and the player corner. */
export const HUD_MESSAGES = {
  launcher: {
    build: msg({ id: "hud.launcher.build", message: "Build" }),
    buildBlocked: msg({
      id: "hud.launcher.buildBlocked",
      message: "Conquer this colony to unlock building"
    }),
    map: msg({ id: "hud.launcher.map", message: "Map" }),
    menu: msg({ id: "hud.launcher.menu", message: "Menu" }),
    news: msg({ id: "hud.launcher.news", message: "News" }),
    notifications: msg({ id: "hud.launcher.notifications", message: "Notifications ({count})" }),
    support: msg({ id: "hud.launcher.support", message: "Support" })
  },
  nav: {
    label: msg({ id: "hud.nav.label", message: "Settlement controls" })
  },
  placement: {
    cancel: msg({ id: "hud.placement.cancel", message: "Cancel" }),
    cancelLabel: msg({
      id: "hud.placement.cancelLabel",
      message: "Cancel placement or road tool"
    }),
    rotate: msg({ id: "hud.placement.rotate", message: "Rotate" }),
    rotateLabel: msg({
      id: "hud.placement.rotateLabel",
      message: "Rotate selected building"
    })
  },
  player: {
    gems: msg({ id: "hud.player.gems", message: "Gems: open the gem shop" }),
    inbox: msg({ id: "hud.player.inbox", message: "Messages" }),
    inboxUnread: msg({ id: "hud.player.inboxUnread", message: "Messages: {count} unread" }),
    label: msg({ id: "hud.player.label", message: "Player" }),
    portrait: {
      hide: msg({ id: "hud.player.portrait.hide", message: "Hide portrait" }),
      hideTitle: msg({
        id: "hud.player.portrait.hideTitle",
        message: "{experience} · click to hide the portrait"
      }),
      show: msg({ id: "hud.player.portrait.show", message: "Show portrait" }),
      showTitle: msg({
        id: "hud.player.portrait.showTitle",
        message: "{experience} · click to show the portrait"
      })
    }
  }
} as const;
