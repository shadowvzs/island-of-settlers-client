/**
 * Real UTC time for this page session (owner 2026-10-22): a signed-in player's clock starts at the server's time
 * and runs on the monotonic page clock, so changing the device clock has no effect. Guests and standalone play
 * (no server time) use device time.
 */
export const createSessionClock = (
  serverTime: string | undefined, monotonic: () => number = () => performance.now(), device: () => number = Date.now
) => {
  const server = serverTime ? Date.parse(serverTime) : Number.NaN;
  if (!Number.isFinite(server)) return device;
  const startedAt = monotonic();
  return () => server + Math.round(monotonic() - startedAt);
};

export type SessionClock = ReturnType<typeof createSessionClock>;
