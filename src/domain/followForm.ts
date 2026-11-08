import type { Bar, Point, Project, Segment } from './types';
import { newBar } from './model';
import { maskPoint } from '../cad/import';
import { layerState, objectState } from './layerProfiles';
import { objectHidden } from './visibility';
import {
  add,
  sub,
  mul,
  dot,
  cross,
  unit,
  distance,
  nearest,
  geometry,
  offsetChain,
} from './geometry';

/** Physical endpoint tolerance, independent of camera, mask units and paper scale. */
export const FOLLOW_TOLERANCE_MM = 0.1;
export const MAX_FOLLOW_EDGES = 496;
const EPS = 1e-7;
export type FollowContext = {
  key: string;
  detailId: string;
  scopeDetailId?: string;
};
export type FollowEdge = {
  key: string;
  maskId: string;
  primitiveIndex: number;
  edgeIndex: number;
  a: Point;
  b: Point;
  label: string;
  unsupported?: string;
};
export type FollowChain = {
  points: Point[];
  closed: boolean;
  order: string[];
  adjustments: { original: Point; adjusted: Point; distance: number }[];
};
export type FollowParameters = {
  cover: number;
  diameter: number;
  mandrel: number;
  quantity: number;
  extra: number;
  extraReason: string;
};
export function followEdges(p: Project, context: FollowContext): FollowEdge[] {
  if (
    context.key.startsWith('sheet:') ||
    (context.scopeDetailId && context.scopeDetailId !== context.detailId)
  )
    return [];
  return p.masks
    .flatMap((m) => {
      if (
        p.hierarchy.objectDetails[m.id] !== context.detailId ||
        !m.visible ||
        m.opacity <= 0 ||
        objectHidden(p, context.key, m.id) ||
        !objectState(p, context.key, m).capture
      )
        return [];
      return m.primitives.flatMap((q, primitiveIndex) => {
        if (
          q.text ||
          m.layers[q.layer] === false ||
          (q.layerId && !layerState(p, context.key, q.layerId).capture)
        )
          return [];
        const points = q.points.map((v) => maskPoint(v, m));
        if (points.length > 2 && distance(points[0], points.at(-1)!) < EPS)
          points.pop();
        return points
          .slice(0, q.closed ? points.length : -1)
          .map((a, edgeIndex) => ({
            key: JSON.stringify([m.id, q.id ?? primitiveIndex, edgeIndex]),
            maskId: m.id,
            primitiveIndex,
            edgeIndex,
            a,
            b: points[(edgeIndex + 1) % points.length],
            label: `${m.name} · entidade ${primitiveIndex + 1} · aresta ${edgeIndex + 1}`,
            ...(q.native?.kind === 'circle'
              ? {
                  unsupported:
                    'Círculos não são faces retas. Arcos físicos estão fora deste comando.',
                }
              : {}),
          }));
      });
    })
    .filter((e) => e.b && distance(e.a, e.b) > EPS);
}
const compare = (a: Point, b: Point) => a.x - b.x || a.y - b.y;
function area(points: Point[]) {
  // Translation avoids cancellation for drawings far from the origin.
  return (
    points.reduce(
      (sum, p, i) =>
        sum +
        cross(
          sub(p, points[0]),
          sub(points[(i + 1) % points.length], points[0]),
        ),
      0,
    ) / 2
  );
}
function lineDistance(a: Point, b: Point, c: Point, d: Point) {
  const u = sub(b, a),
    v = sub(d, c),
    den = cross(u, v);
  if (Math.abs(den) > EPS) {
    const t = cross(sub(c, a), v) / den,
      s = cross(sub(c, a), u) / den;
    if (t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS) return 0;
  }
  return Math.min(
    distance(a, nearest(a, c, d)),
    distance(b, nearest(b, c, d)),
    distance(c, nearest(c, a, b)),
    distance(d, nearest(d, a, b)),
  );
}
function checkPath(points: Point[], closed: boolean) {
  const n = points.length - (closed ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (distance(a, b) < 0.01)
      throw new Error('Trecho degenerado ou curto demais.');
    for (let j = i + 1; j < n; j++) {
      const c = points[j],
        d = points[(j + 1) % points.length];
      const adjacent = j === i + 1 || (closed && i === 0 && j === n - 1);
      if (adjacent) {
        const incoming = j === i + 1 ? sub(b, a) : sub(a, b);
        const outgoing = j === i + 1 ? sub(d, c) : sub(c, d);
        if (
          Math.abs(cross(unit(incoming), unit(outgoing))) < EPS &&
          dot(incoming, outgoing) < 0
        )
          throw new Error('Retorno de 180° ou trechos sobrepostos.');
      } else if (lineDistance(a, b, c, d) <= EPS)
        throw new Error(
          'A cadeia possui autointerseção, sobreposição ou encontro ambíguo.',
        );
    }
  }
  if (closed && Math.abs(area(points)) < EPS)
    throw new Error('Contorno fechado sem área.');
}
/** Deterministic endpoint graph: click order and source orientation do not define the route. */
export function buildFollowChain(edges: FollowEdge[]): FollowChain {
  if (!edges.length) throw new Error('Selecione uma ou mais arestas da fôrma.');
  if (edges.length > MAX_FOLLOW_EDGES)
    throw new Error(
      'Use até 496 trechos neste lançamento (limite de 500 vértices da barra).',
    );
  if (new Set(edges.map((e) => e.key)).size !== edges.length)
    throw new Error('Trecho selecionado em duplicidade.');
  if (edges.some((e) => e.unsupported))
    throw new Error(edges.find((e) => e.unsupported)!.unsupported);
  const ends = edges.flatMap((e) => [e.a, e.b]);
  if (ends.some((p) => ![p.x, p.y].every(Number.isFinite)))
    throw new Error('Coordenada de referência inválida.');
  const parent = ends.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++)
      if (distance(ends[i], ends[j]) <= FOLLOW_TOLERANCE_MM)
        parent[root(j)] = root(i);
  const groups = new Map<number, number[]>();
  ends.forEach((_, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const nodes = [...groups.values()].map((members) => {
    for (const i of members)
      for (const j of members)
        if (distance(ends[i], ends[j]) > FOLLOW_TOLERANCE_MM + EPS)
          throw new Error(
            'Encontro ambíguo: o agrupamento transitivo excede 0,1 mm. Corrija as pontas.',
          );
    const sorted = members.map((i) => ends[i]).sort(compare);
    return {
      members,
      point: mul(sorted.reduce(add, { x: 0, y: 0 }), 1 / sorted.length),
      edges: [] as number[],
    };
  });
  const nodeFor = new Map<number, number>();
  nodes.forEach((node, i) =>
    node.members.forEach((member) => nodeFor.set(member, i)),
  );
  const pairs = edges.map((_, i) => [
    nodeFor.get(2 * i)!,
    nodeFor.get(2 * i + 1)!,
  ]);
  const seen = new Set<string>();
  pairs.forEach(([a, b], i) => {
    if (a === b)
      throw new Error('Trecho degenerado dentro da tolerância de encontro.');
    const pair = [a, b].sort((x, y) => x - y).join(':');
    if (seen.has(pair)) throw new Error('Trechos duplicados ou sobrepostos.');
    seen.add(pair);
    nodes[a].edges.push(i);
    nodes[b].edges.push(i);
  });
  if (nodes.some((n) => n.edges.length > 2))
    throw new Error(
      'Cadeia ramificada: retire trechos até existir um único percurso.',
    );
  const tips = nodes
    .map((n, i) => ({ n, i }))
    .filter((v) => v.n.edges.length === 1);
  if (tips.length !== 0 && tips.length !== 2)
    throw new Error('Trechos desconectados: não há uma única cadeia.');
  const closed = tips.length === 0;
  const start = (closed ? nodes.map((n, i) => ({ n, i })) : tips).sort((a, b) =>
    compare(a.n.point, b.n.point),
  )[0].i;
  let current = start;
  const used = new Set<number>(),
    points: Point[] = [],
    order: string[] = [];
  while (true) {
    points.push(nodes[current].point);
    const available = nodes[current].edges
      .filter((e) => !used.has(e))
      .sort((a, b) => {
        const other = (e: number) => pairs[e].find((n) => n !== current)!;
        return compare(nodes[other(a)].point, nodes[other(b)].point);
      });
    if (!available.length) break;
    const e = available[0];
    used.add(e);
    order.push(edges[e].key);
    current = pairs[e].find((n) => n !== current)!;
    if (current === start) break;
  }
  if (used.size !== edges.length)
    throw new Error('Trechos desconectados: selecione apenas um percurso.');
  const adjustments = ends.flatMap((p, i) => {
    const q = nodes[nodeFor.get(i)!].point,
      d = distance(p, q);
    return d > EPS ? [{ original: p, adjusted: q, distance: d }] : [];
  });
  checkPath(points, closed);
  // Collapse only straight, forward, collinear vertices, never a return or a bend.
  let reduced = [...points],
    changed = true;
  while (changed && reduced.length > (closed ? 3 : 2)) {
    changed = false;
    for (let i = closed ? 0 : 1; i < reduced.length - (closed ? 0 : 1); i++) {
      const u = sub(
          reduced[i],
          reduced[(i - 1 + reduced.length) % reduced.length],
        ),
        v = sub(reduced[(i + 1) % reduced.length], reduced[i]);
      if (Math.abs(cross(unit(u), unit(v))) < EPS && dot(u, v) > 0) {
        reduced.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return { points: reduced, closed, order, adjustments };
}
function inside(point: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
export function chooseFollowSide(
  chain: FollowChain,
  point: Point,
  flip = false,
) {
  if (![point.x, point.y].every(Number.isFinite))
    throw new Error('Ponto de lado inválido.');
  const distances = chain.points
    .slice(0, chain.closed ? undefined : -1)
    .map((a, i) => {
      const b = chain.points[(i + 1) % chain.points.length],
        q = nearest(point, a, b);
      return {
        distance: distance(point, q),
        side: cross(unit(sub(b, a)), sub(point, q)),
      };
    });
  const closest = Math.min(...distances.map((d) => d.distance));
  if (closest <= FOLLOW_TOLERANCE_MM)
    throw new Error(
      'Clique afastado da linha para indicar o lado (mais de 0,1 mm).',
    );
  let sign: number;
  if (chain.closed) sign = inside(point, chain.points) ? 1 : -1;
  else {
    const candidates = distances.filter(
      (d) => d.distance <= closest + FOLLOW_TOLERANCE_MM,
    );
    const signs = new Set(
      candidates.map((d) =>
        Math.abs(d.side) <= FOLLOW_TOLERANCE_MM ? 0 : Math.sign(d.side),
      ),
    );
    if (signs.size !== 1 || signs.has(0))
      throw new Error(
        'Lado ambíguo. Clique ao lado de um trecho, longe de sua extensão ou de lados opostos.',
      );
    sign = [...signs][0];
  }
  if (flip) sign *= -1;
  return {
    sign,
    label: chain.closed
      ? sign > 0
        ? 'Interior'
        : 'Exterior'
      : sign > 0
        ? 'Lado esquerdo da cadeia indicada'
        : 'Lado direito da cadeia indicada',
  };
}
function angleOn(s: Extract<Segment, { type: 'arc' }>, p: Point) {
  const tau = 2 * Math.PI,
    angle = Math.atan2(p.y - s.center.y, p.x - s.center.x);
  const sweep =
    (((Math.sign(s.angle) * (angle - s.startAngle)) % tau) + tau) % tau;
  return sweep <= Math.abs(s.angle) + EPS || Math.abs(sweep - tau) < EPS;
}
function pointArc(p: Point, arc: Extract<Segment, { type: 'arc' }>) {
  return Math.min(
    distance(p, arc.a),
    distance(p, arc.b),
    angleOn(arc, p) ? Math.abs(distance(p, arc.center) - arc.radius) : Infinity,
  );
}
/** Analytic distances: no zoom/sampling approximation is used for cover validation. */
export function physicalSegmentDistance(a: Segment, b: Segment): number {
  if (a.type === 'line' && b.type === 'line')
    return lineDistance(a.a, a.b, b.a, b.b);
  if (a.type === 'arc' && b.type === 'line')
    return physicalSegmentDistance(b, a);
  if (a.type === 'line' && b.type === 'arc') {
    let best = Math.min(
      pointArc(a.a, b),
      pointArc(a.b, b),
      distance(b.a, nearest(b.a, a.a, a.b)),
      distance(b.b, nearest(b.b, a.a, a.b)),
    );
    const v = sub(a.b, a.a),
      len = distance(a.a, a.b);
    if (len < EPS) return best;
    const u = unit(v),
      normal = { x: -u.y, y: u.x };
    for (const sign of [-1, 1]) {
      const q = add(b.center, mul(normal, sign * b.radius));
      if (angleOn(b, q))
        best = Math.min(best, distance(q, nearest(q, a.a, a.b)));
    }
    const rel = sub(a.a, b.center),
      linear = 2 * dot(rel, v),
      quadratic = dot(v, v),
      discriminant =
        linear * linear - 4 * quadratic * (dot(rel, rel) - b.radius ** 2);
    if (discriminant >= -EPS)
      for (const t of [
        (-linear + Math.sqrt(Math.max(0, discriminant))) / (2 * quadratic),
        (-linear - Math.sqrt(Math.max(0, discriminant))) / (2 * quadratic),
      ])
        if (t >= -EPS && t <= 1 + EPS && angleOn(b, add(a.a, mul(v, t))))
          return 0;
    return best;
  }
  if (a.type !== 'arc' || b.type !== 'arc') return Infinity;
  let best = Math.min(
    pointArc(a.a, b),
    pointArc(a.b, b),
    pointArc(b.a, a),
    pointArc(b.b, a),
  );
  const d = distance(a.center, b.center),
    u = unit(sub(b.center, a.center));
  for (const sign of [-1, 1])
    for (const other of [-1, 1]) {
      const p = add(a.center, mul(u, sign * a.radius)),
        q = add(b.center, mul(u, other * b.radius));
      if (angleOn(a, p) && angleOn(b, q)) best = Math.min(best, distance(p, q));
    }
  if (
    d > EPS &&
    d <= a.radius + b.radius + EPS &&
    d >= Math.abs(a.radius - b.radius) - EPS
  ) {
    const x = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d),
      h = Math.sqrt(Math.max(0, a.radius ** 2 - x ** 2));
    for (const sign of [-1, 1]) {
      const p = add(
        add(a.center, mul(u, x)),
        mul({ x: -u.y, y: u.x }, sign * h),
      );
      if (angleOn(a, p) && angleOn(b, p)) return 0;
    }
  }
  return best;
}
function closedBarPoints(points: Point[], radius: number) {
  // A generic free bar has open endpoints. Put both at the SAME point on a straight
  // portion, so the existing bend engine rounds EVERY polygon corner exactly once.
  // No closure flag, stirrup family, hook, lap or duplicate closing leg is invented.
  const a = points[0],
    b = points[1],
    u = unit(sub(b, a));
  const trim = (prev: Point, corner: Point, next: Point) => {
    const cosine = dot(unit(sub(corner, prev)), unit(sub(next, corner)));
    return radius * Math.tan(Math.acos(Math.max(-1, Math.min(1, cosine))) / 2);
  };
  const first = trim(points.at(-1)!, a, b),
    last = trim(a, b, points[2]);
  const seam = add(a, mul(u, (first + distance(a, b) - last) / 2));
  return [seam, ...points.slice(1), a, { ...seam }];
}
export function previewFollow(
  edges: FollowEdge[],
  sidePoint: Point | undefined,
  flip: boolean,
  params: FollowParameters,
) {
  const chain = buildFollowChain(edges);
  if (!sidePoint)
    throw new Error('Escolha o lado por clique antes de confirmar.');
  const side = chooseFollowSide(chain, sidePoint, flip);
  const { cover, diameter, mandrel, quantity, extra } = params;
  if (
    ![cover, diameter, mandrel, quantity, extra].every(Number.isFinite) ||
    cover < 0 ||
    cover > 10000 ||
    extra < 0 ||
    extra > 10000 ||
    diameter <= 0 ||
    diameter > 100 ||
    mandrel <= 0 ||
    mandrel > 2000 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100000
  )
    throw new Error(
      'Parâmetros inválidos: use mm, valores finitos e positivos; cobrimento/adicional podem ser zero.',
    );
  if (params.extraReason.length > 200)
    throw new Error('Premissa do adicional: até 200 caracteres.');
  if (extra > 0 && !params.extraReason.trim())
    throw new Error(
      'Informe a premissa do afastamento adicional; nenhuma camada é deduzida automaticamente.',
    );
  const offset = cover + diameter / 2 + extra;
  let points = offsetChain(chain.points, side.sign * offset, chain.closed);
  if (chain.closed) {
    points = points.slice(0, -1);
    checkPath(points, true);
    if (area(points) * area(chain.points) <= 0)
      throw new Error('O offset colapsou ou inverteu o contorno.');
  } else checkPath(points, false);
  const theoretical = points;
  if (chain.closed) points = closedBarPoints(points, (mandrel + diameter) / 2);
  const origin = points[0];
  const bar: Bar = {
    ...newBar('Prévia'),
    id: 'follow-preview',
    origin,
    points: points.map((p) => sub(p, origin)),
    diameter,
    mandrel,
    quantity,
    ...(extra > 0
      ? {
          comment: `Lançamento pela fôrma: cobrimento ${cover} mm; adicional ${extra} mm (${params.extraReason.trim()}); afastamento do eixo ${offset} mm.`,
        }
      : {}),
  };
  const physical = geometry(bar);
  if (physical.errors.length) throw new Error(physical.errors.join(' '));
  const worldSegments = physical.segments.map((s) => ({
    ...s,
    a: add(s.a, origin),
    b: add(s.b, origin),
    ...(s.type === 'arc' ? { center: add(s.center, origin) } : {}),
  })) as Segment[];
  const faces = chain.points
    .slice(0, chain.closed ? undefined : -1)
    .map((a, i) => ({
      type: 'line' as const,
      a,
      b: chain.points[(i + 1) % chain.points.length],
    }));
  for (const s of worldSegments)
    for (const face of faces)
      if (physicalSegmentDistance(s, face) < offset - 1e-5)
        throw new Error(
          'A dobra ou o trajeto viola o afastamento da face selecionada. Ajuste o mandril, o cobrimento ou a seleção; nada foi reduzido automaticamente.',
        );
  const meaningful = worldSegments.filter(
    (s) => distance(s.a, s.b) > EPS || s.type === 'arc',
  );
  for (let i = 0; i < meaningful.length; i++)
    for (let j = i + 1; j < meaningful.length; j++) {
      const apart = Math.min(
        j - i,
        chain.closed ? meaningful.length - (j - i) : Infinity,
      );
      if (apart <= 2) continue; // neighboring legs/bend belong to one continuous local tube
      if (
        physicalSegmentDistance(meaningful[i], meaningful[j]) <
        diameter - 1e-5
      )
        throw new Error(
          'A armadura ou seu envelope se cruza/aproxima de outro trecho. Revise o trajeto.',
        );
    }
  return {
    chain,
    side,
    bar,
    theoretical,
    physical,
    worldSegments,
    offset,
    radius: (mandrel + diameter) / 2,
  };
}
