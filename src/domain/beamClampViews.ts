import { beamClampGeometry } from './beamClamp';
import { add, sub, mul, unit, format, world } from './geometry';
import type { Bar, Point, Primitive } from './types';
import type { BeamClampView } from './beamClampSchema';

export const defaultBeamClampView: BeamClampView = {
  mode: 'perspective',
  transverseScale: 0.5,
  transverseAngle: 45,
  closedSide: 'left',
};

/** This affine projection belongs to the view, never to the physical centerline. */
export function beamClampViewPoint(
  point: Point,
  view: BeamClampView = defaultBeamClampView,
): Point {
  const side = view.closedSide === 'right' ? -1 : 1;
  if (view.mode === 'development') return { x: point.x * side, y: point.y };
  const angle = (view.transverseAngle * Math.PI) / 180;
  return {
    x: side * (point.x + point.y * view.transverseScale * Math.cos(angle)),
    y: point.y * view.transverseScale * Math.sin(angle),
  };
}

/**
 * Shared canvas/paper/PDF/DXF geometry. Perspective curves use chords with a
 * maximum projected sagitta of 0.05 model mm (including representation scale).
 * Only a flat development emits native circular arcs. These chords never feed
 * fabrication, quantities, signatures, or mass.
 */
export function beamClampPrimitives(
  b: Bar,
  view: BeamClampView = b.beamClampView ?? defaultBeamClampView,
  transform: (point: Point) => Point = (point) => world(point, b),
  scale = 1,
  mirrored = false,
): Primitive[] {
  const g = beamClampGeometry(
    b,
    (view.hooks ?? b.beamClampDisplay?.hooks) === false,
  );
  const project = (point: Point) => transform(beamClampViewPoint(point, view));
  const norm =
    view.mode === 'development' ? 1 : Math.hypot(1, view.transverseScale);
  const tolerance = 0.05 / (norm * Math.max(1, Math.abs(scale)));
  return g.segments.map((segment): Primitive => {
    if (segment.type === 'line')
      return {
        layer: 'ARMADURAS',
        points: [project(segment.a), project(segment.b)],
      };
    const n = Math.max(
      2,
      Math.ceil(
        Math.abs(segment.angle) /
          (2 *
            Math.acos(
              Math.max(-1, 1 - tolerance / Math.max(segment.radius, tolerance)),
            )),
      ),
    );
    const points = Array.from({ length: n + 1 }, (_, i) =>
      project(
        add(segment.center, {
          x:
            segment.radius *
            Math.cos(segment.startAngle + (segment.angle * i) / n),
          y:
            segment.radius *
            Math.sin(segment.startAngle + (segment.angle * i) / n),
        }),
      ),
    );
    if (view.mode === 'perspective') return { layer: 'ARMADURAS', points };
    const center = project(segment.center);
    return {
      layer: 'ARMADURAS',
      points,
      native: {
        kind: 'arc',
        center,
        radius: segment.radius * Math.abs(scale),
        startAngle:
          (Math.atan2(points[0].y - center.y, points[0].x - center.x) * 180) /
          Math.PI,
        sweepAngle:
          ((segment.angle * 180) / Math.PI) *
          (view.closedSide === 'right' ? -1 : 1) *
          (mirrored ? -1 : 1),
      },
    };
  });
}

/** Local displayed points, suitable for selection, snapping and fit-to-view. */
export function beamClampViewPoints(
  b: Bar,
  view: BeamClampView = b.beamClampView ?? defaultBeamClampView,
): Point[] {
  return beamClampPrimitives(b, view, (point) => point).flatMap(
    (p) => p.points,
  );
}

/** Identification starts below the entire displayed piece and its dimensions. */
export function beamClampLabelOrigin(
  b: Bar,
  view: BeamClampView = b.beamClampView ?? defaultBeamClampView,
): Point {
  if (view.label) return view.label;
  const points = beamClampViewPoints(b, view);
  return {
    x: Math.min(0, ...points.map((point) => point.x)),
    y: Math.min(0, ...points.map((point) => point.y)) - 160,
  };
}

/** Labels retain the physical L/T values after compression, reflection or rotation. */
export function beamClampDimensionLabels(
  b: Bar,
  view: BeamClampView = b.beamClampView ?? defaultBeamClampView,
): { text: string; at: Point; align: 'left' | 'center' | 'right' }[] {
  if (!b.beamClamp) return [];
  const { longitudinal: l, transverse: t } = b.beamClamp;
  const side = view.closedSide === 'right' ? -1 : 1;
  return [
    {
      text: `L = ${format(l / 10, 2)} cm (eixo)`,
      align: 'center',
      at: add(beamClampViewPoint({ x: l / 2, y: t / 2 }, view), {
        x: 0,
        y: 50,
      }),
    },
    {
      text: `T = ${format(t / 10, 2)} cm (eixo)`,
      align: side === 1 ? 'right' : 'left',
      at: { x: -side * 100, y: 0 },
    },
    {
      text:
        view.mode === 'perspective'
          ? 'Perspectiva esquemática · cotas reais'
          : 'Desenvolvimento plano · cotas no eixo',
      align: 'center',
      at: add(beamClampViewPoint({ x: l / 2, y: -t / 2 }, view), {
        x: 0,
        y: -70,
      }),
    },
  ];
}

/** Witness lines refer to theoretical axis vertices, even in a compressed view. */
export function beamClampDimensionPrimitives(
  b: Bar,
  view: BeamClampView = b.beamClampView ?? defaultBeamClampView,
  transform: (point: Point) => Point = (point) => world(point, b),
): Primitive[] {
  if (!b.beamClamp) return [];
  const { longitudinal: l, transverse: t } = b.beamClamp;
  const side = view.closedSide === 'right' ? -1 : 1;
  const out: Primitive[] = [];
  const line = (points: Point[]) =>
    out.push({ layer: 'COTAS', points: points.map(transform) });
  const dimension = (a: Point, z: Point, offset: Point) => {
    const start = add(a, offset),
      end = add(z, offset);
    line([a, start]);
    line([z, end]);
    line([start, end]);
    const axis = unit(sub(end, start));
    const tick = mul(add(axis, { x: -axis.y, y: axis.x }), 10);
    for (const point of [start, end])
      line([sub(point, tick), add(point, tick)]);
  };
  dimension(
    beamClampViewPoint({ x: 0, y: t / 2 }, view),
    beamClampViewPoint({ x: l, y: t / 2 }, view),
    { x: 0, y: 30 },
  );
  dimension(
    beamClampViewPoint({ x: 0, y: -t / 2 }, view),
    beamClampViewPoint({ x: 0, y: t / 2 }, view),
    { x: -side * 70, y: 0 },
  );
  return out;
}
