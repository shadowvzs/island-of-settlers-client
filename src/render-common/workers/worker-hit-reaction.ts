/** Length of a soldier's flinch after taking a blow or an arrow (seconds). */
const FLINCH_SECONDS = .35;

/**
 * Notices health drops of drawn soldiers and reports how far each one's flinch has run
 * (0..1, undefined when not flinching). Purely visual: the simulation is not touched.
 */
export const createHitReactions = () => {
  const soldiers = new Map<number, { hp: number; since: number }>();
  const update = (uid: number, hp: number, dt: number) => {
    const state = soldiers.get(uid);
    if (!state) { soldiers.set(uid, { hp, since: Infinity }); return undefined; }
    state.since = hp < state.hp - 1e-6 ? 0 : state.since + dt;
    state.hp = hp;
    return state.since < FLINCH_SECONDS ? state.since / FLINCH_SECONDS : undefined;
  };
  /** Forgets soldiers no longer drawn. */
  const retain = (drawn: ReadonlySet<number>) => {
    for (const uid of soldiers.keys()) if (!drawn.has(uid)) soldiers.delete(uid);
  };
  return { retain, update };
};
