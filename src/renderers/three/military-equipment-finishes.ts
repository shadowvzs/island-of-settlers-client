import { type Finish, MATTE, METAL } from "./military-equipment-mesh";

/**
 * Shared surfaces of the armoury; `grain` (High only) maps hafts into the painted wood. The
 * soldier layers have no environment map, so metals stay half diffuse to keep their colour.
 */
export const createFinishes = (detailed: boolean) => ({
  bone: { color: "#e3d7ba", rough: .5 },
  bronze: { color: "#d8a85e", ...METAL },
  darkWood: { color: "#4f311c", grain: detailed, rough: .66 },
  /** Dyed in the faction colour: grip wraps, lashings, rawhide lacing. */
  dyed: { color: "#dcdcdc", livery: 1, rough: .8 },
  gold: { color: "#eabf5c", metal: .5, rough: .26 },
  iron: { color: "#7c828a", metal: .4, rough: .4 },
  lacquer: { color: "#1c1512", metal: .1, rough: .28 },
  leather: { color: "#6a4126", ...MATTE },
  steel: { color: "#e6ebee", metal: .4, rough: .22 },
  wood: { color: "#a77a4d", grain: detailed, rough: .7 }
}) satisfies Record<string, Finish>;
export type Finishes = ReturnType<typeof createFinishes>;
