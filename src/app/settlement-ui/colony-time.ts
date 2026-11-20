/**
 * Compact colony/expedition duration for server-side summaries and tools that have no Lingui instance.
 * Views use the localized `formatColonyDuration` from `colony-helpers`.
 */
export const formatColonyDurationSource = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.ceil(seconds));
  if (total >= 86400) return `${Math.floor(total / 86400)} d ${Math.floor(total % 86400 / 3600)} h`;
  if (total >= 3600) return `${Math.floor(total / 3600)} h ${Math.floor(total % 3600 / 60)} min`;
  const minutes = Math.floor(total / 60), rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
};
