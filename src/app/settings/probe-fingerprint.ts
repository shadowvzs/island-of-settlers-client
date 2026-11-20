/**
 * The probe fingerprint (C12): the first-run device probe stores what it measured the device by, so
 * the next launches probe again only when the browser, the screen or the GPU changed. The renderer
 * string is only known after a probe, so it is compared only when both sides have one.
 */
export interface ProbeFingerprint {
  /** Browser identity (the user agent); a browser update changes it. */
  browser: string;
  /** Unmasked GPU renderer string of the last probe; empty before the first probe. */
  renderer: string;
  /** Screen size and device pixel ratio, as one comparable string. */
  screen: string;
}

/** The identity of this launch, without the renderer string (it needs a WebGL context). */
export const readProbeFingerprint = (): ProbeFingerprint => {
  const screenInfo = globalThis.screen;
  const width = screenInfo?.width ?? 0;
  const height = screenInfo?.height ?? 0;
  const ratio = globalThis.devicePixelRatio ?? 1;
  return {
    browser: globalThis.navigator?.userAgent ?? "",
    renderer: "",
    screen: `${width}x${height}@${ratio}`
  };
};

/** Stored form. */
export const formatProbeFingerprint = (fingerprint: ProbeFingerprint) => JSON.stringify(fingerprint);

/** Tolerant parse: any unreadable or incomplete value means "no fingerprint stored". */
export const parseProbeFingerprint = (raw: string | null): ProbeFingerprint | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { browser, renderer, screen } = parsed as Partial<ProbeFingerprint>;
    if (typeof browser !== "string" || typeof renderer !== "string" || typeof screen !== "string") {
      return null;
    }
    return { browser, renderer, screen };
  } catch {
    return null;
  }
};

/** Whether a stored fingerprint is stale: another browser or screen, or another known GPU. */
export const probeFingerprintChanged = (
  stored: ProbeFingerprint | null,
  current: ProbeFingerprint
) => {
  if (stored === null) return true;
  if (stored.browser !== current.browser || stored.screen !== current.screen) return true;
  return stored.renderer !== "" && current.renderer !== "" && stored.renderer !== current.renderer;
};
