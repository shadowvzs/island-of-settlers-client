/** A finished track repeats itself first; otherwise advance, wrap only when repeat is enabled. */
export const nextMusicTrackAfterEnd = (
  current: number, count: number, loopCurrent: boolean, repeatPlaylist: boolean
): number | null => {
  if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(current) ||
    current < 0 || current >= count) return null;
  if (loopCurrent) return current;
  if (current + 1 < count) return current + 1;
  if (repeatPlaylist) return 0;
  return null;
};
