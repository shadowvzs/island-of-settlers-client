import { flagCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";

const ignoreGlobalWinter = definePreference(PREFERENCES.ignoreGlobalWinter, flagCodec(false));

/** Appearance preferences belong to this browser, like Detail and the day/night override. */
export const readIgnoreGlobalWinter = () => ignoreGlobalWinter.read();

export const writeIgnoreGlobalWinter = (ignore: boolean) => { ignoreGlobalWinter.write(ignore); };
