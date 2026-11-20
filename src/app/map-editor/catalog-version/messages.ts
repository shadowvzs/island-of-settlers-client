import { msg } from "@lingui/core/macro";

export const CATALOG_VERSION_MESSAGES = {
  body: msg({
    id: "mapEditor.catalogVersion.body",
    // Lingui macros need one string literal; the long source message is kept on one line.
    message: "This map was made with another version of the game content (map {mapVersion}, game {gameVersion}). Wares, buildings or decorations may have changed: check the map before you save or publish it."
  }),
  dismiss: msg({ id: "mapEditor.catalogVersion.dismiss", message: "Dismiss" }),
  title: msg({ id: "mapEditor.catalogVersion.title", message: "Content version differs" })
} as const;
