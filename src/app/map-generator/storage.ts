import { parsedCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference } from "../preferences/registry";
import { formatIslandChoice, type IslandChoice, parseIslandChoice, withoutColonyTier } from "./helpers";

/** A colony tier is dropped both ways (see below). */
const islandPreference = definePreference(PREFERENCES.generatorIsland, parsedCodec(
  raw => withoutColonyTier(parseIslandChoice(raw)),
  (choice: IslandChoice) => formatIslandChoice(withoutColonyTier(choice))
));

/**
 * Retains the existing preference key and query-string format; no map/save state is stored here. A colony
 * tier is never remembered: a later plain game must not reopen as an unfinished colony draft.
 */
export const generatorStorage = {
  read: () => islandPreference.read(),
  /** A blocked preference store must not prevent generation. */
  write: (choice: IslandChoice) => { islandPreference.write(choice); }
};
