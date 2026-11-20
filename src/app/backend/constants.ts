import type { OnlineFeatures } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";

/** Today's game: every online feature is offered (also what standalone play without a server shows). */
export const ALL_ONLINE_FEATURES: OnlineFeatures = Object.freeze({
  chat: true, friends: true, guilds: true, market: true, shop: true
});

/** `/config` names the player market `trades`; the other flags share the settings' names. */
export const CONFIG_FLAG_OF: Readonly<Record<keyof OnlineFeatures, string>> = {
  chat: "chat", friends: "friends", guilds: "guilds", market: "trades", shop: "shop"
};

/** A backend that answers slower than this at startup counts as unreachable (the game starts standalone). */
export const PROBE_TIMEOUT_MS = 2500;
