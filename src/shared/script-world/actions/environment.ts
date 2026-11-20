import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import { HOURS_PER_DAY } from "../../environment/constants";
import type { WeatherState } from "../../environment/weather-states";
import { numberArg, type ScriptActionHost, scriptTickOf, stringArg } from "./action-host";
import { SCRIPT_WEATHER } from "./constants";

/**
 * The world environment actions (trigger design §5.2.4, ENV0): `setWeather` and `timeOfDay` write the island's
 * world environment (simulation state); the presentation follows with its smooth transitions. Islands whose script
 * never reads the environment have none, so the actions are refused there (the validator counts them as reads).
 */

type Result = ScriptActionResult;

const DONE: Result = { kind: "done" };
const REFUSED: Result = { kind: "failed", outcome: "refused" };

const setWeather = (host: ScriptActionHost, { args, scope }: ScriptActionRequest): Result => {
  const environment = host.environment();
  const weather = stringArg(scope, args.state, "") as WeatherState;
  if (!environment || !SCRIPT_WEATHER.includes(weather)) return REFUSED;
  const seconds = numberArg(scope, args.transitionSeconds, Number.NaN);
  environment.setWeather(scriptTickOf(host), weather, Number.isFinite(seconds) ? Math.max(0, seconds) : null);
  return DONE;
};

const timeOfDay = (host: ScriptActionHost, { args, scope }: ScriptActionRequest): Result => {
  const environment = host.environment();
  const hour = numberArg(scope, args.hour, Number.NaN);
  if (!environment || !(hour >= 0 && hour < HOURS_PER_DAY)) return REFUSED;
  environment.timeOfDay(scriptTickOf(host), hour);
  return DONE;
};

export const ENVIRONMENT_ACTIONS: Readonly<Record<string, (host: ScriptActionHost, request: ScriptActionRequest) =>
  Result>> = { setWeather, timeOfDay };
