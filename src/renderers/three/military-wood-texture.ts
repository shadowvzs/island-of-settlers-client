import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/** Deterministic fine timber grain, generated once per issued equipment model. */
export const createMilitaryWoodTexture = () => {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#c5ad85"; context.fillRect(0, 0, 128, 256);
  for (let line = 0; line < 95; line++) {
    const x = (line * 47) % 128;
    context.strokeStyle = line % 3 ? "rgba(70,42,17,.13)" : "rgba(250,231,183,.21)";
    context.lineWidth = line % 9 === 0 ? 1.4 : .55;
    context.beginPath(); context.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 8)
      context.lineTo(x + Math.sin(y * .035 + line * .7) * (line % 4 + 1), y);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
  return texture;
};
