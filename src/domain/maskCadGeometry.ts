import type { Point } from './types';
import { distance, nearest } from './geometry';
export const MASK_CAD_TOLERANCE = 1e-6;
export const TAU = Math.PI * 2;
export type CadPath = {
  kind: 'path';
  points: Point[];
  closed: boolean;
  lengths: number[];
  total: number;
};
export type CadRound = {
  kind: 'round';
  center: Point;
  radius: number;
  start: number;
  sweep: number;
  closed: boolean;
  total: number;
};
export type CadCurve = CadPath | CadRound;
const EPS = MASK_CAD_TOLERANCE;
export const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;
export const plus = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
});
export const minus = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
export const times = (a: Point, k: number): Point => ({
  x: a.x * k,
  y: a.y * k,
});
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export function pathCurve(input: Point[], closed: boolean): CadPath {
  const points = [...input];
  if (closed && points.length > 2 && distance(points[0], points.at(-1)!) <= EPS)
    points.pop();
  if (
    points.length < 2 ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw new Error('Entidade sem caminho finito utilizável.');
  const lengths = [0];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const length = distance(points[i], points[(i + 1) % points.length]);
    if (length < EPS)
      throw new Error(
        'Segmento degenerado/curto demais (tolerância 0,000001 mm).',
      );
    lengths.push(lengths.at(-1)! + length);
  }
  return { kind: 'path', points, closed, lengths, total: lengths.at(-1)! };
}
export function roundCurve(
  center: Point,
  radius: number,
  start: number,
  sweep: number,
  closed = false,
): CadRound {
  if (
    ![center.x, center.y, radius, start, sweep].every(Number.isFinite) ||
    radius <= 0 ||
    Math.abs(sweep) * radius < EPS ||
    Math.abs(sweep) > TAU + 1e-12
  )
    throw new Error('Curva circular inválida ou curta demais.');
  return {
    kind: 'round',
    center,
    radius,
    start,
    sweep,
    closed,
    total: Math.abs(sweep) * radius,
  };
}
export function curvePoint(c: CadCurve, at: number): Point {
  if (c.kind === 'round') {
    const a = c.start + (Math.sign(c.sweep) * at) / c.radius;
    return {
      x: c.center.x + c.radius * Math.cos(a),
      y: c.center.y + c.radius * Math.sin(a),
    };
  }
  const t = c.closed
    ? ((at % c.total) + c.total) % c.total
    : Math.max(0, Math.min(c.total, at));
  let i = c.lengths.findIndex((n, j) => j > 0 && n >= t);
  if (i < 1) i = c.lengths.length - 1;
  const a = c.points[i - 1],
    b = c.points[i % c.points.length],
    f = (t - c.lengths[i - 1]) / (c.lengths[i] - c.lengths[i - 1]);
  return plus(a, times(minus(b, a), f));
}
export function roundParameter(c: CadRound, p: Point): number | undefined {
  if (Math.abs(distance(c.center, p) - c.radius) > EPS * 2) return;
  if (distance(curvePoint(c, 0), p) <= EPS) return 0;
  if (!c.closed && distance(curvePoint(c, c.total), p) <= EPS) return c.total;
  const delta = normAngle(
    Math.sign(c.sweep) *
      (Math.atan2(p.y - c.center.y, p.x - c.center.x) - c.start),
  );
  if (!c.closed && delta > Math.abs(c.sweep) + EPS / c.radius) return;
  return Math.min(c.total, delta * c.radius);
}
export function nearestCurve(
  c: CadCurve,
  p: Point,
): {
  point: Point;
  at: number;
  distance: number;
  segment: number;
  ambiguous?: boolean;
} {
  if (c.kind === 'round') {
    const radial = distance(c.center, p),
      angle = Math.atan2(p.y - c.center.y, p.x - c.center.x);
    const q = {
      x: c.center.x + c.radius * Math.cos(angle),
      y: c.center.y + c.radius * Math.sin(angle),
    };
    const t = radial > EPS ? roundParameter(c, q) : undefined;
    if (t !== undefined)
      return {
        point: q,
        at: t,
        distance: Math.abs(radial - c.radius),
        segment: 0,
      };
    const a = curvePoint(c, 0),
      b = curvePoint(c, c.total);
    return distance(p, a) <= distance(p, b)
      ? {
          point: a,
          at: 0,
          distance: distance(p, a),
          segment: 0,
          ambiguous: radial <= EPS,
        }
      : {
          point: b,
          at: c.total,
          distance: distance(p, b),
          segment: 0,
          ambiguous: radial <= EPS,
        };
  }
  let best: {
    point: Point;
    at: number;
    distance: number;
    segment: number;
    ambiguous?: boolean;
  } = { point: c.points[0], at: 0, distance: Infinity, segment: 0 };
  for (let i = 1; i < c.lengths.length; i++) {
    const a = c.points[i - 1],
      b = c.points[i % c.points.length],
      q = nearest(p, a, b),
      d = distance(p, q),
      at = c.lengths[i - 1] + distance(a, q);
    if (d < best.distance - EPS)
      best = {
        point: q,
        at,
        distance: d,
        segment: i - 1,
      };
    else if (
      Math.abs(d - best.distance) <= EPS &&
      Math.abs(at - best.at) > EPS &&
      (!c.closed || Math.abs(Math.abs(at - best.at) - c.total) > EPS)
    )
      best.ambiguous = true;
  }
  return best;
}
export type IntersectionBudget = { count: number; limit: number };
export const intersectionBudget = (): IntersectionBudget => ({
  count: 0,
  limit: 250000,
});
function tick(b: IntersectionBudget) {
  if (++b.count > b.limit)
    throw new Error(
      'Limites complexos demais para esta operação (250 mil comparações). Selecione menos referências ou simplifique o CAD.',
    );
}
const inRange = (t: number, len: number) => t >= -EPS && t <= len + EPS;
function lineLine(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  ray: boolean,
): Point[] {
  const u = minus(b, a),
    v = minus(d, c),
    lu = distance(a, b),
    lv = distance(c, d),
    det = cross(u, v),
    ca = minus(c, a);
  if (lu < EPS || lv < EPS) return [];
  if (Math.abs(det) <= lu * lv * 1e-12) {
    if (Math.abs(cross(ca, u)) / lu > EPS) return [];
    const x = dot(ca, u) / lu,
      y = dot(minus(d, a), u) / lu,
      lo = Math.max(0, Math.min(x, y)),
      hi = Math.min(ray ? Infinity : lu, Math.max(x, y));
    if (hi < lo - EPS) return [];
    if (hi - lo > EPS)
      throw new Error(
        'Limites colineares/sobrepostos: escolha uma referência transversal inequívoca.',
      );
    return [plus(a, times(u, Math.max(0, lo) / lu))];
  }
  const t = cross(ca, v) / det,
    s = cross(ca, u) / det;
  if ((ray ? t * lu >= -EPS : inRange(t * lu, lu)) && inRange(s * lv, lv))
    return [
      plus(a, times(u, ray ? Math.max(0, t) : Math.max(0, Math.min(1, t)))),
    ];
  return [];
}
function lineRound(a: Point, b: Point, c: CadRound, ray: boolean): Point[] {
  const len = distance(a, b);
  if (len < EPS) return [];
  const u = times(minus(b, a), 1 / len),
    mid = dot(minus(c.center, a), u),
    foot = plus(a, times(u, mid)),
    off = distance(foot, c.center);
  if (off > c.radius + EPS) return [];
  const h = Math.sqrt(Math.max(0, (c.radius - off) * (c.radius + off)));
  return uniquePoints(
    [mid - h, mid + h]
      .filter((t) => (ray ? t >= -EPS : inRange(t, len)))
      .map((t) =>
        plus(a, times(u, ray ? Math.max(0, t) : Math.max(0, Math.min(len, t)))),
      )
      .filter((p) => roundParameter(c, p) !== undefined),
  );
}
function roundRound(a: CadRound, b: CadRound): Point[] {
  const d = distance(a.center, b.center);
  if (d < EPS && Math.abs(a.radius - b.radius) < EPS)
    throw new Error('Curvas coincidentes: limite ambíguo, sem alteração.');
  if (
    d < EPS ||
    d > a.radius + b.radius + EPS ||
    d < Math.abs(a.radius - b.radius) - EPS
  )
    return [];
  const x = ((a.radius - b.radius) * (a.radius + b.radius) + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, (a.radius - x) * (a.radius + x))),
    u = times(minus(b.center, a.center), 1 / d),
    mid = plus(a.center, times(u, x)),
    n = { x: -u.y, y: u.x };
  return uniquePoints(
    [plus(mid, times(n, h)), plus(mid, times(n, -h))].filter(
      (p) =>
        roundParameter(a, p) !== undefined &&
        roundParameter(b, p) !== undefined,
    ),
  );
}
export function uniquePoints(points: Point[]) {
  const out: Point[] = [],
    buckets = new Map<string, Point[]>();
  for (const p of points) {
    const x = Math.floor(p.x / EPS),
      y = Math.floor(p.y / EPS);
    let duplicate = false;
    for (let dx = -1; dx <= 1 && !duplicate; dx++)
      for (let dy = -1; dy <= 1 && !duplicate; dy++)
        duplicate = (buckets.get(`${x + dx}:${y + dy}`) ?? []).some(
          (q) => distance(p, q) <= EPS,
        );
    if (duplicate) continue;
    out.push(p);
    const key = `${x}:${y}`,
      bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  return out;
}
function segments(p: CadPath) {
  return p.lengths
    .slice(1)
    .map((_, i) => [p.points[i], p.points[(i + 1) % p.points.length]] as const);
}
export function curveIntersections(
  a: CadCurve,
  b: CadCurve,
  budget = intersectionBudget(),
): Point[] {
  const out: Point[] = [];
  if (a.kind === 'round' && b.kind === 'round') {
    tick(budget);
    return roundRound(a, b);
  }
  if (a.kind === 'path' && b.kind === 'round')
    for (const [x, y] of segments(a)) {
      tick(budget);
      out.push(...lineRound(x, y, b, false));
    }
  else if (a.kind === 'round' && b.kind === 'path')
    for (const [x, y] of segments(b)) {
      tick(budget);
      out.push(...lineRound(x, y, a, false));
    }
  else if (a.kind === 'path' && b.kind === 'path')
    for (const [x, y] of segments(a))
      for (const [v, w] of segments(b)) {
        tick(budget);
        if (
          Math.max(x.x, y.x) + EPS < Math.min(v.x, w.x) ||
          Math.max(v.x, w.x) + EPS < Math.min(x.x, y.x) ||
          Math.max(x.y, y.y) + EPS < Math.min(v.y, w.y) ||
          Math.max(v.y, w.y) + EPS < Math.min(x.y, y.y)
        )
          continue;
        out.push(...lineLine(x, y, v, w, false));
      }
  return uniquePoints(out);
}
export function rayIntersections(
  tip: Point,
  direction: Point,
  b: CadCurve,
  budget = intersectionBudget(),
): Point[] {
  const end = plus(tip, direction),
    out: Point[] = [];
  if (b.kind === 'round') {
    tick(budget);
    return lineRound(tip, end, b, true);
  }
  for (const [a, z] of segments(b)) {
    tick(budget);
    out.push(...lineLine(tip, end, a, z, true));
  }
  return uniquePoints(out);
}
export function curveSlice(c: CadCurve, from: number, to: number): CadCurve {
  if (to - from < EPS)
    throw new Error('O corte produziria um remanescente curto demais.');
  if (c.kind === 'round')
    return roundCurve(
      c.center,
      c.radius,
      c.start + (Math.sign(c.sweep) * from) / c.radius,
      (Math.sign(c.sweep) * (to - from)) / c.radius,
      false,
    );
  const pts = [curvePoint(c, from)];
  for (
    let lap = c.closed ? Math.floor(from / c.total) : 0;
    lap <= (c.closed ? Math.floor(to / c.total) : 0);
    lap++
  )
    for (let i = 1; i < c.lengths.length; i++) {
      const t = c.lengths[i] + lap * c.total;
      if (t > from + EPS && t < to - EPS)
        pts.push(c.points[i % c.points.length]);
    }
  pts.push(curvePoint(c, to));
  return pathCurve(pts, false);
}
export function trimCurve(c: CadCurve, limits: CadCurve[], click: Point) {
  if (![click.x, click.y].every(Number.isFinite))
    throw new Error('Clique com coordenadas finitas é obrigatório.');
  const budget = intersectionBudget(),
    parameters: number[] = [];
  for (const limit of limits)
    for (const p of curveIntersections(c, limit, budget)) {
      // Include projection work in the same bounded operation budget.
      if (c.kind === 'path') budget.count += c.lengths.length - 2;
      tick(budget);
      const hit = nearestCurve(c, p);
      if (hit.ambiguous)
        throw new Error(
          'Interseção em caminho sobreposto/autocruzado é ambígua. Use limites afastados do cruzamento.',
        );
      const t = c.kind === 'round' ? roundParameter(c, p) : hit.at;
      if (t !== undefined) parameters.push(t);
    }
  parameters.sort((a, b) => a - b);
  const cuts: number[] = [];
  for (const t of parameters)
    if (!cuts.length || t - cuts.at(-1)! > EPS) cuts.push(t);
  if (
    c.closed &&
    cuts.length > 1 &&
    Math.abs(c.total - cuts.at(-1)! + cuts[0]) <= EPS
  )
    cuts.pop();
  const hit = nearestCurve(c, click);
  if (hit.ambiguous)
    throw new Error(
      'Trecho ambíguo no cruzamento: clique afastado da sobreposição.',
    );
  const at = hit.at;
  if (
    cuts.some(
      (t) =>
        Math.abs(t - at) <= EPS ||
        (c.closed && Math.abs(Math.abs(t - at) - c.total) <= EPS),
    )
  )
    throw new Error('Clique dentro do trecho a remover, afastado do encontro.');
  if (c.closed) {
    if (cuts.length < 2)
      throw new Error(
        'Contorno fechado exige dois encontros distintos; uma tangência não define um intervalo removível.',
      );
    let hi = cuts.find((t) => t > at);
    const lo =
      [...cuts].reverse().find((t) => t < at) ?? cuts.at(-1)! - c.total;
    if (hi === undefined) hi = cuts[0] + c.total;
    return {
      remaining: [curveSlice(c, hi, lo + c.total)],
      change: curveSlice(c, lo, hi),
    };
  }
  const inner = cuts.filter((t) => t > EPS && t < c.total - EPS);
  if (!inner.length)
    throw new Error(
      'Sem interseção interior utilizável; encontro em ponta não apaga a entidade.',
    );
  const lo = [...inner].reverse().find((t) => t < at) ?? 0,
    hi = inner.find((t) => t > at) ?? c.total;
  const remaining: CadCurve[] = [];
  if (lo > EPS) remaining.push(curveSlice(c, 0, lo));
  if (hi < c.total - EPS) remaining.push(curveSlice(c, hi, c.total));
  if (!remaining.length)
    throw new Error('Nenhum remanescente válido; corte recusado.');
  return { remaining, change: curveSlice(c, lo, hi) };
}
export function extendCurve(c: CadCurve, limits: CadCurve[], click: Point) {
  if (![click.x, click.y].every(Number.isFinite))
    throw new Error('Clique com coordenadas finitas é obrigatório.');
  if (c.closed)
    throw new Error(
      'Círculos e contornos fechados não têm extremidade aberta para Estender.',
    );
  const hit = nearestCurve(c, click),
    budget = intersectionBudget();
  if (hit.ambiguous)
    throw new Error(
      'Ponta ambígua em caminho sobreposto/autocruzado. Clique em uma extremidade inequívoca.',
    );
  if (c.kind === 'round' || c.points.length === 2) {
    if (Math.abs(hit.at - c.total / 2) <= EPS)
      throw new Error(
        'Ponta ambígua: clique mais perto da extremidade desejada.',
      );
  } else if (c.lengths.slice(1, -1).some((n) => Math.abs(n - hit.at) <= EPS))
    throw new Error(
      'Vértice intermediário ambíguo: clique no trecho terminal junto à ponta desejada.',
    );
  if (c.kind === 'round') {
    const first = hit.at < c.total / 2,
      tip = curvePoint(c, first ? 0 : c.total),
      direction = Math.sign(c.sweep) * (first ? -1 : 1),
      circle = roundCurve(c.center, c.radius, 0, TAU, true),
      available = TAU - Math.abs(c.sweep);
    const candidates: { delta: number; point: Point }[] = [];
    for (const limit of limits)
      for (const p of curveIntersections(circle, limit, budget)) {
        if (distance(p, tip) <= EPS)
          throw new Error(
            'A ponta já está em um limite; nenhum prolongamento aplicado.',
          );
        const delta = normAngle(
          direction *
            (Math.atan2(p.y - c.center.y, p.x - c.center.x) -
              Math.atan2(tip.y - c.center.y, tip.x - c.center.x)),
        );
        if (delta * c.radius > EPS && delta < available - EPS / c.radius)
          candidates.push({ delta, point: p });
      }
    candidates.sort((a, b) => a.delta - b.delta);
    const nearest = candidates[0];
    if (!nearest)
      throw new Error(
        'Sem limite finito adiante antes de fechar/sobrepor o arco.',
      );
    const sweep = c.sweep + Math.sign(c.sweep) * nearest.delta,
      start = first ? c.start - Math.sign(c.sweep) * nearest.delta : c.start;
    const result = roundCurve(c.center, c.radius, start, sweep);
    const change = first
      ? roundCurve(
          c.center,
          c.radius,
          start,
          Math.sign(c.sweep) * nearest.delta,
        )
      : roundCurve(
          c.center,
          c.radius,
          c.start + c.sweep,
          Math.sign(c.sweep) * nearest.delta,
        );
    return { remaining: [result], change };
  }
  const last = c.points.length - 1;
  let first: boolean;
  if (last === 1) first = hit.at < c.total / 2;
  else if (hit.segment === 0) first = true;
  else if (hit.segment === last - 1) first = false;
  else
    throw new Error(
      'Clique no trecho inicial ou final da polilinha, junto à ponta desejada.',
    );
  const tip = c.points[first ? 0 : last],
    previous = c.points[first ? 1 : last - 1],
    direction = times(minus(tip, previous), 1 / distance(tip, previous)),
    points: Point[] = [];
  for (const limit of limits)
    for (const p of rayIntersections(tip, direction, limit, budget)) {
      if (distance(p, tip) <= EPS)
        throw new Error(
          'A ponta já está em um limite; nenhum prolongamento aplicado.',
        );
      if (dot(minus(p, tip), direction) > EPS) points.push(p);
    }
  points.sort((a, b) => distance(a, tip) - distance(b, tip));
  const end = points[0];
  if (!end)
    throw new Error(
      'Sem interseção finita adiante da ponta escolhida; paralelos ou encontros para trás não estendem.',
    );
  const change = pathCurve([tip, end], false);
  for (let i = 0; i < last; i++) {
    if (first ? i === 0 : i === last - 1) continue;
    const edge = pathCurve([c.points[i], c.points[i + 1]], false);
    if (
      curveIntersections(change, edge, budget).some(
        (p) => distance(p, tip) > EPS,
      )
    )
      throw new Error(
        'O prolongamento autointersectaria a polilinha; operação recusada.',
      );
  }
  return {
    remaining: [
      pathCurve(
        c.points.map((p, i) => (i === (first ? 0 : last) ? end : p)),
        false,
      ),
    ],
    change,
  };
}
