import type { Mask, Point, Primitive } from './types';
import { add, sub, mul, distance, dot } from './geometry';
import {
  curveIntersections,
  nearestCurve,
  pathCurve,
  roundParameter,
  MASK_CAD_TOLERANCE as EPS,
  type CadCurve,
} from './maskCadGeometry';
import { maskCurve } from './maskCadEditing';
import { maskPoint } from '../cad/import';
import { measurePolyline } from './maskContourMeasure';

export const snapModeLabels = {
  endpoint: 'Extremidade',
  midpoint: 'Ponto médio',
  center: 'Centro',
  geometricCenter: 'Centro geométrico',
  quadrant: 'Quadrante',
  intersection: 'Interseção',
  nearest: 'Ponto mais próximo',
  insertion: 'Inserção',
  node: 'Nó',
  perpendicular: 'Perpendicular',
  tangent: 'Tangente',
} as const;
export type SnapMode = keyof typeof snapModeLabels;
export type SnapModes = Record<SnapMode, boolean>;
export const defaultSnapModes: Readonly<SnapModes> = Object.freeze({
  endpoint: true,
  midpoint: true,
  center: false,
  geometricCenter: false,
  quadrant: false,
  intersection: false,
  nearest: false,
  insertion: false,
  node: false,
  perpendicular: false,
  tangent: false,
});
export type SnapSource = {
  id: string;
  curve?: CadCurve;
  insertion?: Point;
  /** Only supply this for an identifiable point entity, never a sampled vertex. */
  node?: Point;
};
export type SnapCandidate = {
  point: Point;
  mode: SnapMode | 'extra';
  sourceId: string;
  order: number;
};
type Box = { minX: number; minY: number; maxX: number; maxY: number };
type Bounded<T> = { box: Box; value: T };
type Tree<T> = {
  box: Box;
  items?: Bounded<T>[];
  left?: Tree<T>;
  right?: Tree<T>;
};
type CurveEntry = { id: string; curve: CadCurve; order: number };
export type SnapIndex = {
  points?: Tree<SnapCandidate>;
  curves?: Tree<CurveEntry>;
};
export type SnapQueryStats = { points: number; curves: number; pairs: number };
const finite = (p: Point) =>
  [p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9);
const pointBox = (p: Point): Box => ({
  minX: p.x,
  minY: p.y,
  maxX: p.x,
  maxY: p.y,
});
const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});
const overlaps = (a: Box, b: Box) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
function tree<T>(items: Bounded<T>[]): Tree<T> | undefined {
  if (!items.length) return;
  const box = items.reduce((b, item) => union(b, item.box), items[0].box);
  if (items.length <= 16) return { box, items };
  const x = box.maxX - box.minX >= box.maxY - box.minY;
  items.sort((a, b) =>
    x
      ? a.box.minX + a.box.maxX - b.box.minX - b.box.maxX
      : a.box.minY + a.box.maxY - b.box.minY - b.box.maxY,
  );
  const mid = Math.floor(items.length / 2);
  return {
    box,
    left: tree(items.slice(0, mid)),
    right: tree(items.slice(mid)),
  };
}
function query<T>(node: Tree<T> | undefined, box: Box, found: T[]) {
  if (!node || !overlaps(node.box, box)) return;
  if (node.items) {
    for (const item of node.items)
      if (overlaps(item.box, box)) found.push(item.value);
  } else {
    query(node.left, box, found);
    query(node.right, box, found);
  }
}
/** Area centroid of one explicit, valid closed outline, in model coordinates. */
export function closedCurveCentroid(c: CadCurve): Point | undefined {
  if (!c.closed) return;
  if (c.kind === 'round') return c.center;
  const measurement = measurePolyline(c.points, true);
  if (!measurement.ok || !measurement.closed) return;
  const origin = c.points[0];
  let twice = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < c.points.length; i++) {
    const a = sub(c.points[i], origin),
      b = sub(c.points[(i + 1) % c.points.length], origin);
    const area = a.x * b.y - b.x * a.y;
    twice += area;
    x += (a.x + b.x) * area;
    y += (a.y + b.y) * area;
  }
  const p = add(origin, { x: x / (3 * twice), y: y / (3 * twice) });
  return finite(p) ? p : undefined;
}
/** The caller applies the canvas's existing visibility/capture filters. */
export function maskSnapSource(
  mask: Mask,
  primitive: Primitive,
  index: number,
): SnapSource {
  const id = `mask:${mask.id}:${primitive.id ?? index}`;
  if (primitive.text !== undefined && primitive.points[0])
    return {
      id,
      insertion: maskPoint(
        primitive.native?.kind === 'text'
          ? primitive.native.at
          : primitive.points[0],
        mask,
      ),
    };
  try {
    return { id, curve: maskCurve(mask, primitive) };
  } catch {
    return { id };
  }
}
/**
 * Built once per immutable scene. The legacy chains retain their exact iteration
 * order, including sampled vertices and preview-point tie precedence.
 */
export function createSnapIndex(
  sources: SnapSource[],
  legacyChains?: { points: Point[] }[],
): SnapIndex {
  const points: Bounded<SnapCandidate>[] = [],
    curves: Bounded<CurveEntry>[] = [];
  let order = 0;
  const addPoint = (
    point: Point | undefined,
    mode: SnapMode,
    sourceId: string,
  ) => {
    if (point && finite(point))
      points.push({
        box: pointBox(point),
        value: { point, mode, sourceId, order: order++ },
      });
  };
  const chains =
    legacyChains ??
    sources.flatMap((s) =>
      s.curve?.kind === 'path' ? [{ points: s.curve.points }] : [],
    );
  for (const [j, chain] of chains.entries()) {
    for (let i = 0; i < chain.points.length; i++) {
      addPoint(chain.points[i], 'endpoint', `legacy:${j}`);
      if (i)
        addPoint(
          mul(add(chain.points[i - 1], chain.points[i]), 0.5),
          'midpoint',
          `legacy:${j}`,
        );
    }
  }
  const addCurve = (id: string, curve: CadCurve) => {
    const box =
      curve.kind === 'round'
        ? {
            minX: curve.center.x - curve.radius,
            minY: curve.center.y - curve.radius,
            maxX: curve.center.x + curve.radius,
            maxY: curve.center.y + curve.radius,
          }
        : union(pointBox(curve.points[0]), pointBox(curve.points[1]));
    curves.push({ box, value: { id, curve, order: curves.length } });
  };
  for (const source of sources) {
    addPoint(source.insertion, 'insertion', source.id);
    addPoint(source.node, 'node', source.id);
    const c = source.curve;
    if (!c) continue;
    addPoint(closedCurveCentroid(c), 'geometricCenter', source.id);
    if (c.kind === 'round') {
      addCurve(source.id, c);
      addPoint(c.center, 'center', source.id);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const point = add(c.center, {
          x: c.radius * Math.cos(a),
          y: c.radius * Math.sin(a),
        });
        if (roundParameter(c, point) !== undefined)
          addPoint(point, 'quadrant', source.id);
      }
    } else
      for (let i = 0; i < c.lengths.length - 1; i++) {
        try {
          addCurve(
            `${source.id}:${i}`,
            pathCurve(
              [c.points[i], c.points[(i + 1) % c.points.length]],
              false,
            ),
          );
        } catch {
          /* A malformed zero-length span is never a geometric target. */
        }
      }
  }
  return { points: tree(points), curves: tree(curves) };
}
export function perpendicularPoints(c: CadCurve, base: Point): Point[] {
  if (!finite(base)) return [];
  if (c.kind === 'round') {
    const v = sub(base, c.center),
      d = Math.hypot(v.x, v.y);
    if (d <= EPS) return []; // Infinitely many radial directions at the centre.
    return [
      add(c.center, mul(v, c.radius / d)),
      add(c.center, mul(v, -c.radius / d)),
    ].filter(
      (p) => distance(p, base) > EPS && roundParameter(c, p) !== undefined,
    );
  }
  const points: Point[] = [];
  for (let i = 0; i < c.lengths.length - 1; i++) {
    const a = c.points[i],
      b = c.points[(i + 1) % c.points.length],
      u = sub(b, a),
      len = distance(a, b);
    const t = dot(sub(base, a), u) / (len * len);
    if (len < EPS || t < -EPS / len || t > 1 + EPS / len) continue;
    const p = add(a, mul(u, Math.max(0, Math.min(1, t))));
    if (finite(p) && distance(p, base) > EPS) points.push(p);
  }
  return points;
}
export function tangentPoints(c: CadCurve, base: Point): Point[] {
  if (c.kind !== 'round' || !finite(base)) return [];
  const v = sub(base, c.center),
    d = Math.hypot(v.x, v.y);
  if (d <= c.radius + EPS) return []; // Interior or zero-length tangent at the base.
  const square = d * d,
    foot = add(c.center, mul(v, (c.radius * c.radius) / square));
  const off = mul(
    { x: -v.y, y: v.x },
    (c.radius * Math.sqrt((d - c.radius) * (d + c.radius))) / square,
  );
  return [add(foot, off), sub(foot, off)].filter(
    (p) => finite(p) && roundParameter(c, p) !== undefined,
  );
}
export function resolveObjectSnap(
  index: SnapIndex,
  raw: Point,
  options: {
    enabled: boolean;
    modes: Readonly<SnapModes>;
    tolerance: number;
    extra?: Point[];
    base?: Point;
    stats?: SnapQueryStats;
  },
): { candidate?: SnapCandidate; limited: boolean } {
  const { modes, tolerance, stats } = options;
  if (
    !options.enabled ||
    !finite(raw) ||
    !(tolerance > 0) ||
    !Number.isFinite(tolerance)
  )
    return { limited: false };
  let best: SnapCandidate | undefined,
    bestDistance = tolerance,
    limited = false;
  const accept = (candidate: SnapCandidate) => {
    if (!finite(candidate.point)) return;
    const d = distance(raw, candidate.point);
    if (
      d < bestDistance ||
      (best && d === bestDistance && candidate.order < best.order)
    ) {
      best = candidate;
      bestDistance = d;
    }
  };
  for (const [i, point] of (options.extra ?? []).entries())
    accept({
      point,
      mode: 'extra',
      sourceId: 'preview',
      order: i - (options.extra?.length ?? 0),
    });
  const box: Box = {
    minX: raw.x - tolerance,
    minY: raw.y - tolerance,
    maxX: raw.x + tolerance,
    maxY: raw.y + tolerance,
  };
  const pointCandidates: SnapCandidate[] = [];
  query(index.points, box, pointCandidates);
  for (const p of pointCandidates) {
    if (stats) stats.points++;
    if (p.mode !== 'extra' && modes[p.mode]) accept(p);
  }
  const near: CurveEntry[] = [];
  const base = options.base && finite(options.base) ? options.base : undefined;
  if (
    modes.intersection ||
    modes.nearest ||
    (base && (modes.perpendicular || modes.tangent))
  ) {
    query(index.curves, box, near);
    for (let i = near.length - 1; i >= 0; i--) {
      if (stats) stats.curves++;
      if (nearestCurve(near[i].curve, raw).distance >= tolerance)
        near.splice(i, 1);
    }
    near.sort((a, b) => a.order - b.order);
  }
  if (base)
    for (const c of near) {
      if (modes.perpendicular)
        perpendicularPoints(c.curve, base).forEach((point, i) =>
          accept({
            point,
            mode: 'perpendicular',
            sourceId: c.id,
            order: 1e8 + 2 * c.order + i,
          }),
        );
      if (modes.tangent)
        tangentPoints(c.curve, base).forEach((point, i) =>
          accept({
            point,
            mode: 'tangent',
            sourceId: c.id,
            order: 2e8 + 2 * c.order + i,
          }),
        );
    }
  if (modes.intersection) {
    const discrete = best,
      discreteDistance = bestDistance;
    const budget = { count: 0, limit: 250000 };
    outer: for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        if (stats) stats.pairs++;
        if (budget.count >= budget.limit) {
          limited = true;
          break outer;
        }
        try {
          for (const point of curveIntersections(
            near[i].curve,
            near[j].curve,
            budget,
          ))
            accept({
              point,
              mode: 'intersection',
              sourceId: `${near[i].id}|${near[j].id}`,
              order: 1e9 + i * near.length + j,
            });
        } catch {
          /* Collinear overlaps/coincident circles have no unique intersection. */
        }
      }
    // Do not advertise an arbitrary partial winner if the local search was exhausted.
    if (limited && best?.mode === 'intersection') {
      best = discrete;
      bestDistance = discreteDistance;
    }
  }
  // A discrete eligible point inside the aperture wins over Nearest, even if the
  // projection is closer to the pointer. All other ties retain stable scene order.
  if (!best && modes.nearest)
    for (const c of near)
      accept({
        point: nearestCurve(c.curve, raw).point,
        mode: 'nearest',
        sourceId: c.id,
        order: c.order,
      });
  return { candidate: best, limited };
}
