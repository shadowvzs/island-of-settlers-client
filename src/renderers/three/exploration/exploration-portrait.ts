import { TRIPO_ROSTER } from "@workers/tripo-roster";

import {
  DEFAULT_PLAYER_AVATAR_GENDER,
  defaultPlayerAvatarBody,
  hasPlayerAvatarBody,
  playerAvatarBody,
  type PlayerAvatarGender
} from "../../../render-common/workers/player-avatar";
import { isWorkerNation, WORKER_NATIONS } from "../../../render-common/workers/worker-appearance";
import { workerBodyNation } from "../../../render-common/workers/worker-body-nation";
import type { WorkerAppearance, WorkerNation } from "../../../render-common/workers/worker-unit";

export type ExplorationGender = PlayerAvatarGender;

/**
 * The default (old-account) portrait body of each nation. Derived from the shared body table so no
 * body id is repeated here; the HUD and exploration use `PLAYER_AVATAR_BODIES` for either gender.
 */
export const EXPLORATION_PORTRAIT_BODIES = {
  maya: defaultPlayerAvatarBody("maya"),
  persian: defaultPlayerAvatarBody("persian"),
  chinese: defaultPlayerAvatarBody("chinese"),
  indigenous: defaultPlayerAvatarBody("indigenous"),
  japanese: defaultPlayerAvatarBody("japanese"),
  nubian: defaultPlayerAvatarBody("nubian"),
  roman: defaultPlayerAvatarBody("roman"),
  viking: defaultPlayerAvatarBody("viking")
} as const satisfies Record<WorkerNation, { gender: ExplorationGender; variant: string }>;

/** What the HUD portrait can tell us. Only nation is stored by the game today. */
export interface ExplorationPortraitSource {
  nation?: string | null;
  /** Portrait body variant if a caller has one; otherwise the canonical portrait recipe is used. */
  body?: string | null;
  gender?: string | null;
  skin?: string | null;
  head?: string | null;
  hair?: string | null;
  facialHair?: string | null;
}

/**
 * Real limits of the existing Tripo assets. Skin, head/face, hair and facial hair are baked into one
 * body file; they have no independent selectors. The whole visible body is also one skinned `body`
 * mesh, so the eye-level self geometry cannot be split into a separate head/hair submesh.
 */
export const EXPLORATION_APPEARANCE_ASSET_GAPS = [
  {
    id: "selectable-face-details",
    description: "Tripo bodies bake skin, head, hair and facial hair; no independent variants exist."
  },
  {
    id: "separate-head-geometry",
    description: "Each body is one skinned mesh named body, so head/hair cannot be culled separately."
  },
  {
    id: "spyglass-pack-prop",
    description: "The worker pack has no spyglass prop; the explorer reuses the canonical spyglass recipe."
  }
] as const;

export type ExplorationAppearanceGapField =
  | "body"
  | "facialHair"
  | "gender"
  | "hair"
  | "head"
  | "nation"
  | "skin";

export type ExplorationAppearanceGapReason =
  | "baked-into-body"
  | "body-gender-mismatch"
  | "not-selectable"
  | "unavailable"
  | "unsupported";

export interface ExplorationAppearanceGap {
  field: ExplorationAppearanceGapField;
  reason: ExplorationAppearanceGapReason;
  requested?: string;
}

export interface ExplorationAppearanceResolution {
  appearance: WorkerAppearance;
  /** Gender recorded by the roster/manifest for the chosen body. */
  gender: ExplorationGender;
  gaps: readonly ExplorationAppearanceGap[];
  /** True when the requested nation was unknown and the canonical Roman portrait was used. */
  nationFallback: boolean;
  portrait: {
    body: string;
    facialHair?: string;
    hair?: string;
    head?: string;
    nation: WorkerNation;
    skin?: string;
  };
}

const genderOfBody = (nation: WorkerNation, variant: string): ExplorationGender =>
  (TRIPO_ROSTER[workerBodyNation(nation, variant)].female as readonly string[]).includes(variant) ? "female" : "male";

const normaliseGender = (value: string | null | undefined): ExplorationGender | null => {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  if (text === "woman" || text === "female") return "female";
  if (text === "man" || text === "male") return "male";
  return null;
};

const bodyList = (nation: WorkerNation, gender?: ExplorationGender | null) => {
  const roster = TRIPO_ROSTER[workerBodyNation(nation)];
  if (gender === "female") return roster.female;
  if (gender === "male") return roster.male;
  return [...roster.female, ...roster.male];
};

interface BodySelection {
  body: string;
  gaps: ExplorationAppearanceGap[];
  gender: ExplorationGender;
}

/**
 * Picks a body from the requested nation only: an unknown body falls back to the shared canonical
 * body of the requested gender, then to the first roster body of that same gender (never the other
 * gender or another nation) and reports the substitution.
 */
const selectBody = (
  nation: WorkerNation,
  requestedBody: string,
  requestedGender: ExplorationGender | null
): BodySelection => {
  const gaps: ExplorationAppearanceGap[] = [];
  const available = bodyList(nation) as readonly string[];
  let body = requestedBody;
  if (body && !hasPlayerAvatarBody(nation, body)) {
    gaps.push({ field: "body", reason: "unavailable", requested: body });
    body = "";
  }
  if (body && requestedGender && genderOfBody(nation, body) !== requestedGender) {
    gaps.push({ field: "gender", reason: "body-gender-mismatch", requested: requestedGender });
    body = "";
  }
  if (body) return { body, gaps, gender: genderOfBody(nation, body) };

  const gender = requestedGender ?? DEFAULT_PLAYER_AVATAR_GENDER[nation];
  const canonicalBody = playerAvatarBody(nation, gender).variant;
  if (available.includes(canonicalBody)) return { body: canonicalBody, gaps, gender };

  const sameGenderBody = (bodyList(nation, gender) as readonly string[])[0];
  if (!sameGenderBody) throw new Error(`The ${nation} roster has no ${gender} body`);
  gaps.push({ field: "body", reason: "unavailable", requested: canonicalBody });
  return { body: sameGenderBody, gaps, gender };
};

/**
 * Resolves the portrait recipe against the canonical Tripo roster. Unsupported nations fall back to
 * the shared Roman portrait; an unknown body/gender pair is reported as a gap rather than invented.
 * The returned `WorkerAppearance` can be loaded by every existing worker asset/lease API.
 */
export const resolveExplorationAppearance = (
  source: ExplorationPortraitSource | null | undefined
): ExplorationAppearanceResolution => {
  const gaps: ExplorationAppearanceGap[] = [];
  const requestedNation = source?.nation?.trim() ?? "";
  const nationFallback = !isWorkerNation(requestedNation);
  const nation: WorkerNation = nationFallback ? "roman" : requestedNation;
  if (requestedNation && nationFallback)
    gaps.push({ field: "nation", reason: "unsupported", requested: requestedNation });
  else if (!requestedNation)
    gaps.push({ field: "nation", reason: "unavailable" });

  const requestedGender = normaliseGender(source?.gender);
  if (source?.gender?.trim() && !requestedGender)
    gaps.push({ field: "gender", reason: "unsupported", requested: source.gender.trim() });

  const selection = selectBody(nation, source?.body?.trim() ?? "", requestedGender);
  gaps.push(...selection.gaps);
  for (const field of ["skin", "head", "hair", "facialHair"] as const) {
    const requested = source?.[field]?.trim();
    gaps.push({
      field,
      reason: "baked-into-body",
      ...(requested ? { requested } : {})
    });
  }

  const portrait: ExplorationAppearanceResolution["portrait"] = {
    body: selection.body,
    nation
  };
  if (source?.skin?.trim()) portrait.skin = source.skin.trim();
  if (source?.head?.trim()) portrait.head = source.head.trim();
  if (source?.hair?.trim()) portrait.hair = source.hair.trim();
  if (source?.facialHair?.trim()) portrait.facialHair = source.facialHair.trim();

  return {
    appearance: { nation, variant: selection.body },
    gender: selection.gender,
    gaps,
    nationFallback,
    portrait
  };
};

/** Every known nation has both genders; exposed for callers that offer a portrait gender toggle. */
export const explorationNationBodies = (nation: WorkerNation) => ({
  female: [...TRIPO_ROSTER[workerBodyNation(nation)].female],
  male: [...TRIPO_ROSTER[workerBodyNation(nation)].male]
});

export const isExplorationWorkerNation = isWorkerNation;
export const EXPLORATION_NATIONS = WORKER_NATIONS;
