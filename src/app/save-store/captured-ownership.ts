/**
 * Settlement snapshots whose bytes have already been copied into a save worker (or another
 * independent owner). The browser save's in-place reload may take the live snapshot directly
 * instead of cloning it again; snapshots without a durable copy keep the defensive clone.
 *
 * This is intentionally a `WeakSet`: a skipped or stale reload cannot retain the snapshot.
 */
const durableCopies = new WeakSet<object>();

export const markCapturedSettlementCopied = (settlement: object) => {
  durableCopies.add(settlement);
};

/** True exactly once for a snapshot that already has an independent copy. */
export const takeCapturedSettlementOwnership = (settlement: object) =>
  durableCopies.delete(settlement);
