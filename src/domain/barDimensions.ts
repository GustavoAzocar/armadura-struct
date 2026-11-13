import { add, distance, dot, geometry, mul, sub, unit } from './geometry';
import { stirrupEnvelope, stirrupGeometry } from './stirrupGeometry';
import type { Bar, Point, Segment } from './types';

type ReferenceKind =
  | 'axis-vertex'
  | 'axis-envelope'
  | 'tangency'
  | 'cut-face'
  | 'outer-face';
type Reference = { point: Point; kind: ReferenceKind };
type Line = Extract<Segment, { type: 'line' }>;

export type BarDimension = {
  from: Reference;
  to: Reference;
  direction: Point;
  /** Projected distance in model millimeters. Witness points are bar-local. */
  length: number;
};

export type BarDimensions = {
  status: 'available' | 'unsupported' | 'invalid';
  axis: BarDimension[];
  straight: BarDimension[];
  external: BarDimension[];
  diagnostic?: string;
};

const unsupported = (
  axis: BarDimension[] = [],
  straight: BarDimension[] = [],
): BarDimensions => ({
  status: 'unsupported',
  axis,
  straight,
  external: [],
  diagnostic: 'Cota externa indisponível para esta forma.',
});

const invalid = (diagnostic: string): BarDimensions => ({
  status: 'invalid',
  axis: [],
  straight: [],
  external: [],
  diagnostic,
});

function dimension(
  from: Reference,
  to: Reference,
  direction: Point,
): BarDimension {
  return {
    from,
    to,
    direction,
    length: Math.max(0, dot(sub(to.point, from.point), direction)),
  };
}

function sameKind(a: Point, b: Point, direction: Point, kind: ReferenceKind) {
  return dimension({ point: a, kind }, { point: b, kind }, direction);
}

function hasExternalFreeShape(directions: Point[]) {
  const [a, b, c] = directions;
  const perpendicular = (u: Point, v: Point) => Math.abs(dot(u, v)) < 1e-9;
  // Both U bends turn the same way: the first and last legs are antiparallel.
  return (
    directions.length === 1 ||
    (directions.length === 2 && perpendicular(a, b)) ||
    (directions.length === 3 &&
      perpendicular(a, b) &&
      perpendicular(b, c) &&
      dot(a, c) < 0)
  );
}

function freeDimensions(bar: Bar): BarDimensions {
  const { points } = bar;
  if (points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    return invalid('Vértice com coordenada não finita.');
  }
  const physical = geometry(bar);
  if (physical.errors.length || !Number.isFinite(physical.length)) {
    return invalid(
      physical.errors.join(' ') || 'Comprimento geométrico inválido.',
    );
  }
  const lines = physical.segments.filter((s): s is Line => s.type === 'line');
  const directions = points.slice(1).map((p, i) => unit(sub(p, points[i])));
  const axis = directions.map((u, i) =>
    sameKind(points[i], points[i + 1], u, 'axis-vertex'),
  );
  const straight = lines.map(({ a, b }, i) =>
    dimension(
      { point: a, kind: i === 0 ? 'cut-face' : 'tangency' },
      { point: b, kind: i === lines.length - 1 ? 'cut-face' : 'tangency' },
      directions[i],
    ),
  );
  const specialEnd = [bar.manufacturing?.start, bar.manufacturing?.end].some(
    (end) => end && end.kind !== 'plain',
  );
  if (
    !hasExternalFreeShape(directions) ||
    specialEnd ||
    straight.some((d) => d.length <= 1e-9)
  ) {
    return unsupported(axis, straight);
  }

  const halfDiameter = bar.diameter / 2;
  const external = directions.map((u, i) => {
    const prev = lines[i - 1];
    const next = lines[i + 1];
    // At a bend, use the neighboring leg's surface at its tangency.
    // A free end uses its cut plane, with no longitudinal radius added.
    const from: Reference = prev
      ? { point: add(prev.b, mul(u, -halfDiameter)), kind: 'outer-face' }
      : { point: lines[i].a, kind: 'cut-face' };
    const to: Reference = next
      ? { point: add(next.a, mul(u, halfDiameter)), kind: 'outer-face' }
      : { point: lines[i].b, kind: 'cut-face' };
    return dimension(from, to, u);
  });
  return { status: 'available', axis, straight, external };
}

function rectangularDimensions(bar: Bar): BarDimensions {
  const { width, height, inset } = stirrupEnvelope(bar);
  if (
    ![width, height, inset].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return invalid('Envelope do eixo inválido.');
  }
  const sign = bar.stirrupMirrored ? -1 : 1;
  const corner = { x: inset, y: sign * inset };
  const horizontal = { x: 1, y: 0 };
  const vertical = { x: 0, y: sign };
  const axis = [
    sameKind(
      corner,
      add(corner, mul(horizontal, width)),
      horizontal,
      'axis-envelope',
    ),
    sameKind(
      corner,
      add(corner, mul(vertical, height)),
      vertical,
      'axis-envelope',
    ),
  ];
  const profile = bar.stirrupProfile;
  if (!profile) return unsupported(axis);
  const body = stirrupGeometry(bar, true);
  if (body.errors.length) return invalid(body.errors.join(' '));
  if (!profile.closed) return unsupported(axis);

  const lines = body.segments.filter(
    (s): s is Line => s.type === 'line' && distance(s.a, s.b) > 1e-9,
  );
  const external: BarDimension[] = [];
  for (const { direction: u, from, to } of axis) {
    const onPlane = (point: Point) =>
      lines.find(({ a, b }) =>
        [a, b].every((end) => Math.abs(dot(sub(end, point), u)) < 1e-7),
      );
    const low = onPlane(from.point);
    const high = onPlane(to.point);
    if (!low || !high) return unsupported(axis);
    const face = ({ a, b }: Line, side: number) =>
      add(mul(add(a, b), 0.5), mul(u, (side * bar.diameter) / 2));
    external.push(sameKind(face(low, -1), face(high, 1), u, 'outer-face'));
  }
  return { status: 'available', axis, straight: [], external };
}

/** Dimension references independent of drawing transforms and steel quantities. */
export function barDimensions(bar: Bar): BarDimensions {
  if (
    !Number.isFinite(bar.diameter) ||
    bar.diameter <= 0 ||
    !Number.isFinite(bar.mandrel + bar.diameter) ||
    bar.mandrel < 0
  ) {
    return invalid('Bitola ou mandril inválido.');
  }
  if (bar.kind === 'free' && !bar.stirrupProfile) return freeDimensions(bar);
  if (
    bar.kind === 'stirrup' &&
    (!bar.stirrupProfile || bar.stirrupProfile.shape === 'rectangle')
  ) {
    return rectangularDimensions(bar);
  }
  return unsupported();
}
