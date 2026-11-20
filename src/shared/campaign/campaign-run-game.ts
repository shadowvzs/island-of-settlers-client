import type { Archipelago } from "../settlement/archipelago";
import type { GameSaveV1 } from "../settlement/game-save";

/**
 * A campaign session's catch-up (C2, plan item 24): home and the colonies replay their time away as on a home
 * load, the run on screen never catches up. Its clock stays at its own saved tick, so the run boots exactly where
 * it was saved.
 */

/**
 * A campaign run without a filed home island (no-home play, GS3a): nothing else exists in the session, so there is
 * no time away to replay or skip; the run keeps its own clock as every run does.
 */
export const isHomelessRun = (save: GameSaveV1) => Boolean(save.campaignRun) && !save.archipelago?.home;

/** The home game of a campaign session: home on screen with the same filed islands; the run is left out. */
export const campaignHomeGame = (save: GameSaveV1): GameSaveV1 => {
  const group = save.archipelago;
  if (!save.campaignRun || !group?.home) throw new Error("The campaign run has no filed home island");
  return { ...group.home, archipelago: { ...group, active: null, home: undefined }, player: save.player };
};

const filedHome = ({ archipelago: _group, campaignRun: _run, player: _player, ...home }: GameSaveV1) =>
  home as GameSaveV1;

/** The run back on screen over its (caught-up) home game: home filed again, the run's save untouched. */
export const withCampaignRunOnScreen = (home: GameSaveV1, run: GameSaveV1): GameSaveV1 => {
  const group: Archipelago = {
    ...home.archipelago ?? run.archipelago!, active: null, campaign: run.archipelago?.campaign, home: filedHome(home)
  };
  return { ...run, archipelago: group, player: home.player };
};

/** The game whose time away a catch-up reports: the home game of a campaign session, else the save itself. */
export const catchUpSubject = (save: GameSaveV1) =>
  save.campaignRun && !isHomelessRun(save) ? campaignHomeGame(save) : save;

/** Runs `advance` on the session's home game; a save without a campaign run on screen is advanced as it is. */
export const advanceAroundCampaignRun = async (
  save: GameSaveV1, advance: (home: GameSaveV1) => Promise<GameSaveV1>
): Promise<GameSaveV1> => {
  if (!save.campaignRun) return advance(save);
  if (isHomelessRun(save)) return save;
  const home = campaignHomeGame(save), advanced = await advance(home);
  return advanced === home ? save : withCampaignRunOnScreen(advanced, save);
};
