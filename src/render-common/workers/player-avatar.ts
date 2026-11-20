import { TRIPO_ROSTER } from "@workers/tripo-roster";

import { workerBodyNation } from "./worker-body-nation";
import type { WorkerNation } from "./worker-unit";

/** The two player avatar genders; every nation has a canonical face/body for both. */
export const PLAYER_AVATAR_GENDERS = ["female", "male"] as const;

export type PlayerAvatarGender = (typeof PLAYER_AVATAR_GENDERS)[number];

export interface PlayerAvatarBody {
  gender: PlayerAvatarGender;
  /** The Tripo body id shared by the portrait exporter, HUD and possessed explorer. */
  variant: string;
}

/**
 * One canonical body per nation and gender (`island-of-settlers-worker-generation/src/tripo-roster.ts`). The portrait
 * exporter, HUD sheet lookup and exploration appearance all read this table; body ids are never
 * repeated in feature code. The default gender below keeps today's portrait for old accounts.
 */
const expansionAvatars = (nation: "chinese" | "indigenous" | "maya" | "persian") => {
  const published = Object.hasOwn(TRIPO_ROSTER, nation);
  return {
    female: { gender: "female" as const, variant: published ? `${nation}-female-1` : "roman-woman-grey" },
    male: { gender: "male" as const, variant: published ? `${nation}-male-1` : "roman-man-white" }
  };
};

export const PLAYER_AVATAR_BODIES = {
  maya: expansionAvatars("maya"),
  persian: expansionAvatars("persian"),
  chinese: expansionAvatars("chinese"),
  indigenous: expansionAvatars("indigenous"),
  japanese: {
    female: { gender: "female", variant: "japanese-woman-red" },
    male: { gender: "male", variant: "japanese-man-grey" }
  },
  nubian: {
    female: { gender: "female", variant: "nubian-woman-cream" },
    male: { gender: "male", variant: "nubian-man-kilt" }
  },
  roman: {
    female: { gender: "female", variant: "roman-woman-grey" },
    male: { gender: "male", variant: "roman-man-white" }
  },
  viking: {
    female: { gender: "female", variant: "viking-woman-blue" },
    male: { gender: "male", variant: "viking-man-blond" }
  }
} as const satisfies Record<WorkerNation, Record<PlayerAvatarGender, PlayerAvatarBody>>;

/** Today's canonical portrait gender; old accounts and saves keep this face until they choose. */
export const DEFAULT_PLAYER_AVATAR_GENDER = {
  maya: "male",
  persian: "male",
  chinese: "male",
  indigenous: "male",
  japanese: "female",
  nubian: "male",
  roman: "male",
  viking: "female"
} as const satisfies Record<WorkerNation, PlayerAvatarGender>;

export const isPlayerAvatarGender = (value: unknown): value is PlayerAvatarGender =>
  PLAYER_AVATAR_GENDERS.includes(value as PlayerAvatarGender);

/** The canonical body of one nation and gender. */
export const playerAvatarBody = (nation: WorkerNation, gender: PlayerAvatarGender): PlayerAvatarBody =>
  PLAYER_AVATAR_BODIES[nation][gender];

/** The canonical body of the nation's old default gender. */
export const defaultPlayerAvatarBody = (nation: WorkerNation): PlayerAvatarBody =>
  playerAvatarBody(nation, DEFAULT_PLAYER_AVATAR_GENDER[nation]);

/** True when the roster contains the avatar body under its recorded gender (fallback guard). */
export const hasPlayerAvatarBody = (nation: WorkerNation, variant: string, gender?: PlayerAvatarGender) => {
  const roster = TRIPO_ROSTER[workerBodyNation(nation, variant)];
  if (gender) return (roster[gender] as readonly string[]).includes(variant);
  return ([...roster.female, ...roster.male] as readonly string[]).includes(variant);
};
