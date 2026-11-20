import { CatmullRomCurve3, Vector3 } from "three";

import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";

/** Native-body/hull clearance keys for the solo side lift, in worker model units.
 * The independent dense renderer probe checks palms, body clearance and continuity.
 * Smooth interpolation preserves the start/end stock contact without foot sliding. */
const keys: readonly (readonly [number, number])[] = [[0,0.0],[0,0.0],[0,0.025],[0,0.025],[0,0.025],[0,0.05],[0.025,0.05],[0,0.075],[0,0.075],[0,0.1],[0,0.125],[-0.025,0.125],[-0.05,0.125],[-0.075,0.125],[-0.075,0.125],[-0.075,0.125],[-0.075,0.125],[-0.05,0.125],[-0.025,0.125],[-0.025,0.1],[-0.05,0.075],[-0.025,0.075],[-0.025,0.05],[-0.025,0.025],[-0.075,0.025],[-0.125,0.025],[-0.175,-0.025],[-0.175,0.0],[-0.175,0.0],[-0.15,0.025],[-0.1,0.025],[-0.05,0.0],[-0.025,0.0],[0,0.0],[0,0.0],[0,0.0],[0,0.0],[0,0.0],[0,0.0],[0,0.0],[0,0.0]];
const clearance = new CatmullRomCurve3(keys.map(([y,z]) => new Vector3(0,y,z)), false, "centripetal");
export const boatLiftClearanceOffset = (lift: number) => {
  const phase = Math.max(0, Math.min(1, lift));
  const ease = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
  const offset = clearance.getPoint(phase);
  // Margins between the measured keys, validated at twice their sampling rate.
  offset.z += .01 * ease(phase / .01) * (1 - ease((phase - .20) / .035));
  offset.y += .012 * ease((phase - .65) / .025) * (1 - ease((phase - .70) / .025));
  offset.z += .15 / WORKER_SCALE * ease((phase - .12) / .05) * (1 - ease((phase - .44) / .1));
  offset.y += .07 / WORKER_SCALE * ease((phase - .58) / .04) * (1 - ease((phase - .72) / .08));
  offset.z += .012 / WORKER_SCALE * ease((phase - .44) / .03) * (1 - ease((phase - .51) / .04));
  return offset;
};

/** Head trajectory of the source lift: keeps the hull at the same clearance on each native body. */
const referenceHeadY = [0.575848, 0.5775434, 0.5792387, 0.5809338, 0.5826286, 0.5870148, 0.5929354, 0.5988398, 0.6047279, 0.6114415, 0.6203972, 0.6293049, 0.6381642, 0.6469745, 0.6575744, 0.6682885, 0.6789207, 0.6894702, 0.7004917, 0.7118869, 0.7231763, 0.7343586, 0.7454471, 0.7564928, 0.7674267, 0.7782478, 0.7889552, 0.7988326, 0.808443, 0.8179558, 0.8273705, 0.8359991, 0.8436937, 0.8513229, 0.8588862, 0.8661951, 0.8712713, 0.8763198, 0.8813406, 0.8863335, 0.8891548, 0.8911129, 0.8930689, 0.895023, 0.8962597, 0.8959452, 0.8956423, 0.8954696, 0.8955515, 0.8963338, 0.8983521, 0.9014084, 0.9048721, 0.9083792, 0.9119204, 0.9154956, 0.9191275, 0.9227934, 0.9264934, 0.9302369, 0.9340214, 0.9378333, 0.9416702, 0.9455435, 0.949437, 0.9533445, 0.9572665, 0.9611995, 0.9650875, 0.9688878, 0.972373, 0.9760979, 0.9795497, 0.9822767, 0.9833197, 0.9838422, 0.984018, 0.9841589, 0.984261, 0.9843227, 0.9843434];
export const boatLiftReferenceHeadY = (lift: number) => {
  const at = Math.max(0, Math.min(1, lift)) * (referenceHeadY.length - 1), index = Math.floor(at);
  return referenceHeadY[index]! + (referenceHeadY[Math.min(index + 1, referenceHeadY.length - 1)]! - referenceHeadY[index]!) * (at - index);
};
