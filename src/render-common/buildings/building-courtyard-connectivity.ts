/** Flood the clear owned-yard lanes from the public perimeter, so hand-off points cannot be isolated pockets. */
export const createCourtyardConnectivity = (
  width: number, depth: number, clear: (x: number, z: number) => boolean
) => {
  const pitch = .125, halfX = width / 2 + .75, halfZ = depth / 2 + .75;
  const columns = Math.ceil(halfX * 2 / pitch) + 1, rows = Math.ceil(halfZ * 2 / pitch) + 1;
  const open = new Uint8Array(columns * rows), connected = new Uint8Array(columns * rows), queue: number[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column, x = -halfX + column * pitch, z = -halfZ + row * pitch;
    if (!clear(x, z)) continue;
    open[index] = 1;
    if (row === 0 || column === 0 || row === rows - 1 || column === columns - 1) {
      connected[index] = 1; queue.push(index);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!, row = Math.floor(index / columns), column = index % columns;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextX = column + dx!, nextZ = row + dz!;
      if (nextX < 0 || nextX >= columns || nextZ < 0 || nextZ >= rows) continue;
      const next = nextZ * columns + nextX;
      if (!open[next] || connected[next]) continue;
      connected[next] = 1; queue.push(next);
    }
  }
  return (x: number, z: number) => {
    if (!clear(x, z)) return false;
    if (Math.abs(x) > halfX || Math.abs(z) > halfZ) return true;
    const column = Math.round((x + halfX) / pitch), row = Math.round((z + halfZ) / pitch);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nextX = column + dx, nextZ = row + dz;
      if (nextX < 0 || nextX >= columns || nextZ < 0 || nextZ >= rows || !connected[nextZ * columns + nextX]) continue;
      const targetX = -halfX + nextX * pitch, targetZ = -halfZ + nextZ * pitch;
      let visible = true;
      for (let step = 0; step <= 4; step++) if (!clear(x + (targetX - x) * step / 4, z + (targetZ - z) * step / 4)) {
        visible = false; break;
      }
      if (visible) return true;
    }
    return false;
  };
};
