/** A nearby workboat or ferry has one real operating paddler; sea-ship crews are separate. */
export const SMALL_BOAT_ROWERS = 1;
/** Persisted active small-boat work uses the one-paddler ownership contract. */
export const SMALL_BOAT_JOB_VERSION = 2;
/** Stable render identity shared by the same shuttle person ashore and at the oars. */
export const shuttlePersonId = (job: number, index = 0) => 2_200_000_000 + job * 2 + index;
