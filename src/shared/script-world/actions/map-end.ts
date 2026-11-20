import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import { CAMPAIGN_MAP_OUTCOMES, type CampaignMapOutcome, endCampaignMap } from "../../campaign/campaign-map-outcome";
import { refIdArg, type ScriptActionHost, stringArg } from "./action-host";

/**
 * `endMap` (trigger design §5.2.8) on a campaign map (C9a): the script decides victory or defeat. The first outcome
 * is final, so a second `endMap`, an outcome after the landing harbour fell, or the action on another map kind is
 * refused. The story quest argument is read by the epilogue (C11). A victory may name one of the map's exits
 * (BR2); the outcome record keeps it, and an exit on a defeat is refused.
 */

const DONE: ScriptActionResult = { kind: "done" };
const REFUSED: ScriptActionResult = { kind: "failed", outcome: "refused" };

const isOutcome = (value: string): value is CampaignMapOutcome =>
  (CAMPAIGN_MAP_OUTCOMES as readonly string[]).includes(value);

const endMap = (host: ScriptActionHost, { args, scope }: ScriptActionRequest): ScriptActionResult => {
  const outcome = stringArg(scope, args.outcome, "");
  if (!isOutcome(outcome)) return REFUSED;
  return endCampaignMap(host.context, outcome, "script", refIdArg(args.exit)) ? DONE : REFUSED;
};

export const MAP_END_ACTIONS: Readonly<Record<string, (host: ScriptActionHost, request: ScriptActionRequest) =>
  ScriptActionResult>> = { endMap };
