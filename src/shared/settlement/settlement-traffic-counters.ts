/**
 * Deterministic traffic work counters. CI and benches gate on these instead of wall time;
 * every increment is a plain integer add, so the hot paths pay nothing measurable.
 */
export const trafficWork = {
  crowdEscapeCalls: 0,
  groundVisits: 0,
  groundSearches: 0,
  navigationCacheHits: 0,
  proactiveShoulders: 0,
  segmentCalls: 0,
  segmentSamples: 0,
  yieldBudgetHits: 0,
  yieldCalls: 0
};
export type TrafficWorkCounters = typeof trafficWork;

export const resetTrafficWork = () => {
  for (const key of Object.keys(trafficWork) as (keyof TrafficWorkCounters)[]) trafficWork[key] = 0;
};
export const snapshotTrafficWork = (): TrafficWorkCounters => ({ ...trafficWork });
