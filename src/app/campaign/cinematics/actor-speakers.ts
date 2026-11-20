import type { CampaignSpeaker } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { actorDisplayName } from "../../../../../island-of-settlers-shared/src/script/actor-names";
import type { ScriptActor } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import { ACTOR_PORTRAIT_ID_PREFIX, PLACED_ACTOR_PORTRAIT_KEY } from "./constants";

/** The stand-in portrait id of an actor: one per look, so every pirate shares the pirate portrait. */
export const actorPortraitId = (actor: ScriptActor) =>
  `${ACTOR_PORTRAIT_ID_PREFIX}${actor.binding === "spawn" ? actor.look.kind : PLACED_ACTOR_PORTRAIT_KEY}`;

/**
 * The script actors a speak step may name as its speaker (owner 2026-11-13): every actor with a display name (the
 * map maker's, or the default of a pirate or bandit look), under its actor id. The speaker panel shows that name
 * on its name plate and in the portrait's initials.
 */
export const scriptActorSpeakers = (script: Pick<MapScript, "actors">): CampaignSpeaker[] =>
  script.actors.flatMap((actor): CampaignSpeaker[] => {
    const name = actorDisplayName(actor);
    return name ? [{ id: actor.id, name, portraits: { neutral: actorPortraitId(actor) } }] : [];
  });
