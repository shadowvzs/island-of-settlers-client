import { MATERIAL } from "../shared/world/world-data";
import { paintTile } from "./ground-icons";
import { createIconCanvas } from "./relief-icons";

/** Textured terrain cross-sections, with clear direction marks at small toolbar sizes. */
export const renderTerrainIcon = (mode: number) => {
  const { canvas, context: c } = createIconCanvas();
  c.save();
  const land = new Path2D();
  land.moveTo(35, (mode === 4 || mode === 5) ? 195 : 330);
  if (mode === 4 || mode === 5) land.bezierCurveTo(210, 195, 240, 395, 477, 395);
  else if (mode === 2 || mode >= 6) land.bezierCurveTo(170, 300, 335, 300, 477, 330);
  else if (mode === 3) {
    for (let x = 35; x <= 477; x += 6) land.lineTo(x, 310 + Math.sin(x * .05) * 28);
  } else {
    land.bezierCurveTo(180, 330, 190, 190, 256, 190);
    land.bezierCurveTo(325, 190, 340, 330, 477, 330);
  }
  land.lineTo(477, 465); land.lineTo(35, 465); land.closePath();
  c.clip(land);
  c.drawImage(paintTile((mode === 4 || mode === 5) ? MATERIAL.sand : MATERIAL.grass), 0, 0, 512, 512);
  c.restore();
  c.strokeStyle = "#433327"; c.lineWidth = 10; c.stroke(land);
  if (mode === 4 || mode === 5) {
    c.fillStyle = "#288fbd";
    c.fillRect(255, 255, 235, 140);
    c.strokeStyle = "#b4eef4"; c.lineWidth = 10;
    for (let y = 280; y <= 350; y += 35) {
      c.beginPath(); c.moveTo(280, y); c.bezierCurveTo(335, y - 15, 390, y + 15, 470, y); c.stroke();
    }
  }
  if (mode === 0 || mode === 1 || mode === 5) {
    const down = mode !== 0, cy = mode === 5 ? 110 : 115;
    c.fillStyle = "#fff1c7"; c.strokeStyle = "#4c3829"; c.lineWidth = 9;
    c.beginPath();
    const points = [[230, -65], [282, -65], [282, -5], [330, -5], [256, 70], [182, -5], [230, -5]];
    points.forEach(([x, y], i) => { const yy = cy + (down ? y! : -y!); if (i) c.lineTo(x!, yy); else c.moveTo(x!, yy); });
    c.closePath(); c.fill(); c.stroke();
  } else if (mode < 4) {
    c.strokeStyle = "#fff1c7"; c.lineWidth = 18; c.lineCap = "round";
    c.beginPath(); c.moveTo(95, 150); c.lineTo(417, 150); c.stroke();
    if (mode === 3) { c.beginPath(); c.moveTo(95, 155); for (let x = 95; x <= 417; x += 5) c.lineTo(x, 155 + Math.sin(x * .055) * 28); c.stroke(); }
  }
  if (mode >= 6) {
    c.strokeStyle = "#fff1c7"; c.lineWidth = 14; c.lineCap = "round";
    c.beginPath(); c.moveTo(80, 185); c.lineTo(425, 185); c.stroke();
    c.strokeStyle = "#4c3829"; c.lineWidth = 7;
    if (mode === 6) {
      c.fillStyle = "#e9c48b"; c.fillRect(110, 85, 290, 62); c.strokeRect(110, 85, 290, 62);
      for (let x = 130; x <= 380; x += 35) {
        c.beginPath(); c.moveTo(x, 90); c.lineTo(x, 120); c.stroke();
      }
    } else {
      c.fillStyle = "#98b5c0";
      c.beginPath(); c.moveTo(235, 310); c.lineTo(270, 310); c.lineTo(395, 120);
      c.lineTo(355, 92); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = "#674a31"; c.beginPath(); c.arc(385, 95, 43, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  }
  return canvas;
};
