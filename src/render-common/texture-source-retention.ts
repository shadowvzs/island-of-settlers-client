/**
 * The WebGL surface painter releases its CPU pixels after the first upload. The WebGPU presenter
 * needs those pixels for its own texture upload, so the spike turns retention on before buildings
 * are created. The default WebGL path leaves it off and keeps the existing memory behaviour.
 */
let retain = false;

export const setRetainTextureSource = (next: boolean) => {
  retain = next;
};

export const shouldRetainTextureSource = () => retain;
