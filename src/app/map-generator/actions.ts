import { reloadPage } from "../page-reload";
import { type IslandChoice,readIslandChoice, writeIslandQuery } from "./helpers";
import { generatorStorage } from "./storage";

/** Stored generator choices are overridden by the current URL, exactly as before extraction. */
export const getInitialIslandChoice = () =>
  readIslandChoice(new URLSearchParams(location.search), generatorStorage.read());

/** Generate only through the existing reload boundary; never mutate the open editor/world/history. */
export const reloadWithNewIsland = (choice: IslandChoice, seed?: number) => {
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff))
    throw new RangeError("Island seed must be a whole number from 0 to 4294967295");
  generatorStorage.write(choice);
  const query = new URLSearchParams(location.search);
  writeIslandQuery(query, choice);
  query.set("seed", String(seed ?? Math.floor(Math.random() * 1_000_000_000)));
  query.delete("map");
  query.delete("view");
  const search = query.toString();
  reloadPage(`${location.pathname}${search ? `?${search}` : ""}`);
};
