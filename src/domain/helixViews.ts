import {
  formatTurns,
  helixMetrics,
  helixPoint,
  type HelixMetrics,
} from './helix';
import { format, world } from './geometry';
import type { Bar, Point, Primitive, Project } from './types';
import { HELIX_LIMITS, defaultHelixCriteria } from './helixSchema';
import { quantityLabel } from './detailQuantities';

/**
 * Representation only. The longitudinal projection keeps the exact ends,
 * the final phase and the extent; its chords never feed length, turns,
 * fabrication or mass. Adaptive sampling: chord sagitta ≤ projectionTolerance
 * (model mm, divided by the view scale), 8 to 256 points per turn, and at most
 * HELIX_LIMITS.maxProjectionPoints points for the whole piece.
 */
export function helixProjection(
  m: HelixMetrics,
  scale = 1,
): { front: Point[][]; back: Point[][] } {
  if (m.errors.length) return { front: [], back: [] };
  const tolerance =
    HELIX_LIMITS.projectionTolerance / Math.max(1, Math.abs(scale));
  const perTurnByTolerance = Math.ceil(
    (2 * Math.PI) /
      (2 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(m.R, tolerance)))),
  );
  const perTurn = Math.max(
    8,
    Math.min(
      256,
      perTurnByTolerance,
      Math.floor((HELIX_LIMITS.maxProjectionPoints - 1) / Math.max(m.turns, 1)),
    ),
  );
  const steps = Math.max(2, Math.ceil(m.turns * perTurn));
  const front: Point[][] = [],
    back: Point[][] = [];
  const sweep = m.endAngle - m.startAngle;
  // Parameters: uniform samples plus the exact crossings θ = kπ (w = 0),
  // even when a crossing coincides with a sample.
  const ts: number[] = [];
  for (let i = 0; i <= steps; i++) ts.push(i / steps);
  const lo = Math.min(m.startAngle, m.endAngle),
    hi = Math.max(m.startAngle, m.endAngle);
  for (let k = Math.ceil(lo / Math.PI); k * Math.PI <= hi; k++)
    ts.push((k * Math.PI - m.startAngle) / sweep);
  ts.sort((x, y) => x - y);
  const params = ts.filter(
    (t, i) => t >= 0 && t <= 1 && (i === 0 || t - ts[i - 1] > 1e-12),
  );
  // Each sub-interval is classified by its midpoint: w ≥ 0 is the front.
  const point = (t: number) => {
    const q = helixPoint(m, t);
    return { x: q.x, y: q.y };
  };
  let current: Point[] = [point(params[0])];
  let currentFront: boolean | undefined;
  for (let i = 1; i < params.length; i++) {
    const a = params[i - 1],
      b = params[i];
    const isFront = Math.sin(m.startAngle + (sweep * (a + b)) / 2) >= 0;
    if (currentFront !== undefined && isFront !== currentFront) {
      (currentFront ? front : back).push(current);
      current = [point(a)];
    }
    currentFront = isFront;
    current.push(point(b));
  }
  (currentFront ? front : back).push(current);
  return {
    front: front.filter((l) => l.length > 1),
    back: back.filter((l) => l.length > 1),
  };
}

const sectionCenter = (m: HelixMetrics): Point => ({
  x: m.gross + Math.max(0.75 * m.D, 200) + m.R,
  y: 0,
});

/** Shared canvas/paper/PDF/DXF geometry of the physical piece's own view. */
export function helixPrimitives(
  b: Bar,
  transform: (point: Point) => Point = (point) => world(point, b),
  scale = 1,
): Primitive[] {
  const m = helixMetrics(b);
  if (m.errors.length) return [];
  const { front, back } = helixProjection(m, scale);
  const dash = Math.max(4 * m.phi, m.pitch / 10);
  const out: Primitive[] = [
    ...front.map(
      (points): Primitive => ({
        layer: 'ARMADURAS',
        points: points.map(transform),
      }),
    ),
    ...back.map(
      (points): Primitive => ({
        layer: 'ARMADURAS',
        points: points.map(transform),
        style: {
          lineType: { name: 'HELICE_FUNDO', pattern: [dash, -dash / 2] },
        },
      }),
    ),
    // Axis A→B (center line) and useful limits.
    {
      layer: 'COTAS',
      points: [
        { x: 0, y: 0 },
        { x: m.gross, y: 0 },
      ].map(transform),
      style: {
        lineType: {
          name: 'HELICE_EIXO',
          pattern: [dash * 2, -dash / 2, 0, -dash / 2],
        },
      },
    },
    ...[m.start, m.end].map(
      (x): Primitive => ({
        layer: 'COTAS',
        points: [
          { x, y: -m.R - 40 },
          { x, y: m.R + 40 },
        ].map(transform),
      }),
    ),
  ];
  // Start marker: a short radial stroke at the first point of the bar.
  const first = helixPoint(m, 0),
    last = helixPoint(m, 1);
  for (const q of [first, last])
    out.push({
      layer: 'COTAS',
      points: [
        { x: q.x - 15, y: q.y - 15 },
        { x: q.x + 15, y: q.y + 15 },
      ].map(transform),
    });
  if ((b.helixDisplay ?? defaultHelixCriteria().display).section) {
    const c = sectionCenter(m);
    const n = 96;
    out.push({
      layer: 'ARMADURAS',
      closed: true,
      points: Array.from({ length: n }, (_, i) => ({
        x: c.x + m.R * Math.cos((2 * Math.PI * i) / n),
        y: c.y + m.R * Math.sin((2 * Math.PI * i) / n),
      })).map(transform),
    });
    for (const [a, z] of [
      [
        { x: c.x - m.R - 40, y: c.y },
        { x: c.x + m.R + 40, y: c.y },
      ],
      [
        { x: c.x, y: c.y - m.R - 40 },
        { x: c.x, y: c.y + m.R + 40 },
      ],
    ])
      out.push({
        layer: 'COTAS',
        points: [a, z].map(transform),
        style: {
          lineType: {
            name: 'HELICE_EIXO',
            pattern: [dash * 2, -dash / 2, 0, -dash / 2],
          },
        },
      });
  }
  return out;
}

/** Local displayed points for selection, snapping and fit-to-view. */
export function helixViewPoints(b: Bar): Point[] {
  const m = helixMetrics(b);
  if (m.errors.length)
    return [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
  const out: Point[] = [
    { x: 0, y: -m.R },
    { x: 0, y: m.R },
    { x: m.gross, y: -m.R },
    { x: m.gross, y: m.R },
    { x: 0, y: 0 },
    { x: m.gross, y: 0 },
  ];
  const first = helixPoint(m, 0),
    last = helixPoint(m, 1);
  out.push({ x: first.x, y: first.y }, { x: last.x, y: last.y });
  if ((b.helixDisplay ?? defaultHelixCriteria().display).section) {
    const c = sectionCenter(m);
    out.push({ x: c.x - m.R, y: c.y - m.R }, { x: c.x + m.R, y: c.y + m.R }, c);
  }
  return out;
}

/** Outline of the displayed projection, for hit-testing along the piece. */
export function helixOutline(b: Bar): Point[][] {
  const m = helixMetrics(b);
  if (m.errors.length) return [];
  const { front, back } = helixProjection(m);
  const lines = [...front, ...back];
  if ((b.helixDisplay ?? defaultHelixCriteria().display).section) {
    const c = sectionCenter(m);
    lines.push(
      Array.from({ length: 49 }, (_, i) => ({
        x: c.x + m.R * Math.cos((2 * Math.PI * i) / 48),
        y: c.y + m.R * Math.sin((2 * Math.PI * i) / 48),
      })),
    );
  }
  return lines;
}

export function helixLabelOrigin(b: Bar): Point {
  if (b.helixDisplay?.label) return b.helixDisplay.label;
  const m = helixMetrics(b);
  return { x: 0, y: -m.R - 330 };
}

/** One piece, N turns: never reads as N plane rings. */
export function helixCaption(
  b: Bar,
  project?: Project,
  mark: string = b.mark,
): string {
  const m = helixMetrics(b);
  const quantity = quantityLabel(project, b);
  const unit =
    quantity.endsWith(' 1') || quantity === '1' ? 'hélice' : 'hélices';
  return `${mark} - ${quantity} ${unit} x %%c${format(b.diameter, b.diameter % 1 ? 1 : 0)} - ${formatTurns(m.turns)} voltas - p=${format(m.pitch / 10, 1)} cm - C=${format(m.cutLength / 1000, 3)} m`;
}

/** Dimension labels keep the physical values; the projection is schematic. */
export function helixDimensionLabels(
  b: Bar,
): { text: string; at: Point; align: 'left' | 'center' | 'right' }[] {
  const m = helixMetrics(b);
  if (m.errors.length || !b.helix) return [];
  const below = -m.R - 140;
  const out: { text: string; at: Point; align: 'left' | 'center' | 'right' }[] =
    [
      {
        text: `H = ${format(m.H / 10, 1)} cm (útil)`,
        at: { x: (m.start + m.end) / 2, y: below - 50 },
        align: 'center',
      },
      {
        text: `D = ${format(m.D / 10, 1)} cm (eixo)`,
        at: { x: -170, y: -20 },
        align: 'right',
      },
      {
        text: `p = ${format(m.pitch / 10, 1)} cm (volta completa)`,
        at: { x: pitchStart(m) + m.pitch / 2, y: m.R + 150 },
        align: 'center',
      },
      {
        text: 'Projeção esquemática · fundo tracejado · cotas reais',
        at: { x: m.gross / 2, y: below - 130 },
        align: 'center',
      },
      { text: 'A', at: { x: 0, y: m.R + 70 }, align: 'center' },
      { text: 'B', at: { x: m.gross, y: m.R + 70 }, align: 'center' },
    ];
  if (m.startOffset > 0)
    out.push({
      text: `a = ${format(m.startOffset / 10, 1)}`,
      at: { x: m.startOffset / 2, y: below + 20 },
      align: 'center',
    });
  if (m.endOffset > 0)
    out.push({
      text: `b = ${format(m.endOffset / 10, 1)}`,
      at: { x: m.gross - m.endOffset / 2, y: below + 20 },
      align: 'center',
    });
  if ((b.helixDisplay ?? defaultHelixCriteria().display).section) {
    const c = sectionCenter(m);
    const d = b.helix.diameter;
    out.push({
      text:
        d.reference === 'axis'
          ? `Seção · D = ${format(m.D / 10, 1)} cm (eixo)`
          : d.reference === 'external'
            ? `Seção · D = ${format(m.D / 10, 1)} cm (eixo) · Dext = ${format(d.value / 10, 1)} cm`
            : `Seção · D = ${format(m.D / 10, 1)} cm (eixo) · Dconc = ${format(d.value / 10, 1)} cm, c = ${format(d.cover / 10, 1)} cm`,
      at: { x: c.x, y: c.y - m.R - 110 },
      align: 'center',
    });
  }
  return out;
}

/** First crest (projected y = R) inside the useful length, or the start. */
function pitchStart(m: HelixMetrics): number {
  const sweep = m.endAngle - m.startAngle;
  if (Math.abs(sweep) < 1e-12) return m.start;
  // θ(t) = 2πk; t = (2πk − θ0)/sweep, the smallest t ≥ 0.
  const ks = [
    Math.ceil(m.startAngle / (2 * Math.PI)),
    Math.floor(m.startAngle / (2 * Math.PI)),
  ];
  const ts = ks
    .map((k) => (2 * Math.PI * k - m.startAngle) / sweep)
    .filter((t) => t >= -1e-12);
  const t = Math.min(...ts);
  const x = m.start + m.H * Math.max(0, t);
  return x + m.pitch <= m.end + 1e-9 ? x : m.start;
}

/** Witness and dimension lines for H, a, b, p and D (local coordinates). */
export function helixDimensionPrimitives(
  b: Bar,
  transform: (point: Point) => Point = (point) => world(point, b),
): Primitive[] {
  const m = helixMetrics(b);
  if (m.errors.length) return [];
  const out: Primitive[] = [];
  const line = (points: Point[]) =>
    out.push({ layer: 'COTAS', points: points.map(transform) });
  const horizontal = (x0: number, x1: number, y: number, from: number) => {
    line([
      { x: x0, y: from },
      { x: x0, y: y + (y < from ? -20 : 20) },
    ]);
    line([
      { x: x1, y: from },
      { x: x1, y: y + (y < from ? -20 : 20) },
    ]);
    line([
      { x: x0, y },
      { x: x1, y },
    ]);
    for (const x of [x0, x1])
      line([
        { x: x - 10, y: y - 10 },
        { x: x + 10, y: y + 10 },
      ]);
  };
  const below = -m.R - 140;
  horizontal(m.start, m.end, below, -m.R);
  if (m.startOffset > 0) horizontal(0, m.start, below + 60, -m.R);
  if (m.endOffset > 0) horizontal(m.end, m.gross, below + 60, -m.R);
  const p0 = pitchStart(m);
  horizontal(p0, p0 + m.pitch, m.R + 100, m.R);
  const x = -90;
  line([
    { x: 0, y: -m.R },
    { x: x - 20, y: -m.R },
  ]);
  line([
    { x: 0, y: m.R },
    { x: x - 20, y: m.R },
  ]);
  line([
    { x, y: -m.R },
    { x, y: m.R },
  ]);
  for (const y of [-m.R, m.R])
    line([
      { x: x - 10, y: y - 10 },
      { x: x + 10, y: y + 10 },
    ]);
  return out;
}
