import { maskPoint } from '../cad/import';
import { nativePoints } from './nativeMasks';
import { maskCadEntities, type MaskCadEntity } from './maskCadEditing';
import {
  dimensionPresentationSchema,
  type DimensionPresentation,
} from './maskDimensions';
import type { MaskDrawingContext } from './maskDrawing';
import type { Mask, Point, Primitive, Project } from './types';

/**
 * Read-only geometric query for one mask entity ("Medir contorno").
 *
 * Results are in model millimetres: points go through the mask transform
 * (`maskPoint`, the same one used by drawing, snaps and dimensions), so pan
 * and zoom never take part. Native circles and arcs use their analytic
 * radius/sweep. Imported or normalized entities only carry the polyline that
 * the importer kept; their values describe that approximation and nothing
 * else. Holes/multiple outlines are never combined: the area is the one of
 * the single selected closed outline.
 */
export type ContourExactness = 'exact' | 'analytic' | 'approximation';
export type ContourMeasurement =
  | {
      ok: true;
      closed: false;
      /** Accumulated length, mm. */
      length: number;
      exactness: ContourExactness;
      kind: string;
      notes: string[];
    }
  | {
      ok: true;
      closed: true;
      /** mm */
      perimeter: number;
      /** mm², always non-negative (independent of vertex order). */
      area: number;
      exactness: ContourExactness;
      kind: string;
      notes: string[];
    }
  | { ok: false; kind: string; reason: string };

/** Absolute length tolerance (mm) used to reject degenerate segments. */
export const CONTOUR_LENGTH_TOLERANCE = 1e-6;
/**
 * A closed outline whose area is below this fraction of perimeter² is treated
 * as collapsed (collinear vertices). A square gives 1/16.
 */
export const CONTOUR_AREA_RATIO_TOLERANCE = 1e-9;
const LIMIT = 1e9;

const finite = (p: Point) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Math.abs(p.x) <= LIMIT &&
  Math.abs(p.y) <= LIMIT;
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

type Segment = { a: Point; b: Point; i: number };
/** Signed side of c relative to a→b, with a scale-aware dead band. */
function orient(a: Point, b: Point, c: Point, eps: number) {
  const v = cross(sub(b, a), sub(c, a));
  return Math.abs(v) <= eps ? 0 : Math.sign(v);
}
function onSegment(a: Point, b: Point, c: Point, eps: number) {
  return (
    Math.min(a.x, b.x) - eps <= c.x &&
    c.x <= Math.max(a.x, b.x) + eps &&
    Math.min(a.y, b.y) - eps <= c.y &&
    c.y <= Math.max(a.y, b.y) + eps
  );
}
function segmentsTouch(s: Segment, t: Segment, eps: number, areaEps: number) {
  const o1 = orient(s.a, s.b, t.a, areaEps),
    o2 = orient(s.a, s.b, t.b, areaEps),
    o3 = orient(t.a, t.b, s.a, areaEps),
    o4 = orient(t.a, t.b, s.b, areaEps);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (o1 === 0 && onSegment(s.a, s.b, t.a, eps)) ||
    (o2 === 0 && onSegment(s.a, s.b, t.b, eps)) ||
    (o3 === 0 && onSegment(t.a, t.b, s.a, eps)) ||
    (o4 === 0 && onSegment(t.a, t.b, s.b, eps))
  );
}
/**
 * Detects crossings, touching and overlaps between segments of one path.
 * Adjacent segments may only share their common vertex; a reversal along the
 * same line (spike) counts as an overlap. Sweep on X keeps typical cases
 * close to O(n log n).
 */
export function pathSelfIntersects(points: Point[], closed: boolean) {
  const n = points.length,
    count = closed ? n : n - 1;
  if (count < 2) return false;
  let extent = 0;
  for (const p of points)
    extent = Math.max(
      extent,
      Math.abs(p.x - points[0].x),
      Math.abs(p.y - points[0].y),
    );
  const eps = Math.max(1e-9, extent * 1e-12),
    areaEps = Math.max(1e-12, extent * extent * 1e-12);
  const segs: Segment[] = Array.from({ length: count }, (_, i) => ({
    a: points[i],
    b: points[(i + 1) % n],
    i,
  }));
  const adjacent = (i: number, j: number) =>
    Math.abs(i - j) === 1 || (closed && Math.abs(i - j) === count - 1);
  // Adjacent segments: reversed collinear direction means an overlap.
  for (let i = 0; i < count; i++) {
    if (!closed && i === count - 1) break;
    const s = segs[i],
      t = segs[(i + 1) % count],
      u = sub(s.b, s.a),
      v = sub(t.b, t.a);
    const sine =
      Math.abs(cross(u, v)) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
    if (sine <= 1e-10 && dot(u, v) < 0) return true;
  }
  const order = [...segs].sort(
    (s, t) => Math.min(s.a.x, s.b.x) - Math.min(t.a.x, t.b.x),
  );
  const active: Segment[] = [];
  for (const s of order) {
    const minX = Math.min(s.a.x, s.b.x),
      minY = Math.min(s.a.y, s.b.y),
      maxY = Math.max(s.a.y, s.b.y);
    for (let k = active.length - 1; k >= 0; k--)
      if (Math.max(active[k].a.x, active[k].b.x) < minX - eps)
        active.splice(k, 1);
    for (const t of active) {
      if (
        Math.max(t.a.y, t.b.y) < minY - eps ||
        Math.min(t.a.y, t.b.y) > maxY + eps
      )
        continue;
      // Adjacent segments share their vertex by construction (checked above).
      if (adjacent(s.i, t.i)) continue;
      if (segmentsTouch(s, t, eps, areaEps)) return true;
    }
    active.push(s);
  }
  return false;
}

/**
 * Length, perimeter and area of an explicit polyline in mm. `closed` is the
 * entity's own flag: an open path is never closed implicitly, even when its
 * ends coincide.
 */
export function measurePolyline(
  points: Point[],
  closed: boolean,
  kind = closed ? 'contorno' : 'polilinha',
  exactness: ContourExactness = 'exact',
): ContourMeasurement {
  if (!points.every(finite))
    return {
      ok: false,
      kind,
      reason:
        'Coordenadas não finitas ou fora de ±1.000.000.000 mm. Nenhuma medida foi apresentada.',
    };
  const notes: string[] = [];
  let pts = points;
  // An explicit repeated closing vertex is the same outline, not an extra edge.
  if (
    closed &&
    pts.length > 1 &&
    Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y) <=
      CONTOUR_LENGTH_TOLERANCE
  )
    pts = pts.slice(0, -1);
  if (pts.length < 2)
    return {
      ok: false,
      kind,
      reason: 'Geometria degenerada: menos de dois vértices distintos.',
    };
  const count = closed ? pts.length : pts.length - 1;
  let length = 0;
  for (let i = 0; i < count; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length],
      d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= CONTOUR_LENGTH_TOLERANCE)
      return {
        ok: false,
        kind,
        reason: `Geometria degenerada: segmento ${i + 1} com comprimento nulo (vértices coincidentes).`,
      };
    length += d;
  }
  if (!Number.isFinite(length))
    return {
      ok: false,
      kind,
      reason: 'Comprimento fora do intervalo numérico.',
    };
  const endsMeet =
    !closed &&
    Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y) <=
      CONTOUR_LENGTH_TOLERANCE;
  // Coincident ends of an open path are an expected contact, not a crossing.
  const crosses =
    endsMeet && pts.length > 3
      ? pathSelfIntersects(pts.slice(0, -1), true)
      : pathSelfIntersects(pts, closed);
  if (!closed) {
    if (endsMeet)
      notes.push(
        'As extremidades coincidem, mas a entidade não está marcada como fechada: tratada como caminho aberto, sem área.',
      );
    if (crosses)
      notes.push(
        'O caminho cruza ou sobrepõe a si mesmo; o comprimento soma todos os trechos.',
      );
    return { ok: true, closed: false, length, exactness, kind, notes };
  }
  if (pts.length < 3)
    return {
      ok: false,
      kind,
      reason: 'Contorno fechado exige ao menos três vértices distintos.',
    };
  // Shoelace relative to the first vertex limits cancellation far from origin.
  const o = pts[0];
  let twice = 0;
  for (let i = 1; i < pts.length - 1; i++)
    twice += cross(sub(pts[i], o), sub(pts[i + 1], o));
  const area = Math.abs(twice) / 2;
  const far = pts.reduce((a, p) =>
      Math.hypot(p.x - o.x, p.y - o.y) > Math.hypot(a.x - o.x, a.y - o.y)
        ? p
        : a,
    ),
    axis = sub(far, o),
    axisLength = Math.hypot(axis.x, axis.y);
  const collinear = pts.every(
    (p) =>
      Math.abs(cross(sub(p, o), axis)) / axisLength <=
      Math.max(CONTOUR_LENGTH_TOLERANCE, axisLength * 1e-12),
  );
  if (collinear)
    return {
      ok: false,
      kind,
      reason: 'Contorno degenerado: vértices colineares, sem área.',
    };
  if (crosses)
    return {
      ok: false,
      kind,
      reason:
        'Contorno com autointerseção ou trechos sobrepostos: perímetro e área não são apresentados porque não definem uma região única.',
    };
  if (!(area > CONTOUR_AREA_RATIO_TOLERANCE * length * length))
    return {
      ok: false,
      kind,
      reason: 'Contorno degenerado: área nula ou desprezível.',
    };
  return {
    ok: true,
    closed: true,
    perimeter: length,
    area,
    exactness,
    kind,
    notes,
  };
}

const transformIssue = (m: Mask) =>
  !Number.isFinite(m.scale) ||
  m.scale <= 0 ||
  ![m.rotation, m.origin.x, m.origin.y].every(Number.isFinite);

/** Human label for an entity kind, used by the panel. */
export function contourKindLabel(q: Primitive, m: Mask) {
  const n = q.native?.kind;
  if (n && n !== 'text')
    return {
      line: 'linha',
      polyline: q.closed ? 'polilinha fechada' : 'polilinha',
      rectangle: 'retângulo',
      circle: 'círculo',
      arc: 'arco',
    }[n];
  if (q.text) return 'texto';
  const imported = m.format !== 'NATIVE';
  return q.closed
    ? `contorno ${imported ? 'importado' : 'normalizado'}`
    : `polilinha ${imported ? 'importada' : 'normalizada'}`;
}

/** Measures one mask entity in model mm without changing anything. */
export function measureMaskEntity(m: Mask, q: Primitive): ContourMeasurement {
  const kind = contourKindLabel(q, m);
  if (transformIssue(m))
    return {
      ok: false,
      kind,
      reason: 'Transformação da máscara inválida; nenhuma medida apresentada.',
    };
  if (q.text)
    return {
      ok: false,
      kind,
      reason: 'Texto não é caminho nem contorno: sem comprimento ou área.',
    };
  const n = q.native;
  if (n) {
    try {
      nativePoints(n);
    } catch (e) {
      return {
        ok: false,
        kind,
        reason: `Geometria nativa inválida: ${(e as Error).message}`,
      };
    }
    if (n.kind === 'circle' || n.kind === 'arc') {
      const c = maskPoint(n.center, m),
        r = n.radius * m.scale;
      if (
        !finite(c) ||
        !Number.isFinite(r) ||
        r <= 0 ||
        Math.abs(c.x) + r > LIMIT ||
        Math.abs(c.y) + r > LIMIT
      )
        return {
          ok: false,
          kind,
          reason:
            'Centro/raio fora dos limites do modelo. Nenhuma medida foi apresentada.',
        };
      if (n.kind === 'circle')
        return {
          ok: true,
          closed: true,
          perimeter: 2 * Math.PI * r,
          area: Math.PI * r * r,
          exactness: 'analytic',
          kind,
          notes: [],
        };
      return {
        ok: true,
        closed: false,
        length: (Math.abs(n.sweepAngle) * Math.PI * r) / 180,
        exactness: 'analytic',
        kind,
        notes: [],
      };
    }
    // Rectangles/polylines/lines: the native vertices are the exact geometry.
    return measurePolyline(
      nativePoints(n).map((v) => maskPoint(v, m)),
      q.closed ?? false,
      kind,
      'exact',
    );
  }
  if (q.points.length < 2)
    return {
      ok: false,
      kind,
      reason: 'Entidade com um único ponto: sem comprimento ou área.',
    };
  const r = measurePolyline(
    q.points.map((v) => maskPoint(v, m)),
    !!q.closed,
    kind,
    'approximation',
  );
  if (r.ok)
    r.notes.unshift(
      'Geometria importada/normalizada: o valor corresponde à polilinha disponível. Se a entidade original era arco, círculo, elipse ou curva, trata-se da aproximação discretizada; a curva original não é reconstruída.',
    );
  return r;
}

/**
 * Entities that can be queried in the active drawing: visible and capturable
 * by the existing rules (`maskCadEntities`) and owned by the active detail.
 * Locked layers are measurable because nothing is edited.
 */
export function contourMeasureCandidates(
  p: Project,
  ctx: MaskDrawingContext,
): MaskCadEntity[] {
  return maskCadEntities(p, ctx).filter(
    (e) =>
      p.hierarchy.objectDetails[e.mask.id] === ctx.detailId &&
      !e.ref.primitive.text,
  );
}

const unitFactor = { mm: 1, cm: 10, m: 1000 } as const;
/** Formats an area in mm² for display only, as mm², cm² or m². */
export function formatArea(mm2: number, options: DimensionPresentation) {
  const o = dimensionPresentationSchema.parse(options);
  return `${(mm2 / unitFactor[o.unit] ** 2).toLocaleString('pt-BR', {
    minimumFractionDigits: o.precision,
    maximumFractionDigits: o.precision,
    useGrouping: false,
  })} ${o.unit}²`;
}
