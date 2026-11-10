import { maskPoint } from '../cad/import';
import { nativePoints } from './nativeMasks';
import { contourKindLabel, measurePolyline } from './maskContourMeasure';
import {
  facesContaining,
  pointInPolygon,
  signedArea,
  type FaceCycle,
  type FacePath,
} from './planarFaces';
import type { Mask, Point, Primitive } from './types';

export { signedArea };

/**
 * Região de lançamento de telas soldadas: contorno externo e aberturas, em mm
 * do modelo. A transformação da máscara (origem, escala, rotação) é aplicada
 * uma única vez, na captura; a região guardada é estática (não segue a máscara).
 *
 * Tolerâncias (documentadas em docs/TELAS-SOLDADAS.md):
 * - REGION_POINT_TOLERANCE: vértices a até 0,01 mm são o mesmo ponto; pontas de
 *   um contorno aberto a até 0,01 mm contam como fechadas.
 * - REGION_MAX_CLOSURE_GAP: lacuna de até 1 mm pode ser fechada por ajuste, sempre
 *   sinalizada para prévia e confirmação; acima disso o contorno é recusado.
 * - REGION_CURVE_TOLERANCE: círculos viram polígonos inscritos com erro radial
 *   máximo de 0,05 mm medido no modelo (independe da escala da máscara).
 * - Aberturas a até 0,01 mm do contorno externo ou de outra abertura são tratadas
 *   como encostadas e recusadas.
 * - Clique interno: faces das entidades recebidas (planarFaces.ts), com nós a
 *   0,01 mm, pontes de lacuna até 1 mm (com confirmação) e no máximo
 *   REGION_MAX_CLICK_SEGMENTS segmentos.
 */
export const REGION_POINT_TOLERANCE = 0.01;
export const REGION_MAX_CLOSURE_GAP = 1;
export const REGION_CURVE_TOLERANCE = 0.05;
export const REGION_MAX_VERTICES = 50000;
export const REGION_MAX_CLICK_SEGMENTS = 20000;
const MAX_CIRCLE_SEGMENTS = 4096;
const LIMIT = 1e9;

export type RegionExactness = 'exact' | 'approximation';
/** closed: entidade fechada; coincident: pontas a até 0,01 mm; adjusted: lacuna fechada por ajuste. */
export type RegionClosure = 'closed' | 'coincident' | 'adjusted';
export type RegionOutline = {
  /** mm do modelo, sem repetir o vértice inicial no fim. */
  points: Point[];
  /** mm² */
  area: number;
  exactness: RegionExactness;
  closure: RegionClosure;
  /** mm: maior lacuna fechada por ajuste (ou entre pontas); 0 quando fechada. */
  gap: number;
  /** mm: todas as lacunas fechadas por ajuste (vazia se nenhuma). */
  gaps: number[];
  kind: string;
  notes: string[];
};
export type OutlineResult =
  | { ok: true; outline: RegionOutline }
  | { ok: false; reason: string };
/** Contorno externo anti-horário; aberturas horárias. */
export type WeldedMeshRegion = { outer: Point[]; openings: Point[][] };
export type RegionResult =
  | {
      ok: true;
      region: WeldedMeshRegion;
      /** mm²: área do contorno externo menos as aberturas (antes de afastamentos). */
      area: number;
      grossArea: number;
      openingsArea: number;
      exactness: RegionExactness;
      /** Há lacuna fechada por ajuste: a interface deve exigir confirmação. */
      needsConfirmation: boolean;
      adjustments: string[];
      notes: string[];
    }
  | { ok: false; reason: string };

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
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const tooMany = (count: number) =>
  `Região com vértices demais: ${fmt(count)} (limite de ${fmt(REGION_MAX_VERTICES)} vértices).`;
const invalidTransform = (m: Mask) =>
  !Number.isFinite(m.scale) ||
  m.scale <= 0 ||
  ![m.rotation, m.origin.x, m.origin.y].every(Number.isFinite);
const INVALID_TRANSFORM =
  'Transformação da máscara inválida: a região não pode ser obtida.';

/** Une vértices consecutivos a até REGION_POINT_TOLERANCE. */
function mergeRepeated(points: Point[]) {
  const out: Point[] = [];
  let merged = 0;
  for (const p of points) {
    if (out.length && dist(out[out.length - 1], p) <= REGION_POINT_TOLERANCE) {
      merged++;
      continue;
    }
    out.push({ x: p.x, y: p.y });
  }
  return { points: out, merged };
}

function closeOutline(
  raw: Point[],
  closedFlag: boolean,
  kind: string,
  exactness: RegionExactness,
  notes: string[],
): OutlineResult {
  if (raw.length > REGION_MAX_VERTICES)
    return { ok: false, reason: tooMany(raw.length) };
  if (!raw.every(finite))
    return {
      ok: false,
      reason: 'Coordenadas não finitas ou fora de ±1.000.000.000 mm.',
    };
  const merged = mergeRepeated(raw);
  let points = merged.points;
  if (merged.merged)
    notes.push(
      `${merged.merged} vértice(s) repetido(s) a até ${fmt(REGION_POINT_TOLERANCE)} mm foram unidos.`,
    );
  const ends = points.length > 1 ? dist(points[0], points.at(-1)!) : 0;
  let closure: RegionClosure = 'closed',
    gap = 0;
  if (closedFlag) {
    // Repetir o primeiro ponto (ou clicar nele de novo) não cria outro lado.
    if (points.length > 1 && ends <= REGION_POINT_TOLERANCE)
      points = points.slice(0, -1);
  } else {
    gap = ends;
    if (gap <= REGION_POINT_TOLERANCE) {
      closure = 'coincident';
      points = points.slice(0, -1);
      notes.push(
        `Extremidades a ${fmt(gap)} mm (até ${fmt(REGION_POINT_TOLERANCE)} mm): tratadas como fechadas.`,
      );
    } else if (gap <= REGION_MAX_CLOSURE_GAP) closure = 'adjusted';
    else
      return {
        ok: false,
        reason: `Contorno aberto: as extremidades estão a ${fmt(gap)} mm (o ajuste de fechamento aceita até ${fmt(REGION_MAX_CLOSURE_GAP)} mm). Feche a entidade na máscara ou use o modo por pontos.`,
      };
  }
  if (points.length < 3)
    return {
      ok: false,
      reason: 'A região exige ao menos três vértices distintos.',
    };
  const m = measurePolyline(points, true, kind, exactness);
  if (!m.ok) return { ok: false, reason: m.reason };
  if (!m.closed)
    return { ok: false, reason: 'O contorno não delimita uma região.' };
  return {
    ok: true,
    outline: {
      points,
      area: m.area,
      exactness,
      closure,
      gap,
      gaps: closure === 'adjusted' ? [gap] : [],
      kind,
      notes,
    },
  };
}

/** Região indicada por pontos: o fechamento é explícito (Enter ou clique no 1º ponto). */
export function outlineFromPoints(points: Point[]): OutlineResult {
  return closeOutline(points, true, 'pontos', 'exact', []);
}

/**
 * Polígono inscrito num círculo/arco já no espaço do modelo (ângulos em rad,
 * anti-horário +). Cada lado abrange θ e tem flecha r·(1 − cos(θ/2)) ≤ 0,05 mm.
 */
function curvePoints(
  c: Point,
  r: number,
  start: number,
  sweep: number,
  closed: boolean,
) {
  const ratio = Math.min(1, REGION_CURVE_TOLERANCE / r);
  const needed = Math.ceil(Math.abs(sweep) / (2 * Math.acos(1 - ratio)));
  const n = Math.min(MAX_CIRCLE_SEGMENTS, Math.max(closed ? 8 : 1, needed));
  const points = Array.from({ length: closed ? n : n + 1 }, (_, i) => {
    const a = start + (sweep * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
  const error = r * (1 - Math.cos(Math.abs(sweep) / (2 * n)));
  return { points, n, needed, error };
}

function circleOutline(c: Point, r: number, kind: string): OutlineResult {
  if (
    !finite(c) ||
    !Number.isFinite(r) ||
    r <= 0 ||
    Math.abs(c.x) + r > LIMIT ||
    Math.abs(c.y) + r > LIMIT
  )
    return { ok: false, reason: 'Centro/raio fora dos limites do modelo.' };
  const { points, n, needed, error } = curvePoints(c, r, 0, 2 * Math.PI, true);
  const notes = [
    `Círculo representado por polígono de ${n} lados, com erro radial máximo de ${fmt(error)} mm (tolerância de ${fmt(REGION_CURVE_TOLERANCE)} mm).`,
  ];
  if (needed > MAX_CIRCLE_SEGMENTS)
    notes.push(
      `Raio grande: limitado a ${fmt(MAX_CIRCLE_SEGMENTS)} lados, acima da tolerância.`,
    );
  return closeOutline(points, true, kind, 'approximation', notes);
}

/** Região a partir de uma entidade fechada da máscara, em mm do modelo. */
export function outlineFromMaskEntity(m: Mask, q: Primitive): OutlineResult {
  const kind = contourKindLabel(q, m);
  if (invalidTransform(m)) return { ok: false, reason: INVALID_TRANSFORM };
  if (q.text || q.native?.kind === 'text')
    return { ok: false, reason: 'Texto não delimita região.' };
  const n = q.native;
  if (n) {
    try {
      nativePoints(n);
    } catch (e) {
      return {
        ok: false,
        reason: `Geometria nativa inválida: ${(e as Error).message}`,
      };
    }
    if (n.kind === 'line')
      return {
        ok: false,
        reason:
          'Linha não delimita região: use um contorno fechado ou o modo por pontos.',
      };
    if (n.kind === 'arc')
      return {
        ok: false,
        reason:
          'Arco aberto não delimita região: use um contorno fechado ou o modo por pontos.',
      };
    if (n.kind === 'circle')
      return circleOutline(maskPoint(n.center, m), n.radius * m.scale, kind);
    return closeOutline(
      nativePoints(n).map((v) => maskPoint(v, m)),
      q.closed ?? n.closed,
      kind,
      'exact',
      [],
    );
  }
  return closeOutline(
    q.points.map((v) => maskPoint(v, m)),
    !!q.closed,
    kind,
    'approximation',
    [
      'Geometria importada/normalizada: a região usa a polilinha disponível; se a entidade original era curva, trata-se da aproximação discretizada.',
    ],
  );
}

function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const ab = sub(b, a),
    len2 = dot(ab, ab);
  const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}
/** Distância entre dois segmentos (0 quando se cruzam ou se tocam). */
function segmentDistance(p1: Point, p2: Point, q1: Point, q2: Point) {
  const d1 = cross(sub(p2, p1), sub(q1, p1)),
    d2 = cross(sub(p2, p1), sub(q2, p1)),
    d3 = cross(sub(q2, q1), sub(p1, q1)),
    d4 = cross(sub(q2, q1), sub(p2, q1));
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    pointSegmentDistance(q1, p1, p2),
    pointSegmentDistance(q2, p1, p2),
    pointSegmentDistance(p1, q1, q2),
    pointSegmentDistance(p2, q1, q2),
  );
}
/**
 * Primeiro par de anéis distintos (menor índice) que se cruzam, se tocam ou
 * ficam a até `tol` mm. Varredura em X mantém casos comuns perto de O(n log n).
 */
function ringContact(
  rings: Point[][],
  tol: number,
): [number, number] | undefined {
  type S = {
    a: Point;
    b: Point;
    ring: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  const segs: S[] = [];
  rings.forEach((pts, ring) =>
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      segs.push({
        a,
        b,
        ring,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      });
    }),
  );
  segs.sort((s, t) => s.minX - t.minX);
  const active: S[] = [];
  let best: [number, number] | undefined;
  for (const s of segs) {
    for (let k = active.length - 1; k >= 0; k--)
      if (active[k].maxX < s.minX - tol) active.splice(k, 1);
    for (const t of active) {
      if (t.ring === s.ring) continue;
      if (t.maxY < s.minY - tol || t.minY > s.maxY + tol) continue;
      if (segmentDistance(s.a, s.b, t.a, t.b) > tol) continue;
      const pair: [number, number] =
        s.ring < t.ring ? [s.ring, t.ring] : [t.ring, s.ring];
      if (
        !best ||
        pair[0] < best[0] ||
        (pair[0] === best[0] && pair[1] < best[1])
      )
        best = pair;
    }
    active.push(s);
  }
  return best;
}

/**
 * Monta a região útil: contorno externo menos aberturas indicadas
 * explicitamente. Nenhum contorno vira abertura sozinho. Qualquer problema
 * recusa a região inteira (sem lançamento parcial).
 */
export function buildRegion(
  outer: RegionOutline,
  openings: RegionOutline[] = [],
): RegionResult {
  const rings = [outer, ...openings];
  const name = (i: number) => (i === 0 ? 'contorno externo' : `abertura ${i}`);
  const total = rings.reduce((s, r) => s + r.points.length, 0);
  if (total > REGION_MAX_VERTICES) return { ok: false, reason: tooMany(total) };
  for (let i = 0; i < rings.length; i++) {
    if (!rings[i].points.every(finite))
      return {
        ok: false,
        reason: `${capitalize(name(i))}: coordenadas não finitas.`,
      };
    const m = measurePolyline(rings[i].points, true, rings[i].kind);
    if (!m.ok)
      return { ok: false, reason: `${capitalize(name(i))}: ${m.reason}` };
  }
  const tol = REGION_POINT_TOLERANCE;
  const contact = ringContact(
    rings.map((r) => r.points),
    tol,
  );
  if (contact) {
    const [i, j] = contact;
    return {
      ok: false,
      reason:
        i === 0
          ? `A abertura ${j} cruza, toca ou fica a até ${fmt(tol)} mm do contorno externo.`
          : `As aberturas ${i} e ${j} se cruzam, se tocam ou ficam a até ${fmt(tol)} mm uma da outra.`,
    };
  }
  // Sem contato, cada anel está inteiro dentro ou fora do outro: um vértice decide.
  for (let j = 1; j < rings.length; j++)
    if (!pointInPolygon(rings[j].points[0], outer.points))
      return {
        ok: false,
        reason: `A abertura ${j} está fora do contorno externo.`,
      };
  for (let j = 1; j < rings.length; j++)
    for (let k = 1; k < rings.length; k++)
      if (j !== k && pointInPolygon(rings[j].points[0], rings[k].points))
        return {
          ok: false,
          reason: `A abertura ${j} está dentro da abertura ${k}: aberturas não podem ficar uma dentro da outra.`,
        };
  const copy = (pts: Point[]) => pts.map((p) => ({ x: p.x, y: p.y }));
  const oriented = (pts: Point[], sign: 1 | -1) =>
    Math.sign(signedArea(pts)) === sign ? copy(pts) : copy(pts).reverse();
  const region: WeldedMeshRegion = {
    outer: oriented(outer.points, 1),
    openings: openings.map((o) => oriented(o.points, -1)),
  };
  const grossArea = Math.abs(signedArea(region.outer));
  const openingsArea = region.openings.reduce(
    (s, o) => s + Math.abs(signedArea(o)),
    0,
  );
  const adjustments = rings.flatMap((r, i) =>
    r.closure === 'adjusted'
      ? [
          r.gaps.length > 1
            ? `${capitalize(name(i))}: ${r.gaps.length} lacunas fechadas por ajuste (maior: ${fmt(r.gap)} mm).`
            : `${capitalize(name(i))}: lacuna de ${fmt(r.gap)} mm fechada por ajuste.`,
        ]
      : [],
  );
  return {
    ok: true,
    region,
    area: grossArea - openingsArea,
    grossArea,
    openingsArea,
    exactness: rings.some((r) => r.exactness === 'approximation')
      ? 'approximation'
      : 'exact',
    needsConfirmation: adjustments.length > 0,
    adjustments,
    notes: rings.flatMap((r, i) =>
      r.notes.map((n) => `${capitalize(name(i))}: ${n}`),
    ),
  };
}

/** Caminhos em mm do modelo das entidades recebidas, para a seleção por clique. */
function entityPaths(m: Mask, primitives: Primitive[]) {
  const paths: FacePath[] = [];
  let invalid = 0;
  const curveNote = `Inclui curva convertida em segmentos com erro radial máximo de ${fmt(REGION_CURVE_TOLERANCE)} mm.`;
  const importedNote =
    'Inclui geometria importada/normalizada: usa a polilinha disponível.';
  const deg = Math.PI / 180;
  for (const q of primitives) {
    if (q.text || q.native?.kind === 'text') continue;
    const n = q.native;
    if (!n) {
      if (q.points.length > 1)
        paths.push({
          points: q.points.map((v) => maskPoint(v, m)),
          closed: !!q.closed,
          approximate: true,
          note: importedNote,
        });
      continue;
    }
    try {
      nativePoints(n);
    } catch {
      invalid++;
      continue;
    }
    if (n.kind === 'circle' || n.kind === 'arc') {
      const c = maskPoint(n.center, m),
        r = n.radius * m.scale;
      const curve =
        n.kind === 'circle'
          ? curvePoints(c, r, 0, 2 * Math.PI, true)
          : curvePoints(
              c,
              r,
              (n.startAngle + m.rotation) * deg,
              n.sweepAngle * deg,
              false,
            );
      paths.push({
        points: curve.points,
        closed: n.kind === 'circle',
        approximate: true,
        note: curveNote,
      });
      continue;
    }
    paths.push({
      points: nativePoints(n).map((v) => maskPoint(v, m)),
      closed: q.closed ?? n.closed,
    });
  }
  return { paths, invalid };
}

function outlineFromCycle(c: FaceCycle, kind: string): OutlineResult {
  const r = closeOutline(
    c.points,
    true,
    kind,
    c.approximate ? 'approximation' : 'exact',
    [...c.notes],
  );
  if (!r.ok || !c.bridges.length) return r;
  const gaps = c.bridges.map((b) => b.length);
  const gap = Math.max(...gaps);
  return {
    ok: true,
    outline: {
      ...r.outline,
      closure: 'adjusted',
      gap,
      gaps,
      notes: [
        ...r.outline.notes,
        `${gaps.length} lacuna(s) entre entidades fechada(s) por ajuste (maior: ${fmt(gap)} mm): confirme na prévia.`,
      ],
    },
  };
}

export type ClickRegionResult =
  | {
      ok: true;
      /** Regiões que contêm o ponto, da menor para a maior. */
      candidates: RegionOutline[];
      /** Por candidata: contornos internos, oferecidos (nunca aplicados) como aberturas. */
      islands: RegionOutline[][];
      notes: string[];
    }
  | { ok: false; reason: string };

/**
 * Região pelo clique interno. A interface passa somente as entidades visíveis e
 * capturáveis da máscara ativa (mesma regra da seleção CAD); camadas ocultas
 * não participam. Uma linha que atravessa a região a divide.
 */
export function outlinesAtPoint(
  m: Mask,
  primitives: Primitive[],
  at: Point,
): ClickRegionResult {
  if (invalidTransform(m)) return { ok: false, reason: INVALID_TRANSFORM };
  const { paths, invalid } = entityPaths(m, primitives);
  const pick = facesContaining(paths, at, {
    snap: REGION_POINT_TOLERANCE,
    bridge: REGION_MAX_CLOSURE_GAP,
    maxSegments: REGION_MAX_CLICK_SEGMENTS,
  });
  if (!pick.ok) return pick;
  const notes = [...pick.notes];
  if (invalid)
    notes.push(`${invalid} entidade(s) com geometria inválida ignorada(s).`);
  const candidates: RegionOutline[] = [];
  const islands: RegionOutline[][] = [];
  let failure = '';
  pick.candidates.forEach((c, i) => {
    const r = outlineFromCycle(c, 'região por clique');
    if (!r.ok) {
      failure ||= r.reason;
      return;
    }
    candidates.push(r.outline);
    islands.push(
      pick.islands[i].flatMap((d) => {
        const o = outlineFromCycle(d, 'contorno interno');
        return o.ok ? [o.outline] : [];
      }),
    );
  });
  if (!candidates.length)
    return {
      ok: false,
      reason: `A região encontrada não é válida: ${failure}`,
    };
  return { ok: true, candidates, islands, notes };
}
