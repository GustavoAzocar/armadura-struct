import type { Point } from './types';
import { add, sub, mul, dot, distance } from './geometry';
import {
  curvePoint,
  nearestCurve,
  normAngle,
  pathCurve,
  roundCurve,
  TAU,
  MASK_CAD_TOLERANCE as EPS,
  type CadCurve,
} from './maskCadGeometry';
import {
  nearbySnapCurves,
  type SnapIndex,
  type SnapModes,
  type SnapCandidate,
} from './objectSnaps';

/** IDs only: references always resolve against the current capturable scene. */
export type SnapAcquisition = {
  extension?: { id: string; end: 0 | 1 };
  parallel?: { id: string };
};
type Options = {
  enabled: boolean;
  active: boolean;
  modes: Readonly<SnapModes>;
  tolerance: number;
  base?: Point;
  linear: boolean;
};
const finite = (p: Point) =>
  [p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9);
const line = (c: CadCurve) =>
  c.kind === 'path' && c.points.length === 2 && !c.closed;
export function acquireSnapGuides(
  index: SnapIndex,
  raw: Point,
  previous: SnapAcquisition,
  options: Options,
): SnapAcquisition {
  if (!options.enabled || !options.active || !finite(raw)) return {};
  const { modes, tolerance, base, linear } = options;
  const next: SnapAcquisition = {};
  const ext = previous.extension && index.entries.get(previous.extension.id);
  if (modes.extension && ext && !ext.curve.closed)
    next.extension = previous.extension;
  const par = previous.parallel && index.entries.get(previous.parallel.id);
  if (
    modes.parallel &&
    par &&
    line(par.curve) &&
    base &&
    finite(base) &&
    linear
  )
    next.parallel = previous.parallel;
  if (!modes.extension && !(modes.parallel && base && linear)) return next;
  let endDistance = tolerance,
    parallelDistance = tolerance;
  for (const entry of nearbySnapCurves(index, raw, tolerance)) {
    const c = entry.curve;
    if (modes.extension && !c.closed)
      for (const end of [0, 1] as const) {
        const d = distance(raw, curvePoint(c, end ? c.total : 0));
        if (d < endDistance) {
          endDistance = d;
          next.extension = { id: entry.id, end };
        }
      }
    if (modes.parallel && base && finite(base) && linear && line(c)) {
      const d = nearestCurve(c, raw).distance;
      if (d < parallelDistance) {
        parallelDistance = d;
        next.parallel = { id: entry.id };
      }
    }
  }
  return next;
}

export function snapGuideCandidates(
  index: SnapIndex,
  acquisition: SnapAcquisition,
  raw: Point,
  options: Options,
): SnapCandidate[] {
  if (!options.enabled || !options.active || !finite(raw)) return [];
  const result: SnapCandidate[] = [];
  const acquired = acquisition.extension;
  const ext = acquired && index.entries.get(acquired.id);
  if (options.modes.extension && acquired && ext && !ext.curve.closed) {
    const c = ext.curve,
      tip = curvePoint(c, acquired.end ? c.total : 0);
    if (c.kind === 'path') {
      const other = curvePoint(c, acquired.end ? 0 : c.total);
      const u = mul(sub(tip, other), 1 / distance(tip, other));
      const along = dot(sub(raw, tip), u);
      if (along > EPS) {
        const point = add(tip, mul(u, along));
        if (finite(point))
          result.push({
            point,
            mode: 'extension',
            sourceId: ext.id,
            order: 3e8 + ext.order,
            guide: pathCurve([tip, point], false),
          });
      }
    } else if (distance(raw, c.center) > EPS) {
      const start = c.start + (acquired.end ? c.sweep : 0);
      const direction = Math.sign(c.sweep) * (acquired.end ? 1 : -1);
      const angle = Math.atan2(raw.y - c.center.y, raw.x - c.center.x);
      const delta = normAngle(direction * (angle - start));
      // Only continue the acquired end through the complementary sweep. Never
      // wrap around onto the original arc or invent an end on a full circle.
      if (
        delta * c.radius > EPS &&
        delta < TAU - Math.abs(c.sweep) - EPS / c.radius
      ) {
        const guide = roundCurve(c.center, c.radius, start, direction * delta);
        const point = curvePoint(guide, guide.total);
        if (finite(point))
          result.push({
            point,
            mode: 'extension',
            sourceId: ext.id,
            order: 3e8 + ext.order,
            guide,
          });
      }
    }
  }
  const par =
    acquisition.parallel && index.entries.get(acquisition.parallel.id);
  const base = options.base;
  if (
    options.modes.parallel &&
    options.linear &&
    base &&
    finite(base) &&
    par &&
    line(par.curve)
  ) {
    const c = par.curve;
    if (c.kind === 'path') {
      const u = mul(sub(c.points[1], c.points[0]), 1 / c.total);
      const point = add(base, mul(u, dot(sub(raw, base), u)));
      if (finite(point) && distance(base, point) > EPS)
        result.push({
          point,
          mode: 'parallel',
          sourceId: par.id,
          order: 4e8 + par.order,
          guide: pathCurve([base, point], false),
        });
    }
  }
  return result;
}

/** Exact world-space guide, shared by the reference highlight and candidate. */
export function snapGuidePath(c: CadCurve): string {
  if (c.kind === 'path')
    return c.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const a = curvePoint(c, 0),
    b = curvePoint(c, c.total);
  return `M${a.x},${a.y} A${c.radius},${c.radius} 0 ${Math.abs(c.sweep) > Math.PI ? 1 : 0} ${c.sweep > 0 ? 1 : 0} ${b.x},${b.y}`;
}
