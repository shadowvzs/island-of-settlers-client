import type { ObservationRoute, ObservationSubject } from "./camera-follow";

const ROUTE_POINT_LIMIT = 64;
interface RoutePoint {
  x: number;
  y: number;
  z: number;
}

/** Copies only the upcoming route; never computes a new path or changes the actor's path index. */
export const selectedRoutePoints = (
  subject: ObservationSubject,
  height: (x: number, z: number) => number,
  route: ObservationRoute | null | undefined = subject.route?.()
) => {
  if (!route || !Number.isInteger(route.index) || route.index < 0) return [];
  const upcoming = route.points.slice(route.index, route.index + ROUTE_POINT_LIMIT);
  if (!upcoming.length) return [];
  const result: RoutePoint[] = [{ x: subject.x, y: subject.y + 0.15, z: subject.z }];
  for (const point of upcoming) {
    if (![point.x, point.z].every(Number.isFinite)) break;
    const y = route.surfaceY ?? height(point.x, point.z);
    if (!Number.isFinite(y)) break;
    result.push({ x: point.x, y: y + 0.15, z: point.z });
  }
  return result;
};
