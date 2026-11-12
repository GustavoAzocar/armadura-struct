import type { Point } from './types';

/**
 * Faces fechadas formadas por um conjunto de caminhos no plano (arranjo planar),
 * para achar a região que contém um ponto clicado. Geometria pura, em mm.
 *
 * 1. Os caminhos viram segmentos; cada segmento é cortado onde cruza ou toca
 *    outro, inclusive quando uma ponta fica a até `snap` mm de outro segmento.
 * 2. Pontos a até `snap` mm viram o mesmo nó (o primeiro inserido é mantido,
 *    então os vértices originais conservam as coordenadas exatas).
 * 3. Uma ponta solta a até `bridge` mm de outro nó ou segmento ganha uma ponte
 *    registrada (lacuna fechada por ajuste), salvo se o alvo já estiver ligado a
 *    ela por um caminho curto: a sobra de uma linha além do canto não vira ponte.
 * 4. Trechos que não fecham nada (pontas soltas restantes) são descartados.
 * 5. Percorrendo a rede sempre pela próxima aresta no sentido horário, cada
 *    volta é uma face; faces limitadas saem no sentido anti-horário (área > 0).
 *
 * Nenhum contorno interno vira abertura: as faces contidas na região escolhida
 * são devolvidas à parte (`islands`) para o usuário decidir.
 */
export type FacePath = {
  points: Point[];
  closed: boolean;
  /** Trecho aproximado: curva discretizada ou polilinha importada. */
  approximate?: boolean;
  /** Aviso levado às faces que usam este caminho. */
  note?: string;
};
export type FaceBridge = { from: Point; to: Point; length: number };
export type FaceCycle = {
  /** Sentido anti-horário, mm. */
  points: Point[];
  /** mm² */
  area: number;
  approximate: boolean;
  notes: string[];
  bridges: FaceBridge[];
};
export type FaceOptions = {
  /** mm: pontos mais próximos que isso são o mesmo nó. */
  snap: number;
  /** mm: maior lacuna que uma ponta solta pode fechar por ajuste. */
  bridge: number;
  maxSegments: number;
};
export type FacePick =
  | {
      ok: true;
      /** Faces que contêm o ponto, da menor para a maior. */
      candidates: FaceCycle[];
      /** Para cada candidata, as faces internas maximais (possíveis aberturas). */
      islands: FaceCycle[][];
      notes: string[];
    }
  | { ok: false; reason: string };

const LIMIT = 1e9;
/** Acima disso (pontas soltas × arestas), só pontes entre pontas são buscadas. */
const EDGE_SCAN_BUDGET = 2e7;

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const finite = (p: Point) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Math.abs(p.x) <= LIMIT &&
  Math.abs(p.y) <= LIMIT;
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Área com sinal (positiva no sentido anti-horário), relativa ao 1º vértice. */
export function signedArea(points: Point[]) {
  if (points.length < 3) return 0;
  const o = points[0];
  let twice = 0;
  for (let i = 1; i < points.length - 1; i++)
    twice += cross(sub(points[i], o), sub(points[i + 1], o));
  return twice / 2;
}

/** Teste do raio; o ponto não deve estar sobre a borda. */
export function pointInPolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function project(p: Point, a: Point, b: Point) {
  const ab = sub(b, a),
    len2 = dot(ab, ab);
  const t = len2 > 0 ? dot(sub(p, a), ab) / len2 : 0;
  const c = Math.min(1, Math.max(0, t));
  const point = { x: a.x + ab.x * c, y: a.y + ab.y * c };
  return { t, point, distance: dist(p, point) };
}

type Segment = { a: Point; b: Point; path: number };
type Edge = { u: number; v: number; path: number; bridge?: number };

/**
 * Pontos de corte entre dois segmentos (cruzamento e pontas encostadas). Uma
 * ponta encostada no meio de outro segmento gera uma âncora sobre ele: a ponta
 * é que vai até a linha, e a linha não se desvia até a ponta.
 */
function cutsBetween(
  s: Segment,
  t: Segment,
  cutsS: Point[],
  cutsT: Point[],
  anchors: Point[],
  snap: number,
) {
  const r = sub(s.b, s.a),
    q = sub(t.b, t.a);
  const ls = Math.hypot(r.x, r.y),
    lt = Math.hypot(q.x, q.y);
  const denom = cross(r, q);
  if (Math.abs(denom) > 1e-12 * ls * lt) {
    const w = sub(t.a, s.a);
    const u = cross(w, q) / denom,
      v = cross(w, r) / denom;
    if (
      u > -snap / ls &&
      u < 1 + snap / ls &&
      v > -snap / lt &&
      v < 1 + snap / lt
    ) {
      const point = { x: s.a.x + r.x * u, y: s.a.y + r.y * u };
      cutsS.push(point);
      cutsT.push(point);
    }
  }
  // Pontas encostadas (junção em T, trechos colineares sobrepostos).
  for (const [e, a, b, cuts] of [
    [t.a, s.a, s.b, cutsS],
    [t.b, s.a, s.b, cutsS],
    [s.a, t.a, t.b, cutsT],
    [s.b, t.a, t.b, cutsT],
  ] as const) {
    const pr = project(e, a, b);
    if (pr.distance > snap) continue;
    cuts.push(pr.point);
    if (pr.t > 0 && pr.t < 1) anchors.push(pr.point);
  }
}

export function facesContaining(
  paths: FacePath[],
  at: Point,
  o: FaceOptions,
): FacePick {
  if (!finite(at)) return { ok: false, reason: 'Ponto clicado inválido.' };
  const total = paths.reduce(
    (s, p) => s + Math.max(0, p.closed ? p.points.length : p.points.length - 1),
    0,
  );
  if (total > o.maxSegments)
    return {
      ok: false,
      reason: `Segmentos demais para a seleção por clique: ${fmt(total)} (limite de ${fmt(o.maxSegments)}). Oculte camadas que não delimitam a região ou use o contorno ou os pontos.`,
    };
  const segments: Segment[] = [];
  for (let p = 0; p < paths.length; p++) {
    const pts = paths[p].points;
    if (!pts.every(finite))
      return {
        ok: false,
        reason: 'Coordenadas não finitas ou fora de ±1.000.000.000 mm.',
      };
    const count = paths[p].closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      if (dist(a, b) > 1e-9) segments.push({ a, b, path: p });
    }
  }
  const snap = o.snap;

  // 1. Cortes: varredura em X sobre as caixas envolventes.
  const cuts: Point[][] = segments.map(() => []);
  const anchors: Point[] = [];
  const order = segments
    .map((_, i) => i)
    .sort(
      (i, j) =>
        Math.min(segments[i].a.x, segments[i].b.x) -
        Math.min(segments[j].a.x, segments[j].b.x),
    );
  let active: number[] = [];
  for (const i of order) {
    const s = segments[i];
    const minX = Math.min(s.a.x, s.b.x),
      minY = Math.min(s.a.y, s.b.y),
      maxY = Math.max(s.a.y, s.b.y);
    active = active.filter(
      (j) => Math.max(segments[j].a.x, segments[j].b.x) >= minX - snap,
    );
    for (const j of active) {
      const t = segments[j];
      if (
        Math.max(t.a.y, t.b.y) < minY - snap ||
        Math.min(t.a.y, t.b.y) > maxY + snap
      )
        continue;
      cutsBetween(s, t, cuts[i], cuts[j], anchors, snap);
    }
    active.push(i);
  }

  // 2. Nós: pontos a até `snap` mm se unem; o primeiro inserido fica. Entram
  // primeiro as âncoras sobre linhas, depois as extremidades, depois os cortes.
  const verts: Point[] = [];
  const snapGrid = new Map<string, number[]>();
  const snapCell = (v: number) => Math.floor(v / snap);
  const vertexOf = (p: Point) => {
    const cx = snapCell(p.x),
      cy = snapCell(p.y);
    let best = -1,
      bestDistance = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of snapGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = dist(verts[id], p);
          if (d <= snap && d < bestDistance) {
            bestDistance = d;
            best = id;
          }
        }
    if (best >= 0) return best;
    verts.push({ x: p.x, y: p.y });
    const key = `${cx},${cy}`;
    const list = snapGrid.get(key);
    if (list) list.push(verts.length - 1);
    else snapGrid.set(key, [verts.length - 1]);
    return verts.length - 1;
  };
  anchors.forEach(vertexOf);
  const ends = segments.map((s) => [vertexOf(s.a), vertexOf(s.b)]);

  // 3. Arestas sem repetição (linhas duplicadas viram uma só).
  const edges = new Map<string, Edge>();
  const adj = new Map<number, Set<number>>();
  const edgeKey = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
  const link = (e: Edge) => {
    if (e.u === e.v || edges.has(edgeKey(e.u, e.v))) return;
    edges.set(edgeKey(e.u, e.v), e);
    for (const [a, b] of [
      [e.u, e.v],
      [e.v, e.u],
    ]) {
      const set = adj.get(a);
      if (set) set.add(b);
      else adj.set(a, new Set([b]));
    }
  };
  const unlink = (u: number, v: number) => {
    edges.delete(edgeKey(u, v));
    adj.get(u)?.delete(v);
    adj.get(v)?.delete(u);
  };
  segments.forEach((s, i) => {
    const r = sub(s.b, s.a),
      len2 = dot(r, r);
    const stops = [
      { t: 0, id: ends[i][0] },
      { t: 1, id: ends[i][1] },
      ...cuts[i].map((p) => ({
        t: Math.min(1, Math.max(0, dot(sub(p, s.a), r) / len2)),
        id: vertexOf(p),
      })),
    ].sort((x, y) => x.t - y.t);
    for (let k = 1; k < stops.length; k++)
      link({ u: stops[k - 1].id, v: stops[k].id, path: s.path });
  });

  // 4. Pontes de lacuna para pontas soltas.
  const notes: string[] = [];
  const degree = (v: number) => adj.get(v)?.size ?? 0;
  const bridgeGrid = new Map<string, number[]>();
  const bridgeCell = (v: number) => Math.floor(v / o.bridge);
  const index = (id: number) => {
    const key = `${bridgeCell(verts[id].x)},${bridgeCell(verts[id].y)}`;
    const list = bridgeGrid.get(key);
    if (list) list.push(id);
    else bridgeGrid.set(key, [id]);
  };
  verts.forEach((_, id) => index(id));
  /** Nós alcançáveis a partir de `start` por caminhos de até `limit` mm. */
  const nearby = (start: number, limit: number) => {
    const best = new Map<number, number>([[start, 0]]);
    const queue: [number, number][] = [[0, start]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, v] = queue.shift()!;
      if (d > (best.get(v) ?? Infinity)) continue;
      for (const w of adj.get(v) ?? []) {
        const next = d + dist(verts[v], verts[w]);
        if (next <= limit && next < (best.get(w) ?? Infinity)) {
          best.set(w, next);
          queue.push([next, w]);
        }
      }
    }
    return new Set(best.keys());
  };
  const loose = [...adj.keys()]
    .filter((v) => degree(v) === 1)
    .sort((a, b) => verts[a].x - verts[b].x || verts[a].y - verts[b].y);
  const scanEdges = loose.length * edges.size <= EDGE_SCAN_BUDGET;
  if (!scanEdges && loose.length)
    notes.push(
      'Muitas pontas soltas: só lacunas entre pontas foram analisadas, não entre ponta e linha.',
    );
  for (const v of loose) {
    if (degree(v) !== 1) continue;
    const p = verts[v];
    const near = nearby(v, 2 * o.bridge);
    let best: { distance: number; to?: number; edge?: Edge; at?: Point } = {
      distance: Infinity,
    };
    const cx = bridgeCell(p.x),
      cy = bridgeCell(p.y);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const w of bridgeGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (near.has(w) || !adj.has(w)) continue;
          const d = dist(p, verts[w]);
          if (d <= o.bridge && d < best.distance) best = { distance: d, to: w };
        }
    if (scanEdges)
      for (const e of edges.values()) {
        if (near.has(e.u) || near.has(e.v)) continue;
        const a = verts[e.u],
          b = verts[e.v];
        if (
          Math.min(a.x, b.x) > p.x + o.bridge ||
          Math.max(a.x, b.x) < p.x - o.bridge ||
          Math.min(a.y, b.y) > p.y + o.bridge ||
          Math.max(a.y, b.y) < p.y - o.bridge
        )
          continue;
        const pr = project(p, a, b);
        if (pr.t <= 0 || pr.t >= 1) continue;
        // Perto de um nó existente: prefere o nó (sem aresta minúscula).
        if (dist(pr.point, a) <= snap || dist(pr.point, b) <= snap) continue;
        if (pr.distance <= o.bridge && pr.distance < best.distance - 1e-12)
          best = { distance: pr.distance, edge: e, at: pr.point };
      }
    if (best.distance > o.bridge) continue;
    let target = best.to;
    if (best.edge && best.at) {
      verts.push({ ...best.at });
      target = verts.length - 1;
      index(target);
      unlink(best.edge.u, best.edge.v);
      link({ u: best.edge.u, v: target, path: best.edge.path });
      link({ u: target, v: best.edge.v, path: best.edge.path });
    }
    link({ u: v, v: target!, path: -1, bridge: best.distance });
  }
  const unresolved = [...adj.keys()].filter((v) => degree(v) === 1).length;

  // 5. Descarta trechos que não fecham nada.
  const queue = [...adj.keys()].filter((v) => degree(v) <= 1);
  while (queue.length) {
    const v = queue.pop()!;
    const around = adj.get(v);
    if (!around || around.size > 1) continue;
    for (const w of [...around]) {
      unlink(v, w);
      if (degree(w) <= 1) queue.push(w);
    }
    adj.delete(v);
  }

  for (const e of edges.values())
    if (project(at, verts[e.u], verts[e.v]).distance <= snap)
      return {
        ok: false,
        reason:
          'Clique sobre uma linha da máscara: clique no interior da região.',
      };

  // 6. Faces: em cada nó, segue a próxima aresta no sentido horário.
  const sorted = new Map<number, number[]>();
  const position = new Map<string, number>();
  for (const [v, around] of adj) {
    const list = [...around].sort(
      (a, b) =>
        Math.atan2(verts[a].y - verts[v].y, verts[a].x - verts[v].x) -
        Math.atan2(verts[b].y - verts[v].y, verts[b].x - verts[v].x),
    );
    sorted.set(v, list);
    list.forEach((w, i) => position.set(`${v}>${w}`, i));
  }
  const visited = new Set<string>();
  type Traced = FaceCycle & {
    ids: number[];
    box: [number, number, number, number];
  };
  const bounded: Traced[] = [];
  const guard = 2 * edges.size + 2;
  for (const [start, list] of sorted)
    for (const first of list) {
      if (visited.has(`${start}>${first}`)) continue;
      const ids: number[] = [];
      let a = start,
        b = first,
        steps = 0;
      while (!visited.has(`${a}>${b}`) && steps++ <= guard) {
        visited.add(`${a}>${b}`);
        ids.push(a);
        const around = sorted.get(b)!;
        const i = position.get(`${b}>${a}`)!;
        const c = around[(i - 1 + around.length) % around.length];
        a = b;
        b = c;
      }
      const points = ids.map((id) => ({ ...verts[id] }));
      const area = signedArea(points);
      if (!(area > snap * snap)) continue;
      const pathsUsed = new Set<number>();
      const bridges: FaceBridge[] = [];
      ids.forEach((id, k) => {
        const next = ids[(k + 1) % ids.length];
        const e = edges.get(edgeKey(id, next));
        if (!e) return;
        if (e.bridge !== undefined)
          bridges.push({ from: verts[id], to: verts[next], length: e.bridge });
        else pathsUsed.add(e.path);
      });
      const used = [...pathsUsed].map((p) => paths[p]);
      const xs = points.map((q) => q.x),
        ys = points.map((q) => q.y);
      bounded.push({
        ids,
        box: [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ],
        points,
        area,
        approximate: used.some((p) => p.approximate),
        notes: [...new Set(used.flatMap((p) => (p.note ? [p.note] : [])))],
        bridges,
      });
    }

  // 7. Faces que contêm o ponto, da menor para a maior.
  const containing = bounded
    .filter((c) => pointInPolygon(at, c.points))
    .sort((a, b) => a.area - b.area);
  if (!containing.length)
    return {
      ok: false,
      reason: `Nenhuma região fechada contém o ponto clicado.${
        unresolved
          ? ` Há ${unresolved} ponta(s) solta(s) na máscara: lacunas acima de ${fmt(o.bridge)} mm não são fechadas.`
          : ''
      }`,
    };
  const inside = (d: Traced, c: Traced) =>
    d !== c &&
    d.box[0] >= c.box[0] &&
    d.box[1] >= c.box[1] &&
    d.box[2] <= c.box[2] &&
    d.box[3] <= c.box[3] &&
    !d.ids.some((id) => c.ids.includes(id)) &&
    pointInPolygon(d.points[0], c.points);
  const strip = ({ ids: _ids, box: _box, ...cycle }: Traced): FaceCycle =>
    cycle;
  const islands = containing.map((c) => {
    const within = bounded.filter((d) => inside(d, c));
    return within.filter((d) => !within.some((e) => inside(d, e))).map(strip);
  });
  return { ok: true, candidates: containing.map(strip), islands, notes };
}
