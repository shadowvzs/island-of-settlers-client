import type { QualityLevel } from "../../render-common/quality";
import { detectDetail } from "./detect-device";
import { settingsStorage } from "./graphics-settings";
import { probeFingerprintChanged, readProbeFingerprint } from "./probe-fingerprint";

export interface GraphicsChoice {
  /** Detail level of this run. */
  detail: QualityLevel;
  /** Detail level the first run's probe recommended; null when unknown. */
  recommended: QualityLevel | null;
}

/** Injectable probe and fingerprint sources: the unit tests run without WebGL or a real screen. */
export interface GraphicsChoiceDeps {
  detect?: typeof detectDetail;
  fingerprint?: typeof readProbeFingerprint;
}

/**
 * Stores a fresh recommendation. A manual choice (anything but the previous recommendation) is
 * kept: the probe only refreshes the marked recommendation, never the player's own setting.
 */
const storeRecommendation = (
  detail: QualityLevel,
  storedDetail: QualityLevel | null,
  previousRecommended: QualityLevel | null
) => {
  settingsStorage.writeRecommended(detail);
  if (storedDetail !== null && storedDetail !== previousRecommended) return storedDetail;
  settingsStorage.writeDetail(detail);
  return detail;
};

/**
 * The Detail level of this run: `?quality=` or the stored setting; on the very first run the
 * device is probed (at most about one and a half seconds), and the result is stored both as
 * setting and as recommendation. Later launches probe again only when the device fingerprint
 * (browser, screen, known GPU) changed; a manual Detail choice survives that re-probe.
 */
export const chooseGraphics = async (
  requested: QualityLevel | null,
  onProbe: () => void,
  deps: GraphicsChoiceDeps = {}
): Promise<GraphicsChoice> => {
  const recommended = settingsStorage.readRecommended();
  if (requested) return { detail: requested, recommended };
  const storedDetail = settingsStorage.readDetail();
  const currentFingerprint = (deps.fingerprint ?? readProbeFingerprint)();
  const storedFingerprint = settingsStorage.readProbeFingerprint();
  if (storedDetail !== null) {
    // The first launch after the fingerprint was introduced adopts the current device without a
    // probe: there is nothing to compare with, so nothing has provably changed.
    if (storedFingerprint === null) settingsStorage.writeProbeFingerprint(currentFingerprint);
    if (storedFingerprint === null || !probeFingerprintChanged(storedFingerprint, currentFingerprint)) {
      return { detail: storedDetail, recommended };
    }
  }
  onProbe();
  const { detail, probe } = await (deps.detect ?? detectDetail)();
  console.info("graphics probe", JSON.stringify(probe), "->", detail);
  settingsStorage.writeProbeFingerprint({ ...currentFingerprint, renderer: probe.renderer });
  return { detail: storeRecommendation(detail, storedDetail, recommended), recommended: detail };
};
