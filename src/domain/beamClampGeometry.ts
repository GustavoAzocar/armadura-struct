import type { Bar, Geometry, Point, Segment } from './types';
import {
  distance,
  geometryFromPoints,
  sampled,
  sub,
  cross,
  dot,
} from './geometry';
import { hookGeometry } from './stirrupGeometry';
import { beamClampProfileSchema } from './beamClampSchema';

/** The insertion point is the midpoint of the closed transverse axis (0,0). */
export function beamClampVertices(b: Bar): Point[] {
  const p = b.beamClamp!;
  const points = [
    { x: p.longitudinal, y: -p.transverse / 2 },
    { x: 0, y: -p.transverse / 2 },
    { x: 0, y: p.transverse / 2 },
    { x: p.longitudinal, y: p.transverse / 2 },
  ];
  return p.mirrored ? points.map((q) => ({ x: q.x, y: -q.y })) : points;
}
const reverseSegment = (s: Segment): Segment =>
  s.type === 'line'
    ? { ...s, a: s.b, b: s.a }
    : {
        ...s,
        a: s.b,
        b: s.a,
        startAngle: s.startAngle + s.angle,
        angle: -s.angle,
      };

/** Hook intersections are a geometric error, not a silently shortened termination. */
function intersects(points: Point[]): boolean {
  const ps = points.filter((p, i) => !i || distance(p, points[i - 1]) > 1e-7);
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i],
      b = ps[i + 1],
      u = sub(b, a);
    for (let j = i + 2; j < ps.length - 1; j++) {
      const c = ps[j],
        d = ps[j + 1],
        v = sub(d, c),
        den = cross(u, v);
      if (Math.abs(den) < 1e-10) {
        if (Math.abs(cross(sub(c, a), u)) > 1e-7) continue;
        const t = (p: Point) => dot(sub(p, a), u) / dot(u, u);
        if (
          Math.max(Math.min(t(c), t(d)), 0) <=
          Math.min(Math.max(t(c), t(d)), 1) + 1e-9
        )
          return true;
      } else {
        const t = cross(sub(c, a), v) / den,
          s = cross(sub(c, a), u) / den;
        if (t >= -1e-9 && t <= 1 + 1e-9 && s >= -1e-9 && s <= 1 + 1e-9)
          return true;
      }
    }
  }
  return false;
}

/** Physical planar axis, retaining analytic fillets and the shared independent hook contract. */
export function beamClampGeometry(b: Bar, bodyOnly = false): Geometry {
  const errors: string[] = [];
  const parsed = beamClampProfileSchema.safeParse(b.beamClamp);
  if (
    b.kind !== 'beam-clamp' ||
    !parsed.success ||
    !Number.isFinite(b.diameter) ||
    !(b.diameter > 0) ||
    b.diameter > 100 ||
    !Number.isFinite(b.mandrel) ||
    !(b.mandrel > 0) ||
    b.mandrel > 2000
  )
    return {
      segments: [],
      vertices: [],
      length: 0,
      errors: [
        'Revise L, T, bitola, mandril e terminações do grampo de viga: use valores finitos e positivos.',
      ],
    };
  const p = parsed.data,
    r = (b.mandrel + b.diameter) / 2;
  if (p.longitudinal < r - 1e-9)
    errors.push(
      `L insuficiente para a dobra: informe L ≥ R (${r} mm no eixo).`,
    );
  if (p.transverse < 2 * r - 1e-9)
    errors.push(
      `T insuficiente para as duas dobras: informe T ≥ 2R (${2 * r} mm no eixo).`,
    );
  const unmirrored = { ...b, beamClamp: { ...p, mirrored: false } };
  const g = geometryFromPoints(beamClampVertices(unmirrored), r);
  errors.push(...g.errors);
  const start = bodyOnly
    ? []
    : hookGeometry(g.segments[0].a, { x: 1, y: 0 }, p.start, b);
  const end = bodyOnly
    ? []
    : hookGeometry(g.segments.at(-1)!.b, { x: 1, y: 0 }, p.end, b);
  let segments = [
    ...start.reverse().map(reverseSegment),
    ...g.segments,
    ...end,
  ];
  if (
    !bodyOnly &&
    (p.start.angle || p.end.angle) &&
    intersects(sampled(segments, Math.PI / 180))
  )
    errors.push(
      'As terminações cruzam ou sobrepõem o eixo do grampo; revise seus sentidos e comprimentos.',
    );
  if (p.mirrored) {
    const reflect = (q: Point) => ({ x: q.x, y: -q.y });
    segments = segments.map((s) =>
      s.type === 'line'
        ? { ...s, a: reflect(s.a), b: reflect(s.b) }
        : {
            ...s,
            a: reflect(s.a),
            b: reflect(s.b),
            center: reflect(s.center),
            startAngle: -s.startAngle,
            angle: -s.angle,
          },
    );
  }
  const length = segments.reduce(
    (total, s) =>
      total +
      (s.type === 'line' ? distance(s.a, s.b) : Math.abs(s.angle) * s.radius),
    0,
  );
  if (!Number.isFinite(length) || !(length > 0))
    errors.push('Comprimento inválido para o grampo de viga.');
  return {
    segments,
    length,
    vertices: beamClampVertices(b),
    errors: [...new Set(errors)],
  };
}
