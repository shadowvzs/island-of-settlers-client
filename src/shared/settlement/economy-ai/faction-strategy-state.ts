import {
  integer, literal, objectOf, optional
} from "../../../../../island-of-settlers-shared/src/validation/index";
import { STRATEGY_MAX_FAILURES } from "./constants";

/**
 * What a computer faction's own strategic intents remember between decisions (EAI4b, saved): the known building its
 * offensive goes for, the failed offensives in a row and the tick before which it orders no new one, and whether
 * its own intents stand at the director (so an island where it never stated one never touches the director).
 */
export interface FactionStrategyState {
  failures: number;
  retryTick: number;
  stated: boolean;
  target?: number;
}

/** `FactionAiSave.strategy` (settlement format 24): absent while every field has its start value. */
export interface FactionStrategySave {
  failures?: number;
  retryTick?: number;
  stated?: true;
  target?: number;
}

export const strategySaveCheck = objectOf({
  failures: optional(integer(1, STRATEGY_MAX_FAILURES)),
  retryTick: optional(integer(1)),
  stated: optional(literal(true)),
  target: optional(integer(0))
});

export const createFactionStrategyState = (): FactionStrategyState => ({ failures: 0, retryTick: 0, stated: false });

export const restoreFactionStrategyState = (state: FactionStrategyState, saved: FactionStrategySave | undefined) => {
  state.failures = saved?.failures ?? 0;
  state.retryTick = saved?.retryTick ?? 0;
  state.stated = saved?.stated === true;
  state.target = saved?.target;
};

export const saveFactionStrategyState = (
  { failures, retryTick, stated, target }: FactionStrategyState
): FactionStrategySave | undefined => {
  if (!failures && !retryTick && !stated && target === undefined) return undefined;
  return {
    ...(failures ? { failures } : {}), ...(retryTick ? { retryTick } : {}), ...(stated ? { stated: true } : {}),
    ...(target === undefined ? {} : { target })
  };
};
