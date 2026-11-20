/** Finite, on-demand carrier recruitment. Saved idle people are the only recruitment pool. */
export interface OfflineTransportFleet {
  workCapacity: number;
  workReadyAt: number;
  recruitableWorkers: number;
  recruitedWorkers: number;
}

/** Preview first: rejected work must not spend a person or reserve any carrier time. */
export const previewOfflineTransport = (fleet: OfflineTransportFleet, tick: number, work: number) => {
  const recruit = fleet.recruitableWorkers > 0 && (fleet.workCapacity === 0 || fleet.workReadyAt > tick);
  const capacity = fleet.workCapacity + Number(recruit);
  if (capacity === 0) return { ready: Infinity, recruit: false };
  return { ready: Math.max(tick, fleet.workReadyAt) + Math.ceil(work / capacity), recruit };
};

export const reserveOfflineTransport = (
  fleet: OfflineTransportFleet, planned: ReturnType<typeof previewOfflineTransport>
) => {
  fleet.workReadyAt = planned.ready;
  if (!planned.recruit) return;
  fleet.workCapacity++;
  fleet.recruitableWorkers--;
  fleet.recruitedWorkers++;
};
