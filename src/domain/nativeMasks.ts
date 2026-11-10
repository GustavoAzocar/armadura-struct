import { cadDefaults, cadBinding } from './cadDefaults';
import {
  uid,
  type Mask,
  type Primitive,
  type Point,
  type Project,
} from './types';
import { maskPoint } from '../cad/import';
import { validateFreeTextPrimitive } from './textStyle';
export type NativeShape =
  | {
      kind: 'line' | 'rectangle' | 'polyline';
      points: Point[];
      closed: boolean;
    }
  | { kind: 'circle'; center: Point; radius: number }
  | {
      kind: 'arc';
      center: Point;
      radius: number;
      startAngle: number;
      sweepAngle: number;
    }
  /** Free text insertion point; content and typography live on the primitive. */
  | { kind: 'text'; at: Point };
export type NativeDrawKind = Exclude<NativeShape['kind'], 'arc' | 'text'>;
/** Scale analytic data to edit any mask in physical mm along its local axes. */
export function scaleNativeShape(s: NativeShape, k: number): NativeShape {
  if (!Number.isFinite(k) || k <= 0)
    throw new Error('Fator de escala inválido.');
  const point = (p: Point) => ({ x: p.x * k, y: p.y * k });
  if (s.kind === 'text') return { ...s, at: point(s.at) };
  return s.kind === 'circle' || s.kind === 'arc'
    ? { ...s, center: point(s.center), radius: s.radius * k }
    : { ...s, points: s.points.map(point) };
}
export function nativePoints(s: NativeShape): Point[] {
  const valid = (p: Point) =>
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Math.abs(p.x) <= 1e9 &&
    Math.abs(p.y) <= 1e9;
  if (s.kind === 'text') {
    if (!valid(s.at)) throw new Error('Ponto de inserção do texto inválido.');
    return [{ ...s.at }];
  }
  if (s.kind === 'circle' || s.kind === 'arc') {
    if (
      !valid(s.center) ||
      !Number.isFinite(s.radius) ||
      s.radius <= 0 ||
      s.radius > 1e8
    )
      throw new Error('Centro e raio positivos e finitos são obrigatórios.');
    if (
      s.kind === 'arc' &&
      (!Number.isFinite(s.startAngle) ||
        !Number.isFinite(s.sweepAngle) ||
        Math.abs(s.startAngle) > 360000 ||
        Math.abs(s.sweepAngle) <= 1e-10 ||
        Math.abs(s.sweepAngle) >= 360)
    )
      throw new Error(
        'Arco requer ângulo inicial finito e abertura não nula inferior a 360°.',
      );
    // Maximum radial chord error 0.05 local mm, capped at 100000 points.
    const n = Math.max(
      32,
      Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 0.05 / s.radius))),
    );
    if (n > 99999) throw new Error('Círculo excede o limite de discretização.');
    const sweep =
      s.kind === 'arc' ? (s.sweepAngle * Math.PI) / 180 : 2 * Math.PI;
    const start = s.kind === 'arc' ? (s.startAngle * Math.PI) / 180 : 0;
    const steps =
      s.kind === 'arc'
        ? Math.max(1, Math.ceil((n * Math.abs(sweep)) / (2 * Math.PI)))
        : n;
    return Array.from({ length: s.kind === 'arc' ? steps + 1 : n }, (_, i) => ({
      x: s.center.x + s.radius * Math.cos(start + (i * sweep) / steps),
      y: s.center.y + s.radius * Math.sin(start + (i * sweep) / steps),
    }));
  }
  if (s.points.length < 2 || s.points.length > 500 || !s.points.every(valid))
    throw new Error('Informe de 2 a 500 pontos finitos.');
  if (
    s.points.some(
      (p, i) =>
        i &&
        Math.hypot(p.x - s.points[i - 1].x, p.y - s.points[i - 1].y) < 1e-6,
    )
  )
    throw new Error('Pontos consecutivos coincidentes.');
  if (s.kind === 'line' && s.points.length !== 2)
    throw new Error('Linha requer dois pontos.');
  if (s.kind === 'rectangle') {
    if (s.points.length !== 2) throw new Error('Retângulo requer dois cantos.');
    const [a, b] = s.points;
    if (Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6)
      throw new Error('Retângulo requer largura e altura positivas.');
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }
  if (s.closed && s.points.length < 3)
    throw new Error('Fechamento requer três vértices.');
  return s.points.map((p) => ({ ...p }));
}
export function nativePrimitive(
  shape: NativeShape,
  id: string = uid(),
  layer = 'DESENHO',
): Primitive {
  return {
    id,
    native: structuredClone(shape),
    layer,
    points: nativePoints(shape),
    closed:
      shape.kind === 'circle' ||
      shape.kind === 'rectangle' ||
      (shape.kind !== 'arc' && shape.kind !== 'text' && shape.closed),
  };
}
export function newNativeMask(name: string, p?: Project): Mask {
  if (!name.trim() || name.trim().length > 200)
    throw new Error('Nome da máscara: 1 a 200 caracteres.');
  return {
    id: uid(),
    name: name.trim(),
    format: 'NATIVE',
    primitives: [],
    layers: { DESENHO: true },
    visible: true,
    opacity: 1,
    scale: 1,
    origin: { x: 0, y: 0 },
    rotation: 0,
    sourceUnit: 'mm',
    warnings: [],
    ...(p?.cadDefaults
      ? {
          ...cadBinding(p, cadDefaults(p).masks.mask),
          opacity: cadDefaults(p).masks.opacity,
        }
      : {}),
  };
}
export function localMaskPoint(p: Point, m: Mask): Point {
  const t = (-m.rotation * Math.PI) / 180,
    x = (p.x - m.origin.x) / m.scale,
    y = (p.y - m.origin.y) / m.scale;
  return {
    x: x * Math.cos(t) - y * Math.sin(t),
    y: x * Math.sin(t) + y * Math.cos(t),
  };
}
export function shapeFromWorld(
  kind: NativeDrawKind,
  points: Point[],
  m: Mask,
  closed = false,
): NativeShape {
  const local = points.map((p) => localMaskPoint(p, m));
  return kind === 'circle'
    ? {
        kind,
        center: local[0],
        radius: Math.hypot(local[1].x - local[0].x, local[1].y - local[0].y),
      }
    : { kind, points: local, closed };
}
export function validateNativeMask(m: Mask) {
  const ids = new Set<string>();
  for (const p of m.primitives) {
    if (p.id && ids.has(p.id))
      throw new Error('ID de entidade de máscara repetido.');
    if (p.id) ids.add(p.id);
    if (m.format !== 'NATIVE' && !p.native) continue;
    if (!p.id || !p.native)
      throw new Error('Entidade nativa sem identidade única ou geometria.');
    const expected = nativePrimitive(p.native, p.id, p.layer);
    if (
      expected.points.length !== p.points.length ||
      expected.points.some(
        (q, i) =>
          Math.abs(q.x - p.points[i].x) > 1e-6 + Math.abs(q.x) * 1e-12 ||
          Math.abs(q.y - p.points[i].y) > 1e-6 + Math.abs(q.y) * 1e-12,
      ) ||
      expected.closed !== p.closed
    )
      throw new Error('Representação da entidade nativa inconsistente.');
    if ((p.native.kind === 'text') !== (p.text !== undefined))
      throw new Error(
        'Texto livre requer conteúdo e ponto de inserção nativos.',
      );
    if (p.native.kind === 'text') validateFreeTextPrimitive(p);
  }
}
export function nativeWorldPrimitive(s: NativeShape, m: Mask): Primitive {
  const p = nativePrimitive(s);
  return { ...p, points: p.points.map((v) => maskPoint(v, m)) };
}
