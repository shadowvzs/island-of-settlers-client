export interface ReservedPlot {
  depth: number;
  width: number;
  x: number;
  z: number;
}

/**
 * Lets the road planner treat a not yet placed building's plot as built, for previewing its road
 * connection: the road network's `isBlocked` asks `blocks` (the same cells a placed building
 * occupies), and the plot is reserved only for the duration of one synchronous plan. No
 * simulation state changes, and no cache keeps the answer: the road network memoizes travel
 * routes only, never construction plans (`planRoad`), the only search run while reserved.
 */
export const createRoadPlotReservation = () => {
  const cells = { active: false, bottom: 0, left: 0, right: 0, top: 0 };

  const blocks = (x: number, z: number) => {
    if (!cells.active) return false;
    const cellX = Math.floor(x), cellZ = Math.floor(z);
    return cellX >= cells.left && cellX < cells.right && cellZ >= cells.top && cellZ < cells.bottom;
  };

  const during = <T>(plot: ReservedPlot, plan: () => T): T => {
    Object.assign(cells, { active: true, bottom: plot.z + plot.depth / 2, left: plot.x - plot.width / 2,
      right: plot.x + plot.width / 2, top: plot.z - plot.depth / 2 });
    try {
      return plan();
    } finally {
      cells.active = false;
    }
  };

  return { blocks, during };
};

export type RoadPlotReservation = ReturnType<typeof createRoadPlotReservation>;
