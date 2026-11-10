import {
  uid,
  type Mask,
  type Point,
  type Primitive,
  type Project,
} from './types';
import { maskPoint } from '../cad/import';
import {
  localMaskPoint,
  nativePrimitive,
  validateNativeMask,
  type NativeShape,
} from './nativeMasks';
import { objectState, layerState } from './layerProfiles';
import { objectHidden } from './visibility';
import type { MaskDrawingContext } from './maskDrawing';
import {
  nearestCurve,
  normAngle,
  pathCurve,
  roundCurve,
  roundParameter,
  curvePoint,
  trimCurve,
  extendCurve,
  TAU,
  MASK_CAD_TOLERANCE,
  type CadCurve,
} from './maskCadGeometry';

export type MaskCadMode = 'trim' | 'extend';
export type MaskEntityRef = {
  maskId: string;
  index: number;
  id?: string;
  primitive: Primitive;
  key: string;
};
export type MaskCadEntity = {
  ref: MaskEntityRef;
  mask: Mask;
  curve?: CadCurve;
  label: string;
  editable: boolean;
  issue?: string;
};
export const sameMaskEntity = (a: MaskEntityRef, b: MaskEntityRef) =>
  a.maskId === b.maskId &&
  (a.primitive === b.primitive || (!!a.id && a.id === b.id));
const rotation = (m: Mask) =>
  Math.atan2(
    Math.sin((m.rotation * Math.PI) / 180),
    Math.cos((m.rotation * Math.PI) / 180),
  );
export function maskCurve(m: Mask, p: Primitive): CadCurve {
  if (p.text)
    throw new Error(
      'Texto/anotação não é uma entidade aparável ou extensível.',
    );
  if (p.native?.kind === 'circle' || p.native?.kind === 'arc') {
    const s = p.native;
    return roundCurve(
      maskPoint(s.center, m),
      s.radius * m.scale,
      rotation(m) + (s.kind === 'arc' ? (s.startAngle * Math.PI) / 180 : 0),
      s.kind === 'arc' ? (s.sweepAngle * Math.PI) / 180 : TAU,
      s.kind === 'circle',
    );
  }
  return pathCurve(
    p.points.map((p) => maskPoint(p, m)),
    !!p.closed,
  );
}
export function maskCadEntities(
  p: Project,
  context: MaskDrawingContext,
): MaskCadEntity[] {
  if (context.key.startsWith('sheet:')) return [];
  return p.masks.flatMap((m) => {
    if (
      (context.scopeDetailId &&
        p.hierarchy.objectDetails[m.id] !== context.scopeDetailId) ||
      !m.visible ||
      m.opacity === 0 ||
      objectHidden(p, context.key, m.id) ||
      !objectState(p, context.key, m).capture
    )
      return [];
    return m.primitives.flatMap((q, index) => {
      if (
        m.layers[q.layer] === false ||
        (q.layerId && !layerState(p, context.key, q.layerId).capture)
      )
        return [];
      const ref = {
        maskId: m.id,
        index,
        id: q.id,
        primitive: q,
        key: JSON.stringify([m.id, q.id ?? index]),
      };
      const entity: MaskCadEntity = {
        ref,
        mask: m,
        label: `${m.name} · ${index + 1} · ${q.text !== undefined ? 'texto' : (q.native?.kind ?? (q.closed ? 'contorno' : 'polilinha'))} · [${q.id?.slice(0, 8) ?? index + 1}]`,
        editable:
          objectState(p, context.key, m).editable &&
          (!q.layerId || layerState(p, context.key, q.layerId).editable),
      };
      try {
        entity.curve = maskCurve(m, q);
      } catch (e) {
        entity.issue = (e as Error).message;
      }
      return [entity];
    });
  });
}
export function maskEditTarget(
  p: Project,
  id: string | undefined,
  context: MaskDrawingContext,
) {
  const m = p.masks.find((m) => m.id === id);
  if (!m)
    throw new Error(
      'Escolha uma máscara ativa; armaduras e seleção residual não são alvos destes comandos.',
    );
  if (
    context.key.startsWith('sheet:') ||
    p.hierarchy.objectDetails[m.id] !== context.detailId ||
    (context.scopeDetailId &&
      p.hierarchy.objectDetails[m.id] !== context.scopeDetailId)
  )
    throw new Error(
      'Abra o desenho/detalhamento da máscara ativa; não se edita geometria no papel.',
    );
  if (
    !m.visible ||
    m.opacity === 0 ||
    objectHidden(p, context.key, m.id) ||
    !objectState(p, context.key, m).editable
  )
    throw new Error(
      'Máscara oculta, sem captura ou bloqueada. Libere o alvo explicitamente.',
    );
  return m;
}
export function hitMaskCadEntity(
  entities: MaskCadEntity[],
  at: Point,
  tolerance: number,
  filter?: (e: MaskCadEntity) => boolean,
) {
  let best: MaskCadEntity | undefined,
    dist = tolerance;
  for (const e of entities) {
    if (filter && !filter(e)) continue;
    const d = e.curve
      ? nearestCurve(e.curve, at).distance
      : e.ref.primitive.text && e.ref.primitive.points[0]
        ? Math.hypot(
            maskPoint(e.ref.primitive.points[0], e.mask).x - at.x,
            maskPoint(e.ref.primitive.points[0], e.mask).y - at.y,
          )
        : Infinity;
    if (d < dist) {
      best = e;
      dist = d;
    }
  }
  return best;
}
export type MaskCadPlan = {
  project: Project;
  mask: Mask;
  target: MaskCadEntity;
  remaining: CadCurve[];
  change: CadCurve;
  mode: MaskCadMode;
  click: Point;
  boundaries: MaskEntityRef[];
};
export function previewMaskCadEdit(
  p: Project,
  maskId: string,
  mode: MaskCadMode,
  target: MaskEntityRef,
  limits: MaskEntityRef[],
  all: boolean,
  at: Point,
  context: MaskDrawingContext,
  prepared?: MaskCadEntity[],
): MaskCadPlan {
  const mask = maskEditTarget(p, maskId, context),
    entities = prepared ?? maskCadEntities(p, context),
    e = entities.find((e) => sameMaskEntity(e.ref, target));
  if (!e || e.mask.id !== maskId)
    throw new Error(
      'Somente entidades da máscara ativa podem receber Ajustar/Estender. Outras máscaras servem apenas de limite.',
    );
  if (!e.editable) throw new Error('Layer da entidade bloqueado/sem captura.');
  if (!e.curve)
    throw new Error(e.issue || 'Tipo sem suporte; nada foi apagado.');
  if (!all && limits.some((r) => sameMaskEntity(r, e.ref)))
    throw new Error(
      'Esta entidade é um limite selecionado. Retire-a dos limites/reinicie para editá-la.',
    );
  const boundaries = all
    ? entities.filter((x) => x.curve && !sameMaskEntity(x.ref, e.ref))
    : limits
        .map((r) => {
          const live = entities.find((e) => sameMaskEntity(e.ref, r));
          if (!live?.curve)
            throw new Error(
              'Um limite deixou de estar visível/capturável ou não possui geometria suportada. Reinicie a seleção.',
            );
          return live;
        })
        .filter((x) => !sameMaskEntity(x.ref, e.ref));
  if (!boundaries.length)
    throw new Error('Nenhum limite elegível além do próprio alvo.');
  const result =
    mode === 'trim'
      ? trimCurve(
          e.curve,
          boundaries.map((e) => e.curve!),
          at,
        )
      : extendCurve(
          e.curve,
          boundaries.map((e) => e.curve!),
          at,
        );
  for (const c of [...result.remaining, result.change])
    for (const q of curveBoundsPoints(c))
      if (![q.x, q.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9))
        throw new Error(
          'Resultado fora dos limites de coordenadas ±1.000.000.000 mm.',
        );
  // Refuse an unrenderable preview before exposing a confirmable plan.
  curveDisplayPoints(result.change);
  for (const c of result.remaining) localResult(c, mask, e.ref.primitive);
  return {
    project: p,
    mask,
    target: e,
    ...result,
    mode,
    click: at,
    boundaries: boundaries.map((e) => e.ref),
  };
}
function curveBoundsPoints(c: CadCurve): Point[] {
  if (c.kind === 'path') return c.points;
  return [
    curvePoint(c, 0),
    curvePoint(c, c.total),
    ...[0, Math.PI / 2, Math.PI, Math.PI * 1.5].flatMap((angle) => {
      const p = {
        x: c.center.x + c.radius * Math.cos(angle),
        y: c.center.y + c.radius * Math.sin(angle),
      };
      return roundParameter(c, p) === undefined ? [] : [p];
    }),
  ];
}
export function curveDisplayPoints(c: CadCurve) {
  if (c.kind === 'path') return c.points;
  // The preview uses the same 0.05 mm chord error as native mask sampling,
  // in model coordinates. Stored circle/arc data remains analytic.
  const fullCount = Math.max(
    32,
    Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 0.05 / c.radius))),
  );
  const count = Math.max(1, Math.ceil((fullCount * Math.abs(c.sweep)) / TAU));
  if (count > 100000)
    throw new Error('Curva excede o limite de discretização da prévia.');
  return Array.from({ length: count + 1 }, (_, i) =>
    curvePoint(c, (c.total * i) / count),
  );
}
export function curvePrimitive(c: CadCurve): Primitive {
  return {
    layer: 'PREVIA_CAD',
    points: curveDisplayPoints(c),
    closed: c.closed,
  };
}
function localResult(
  c: CadCurve,
  m: Mask,
  original: Primitive,
): Pick<Primitive, 'native' | 'points' | 'closed'> {
  if (c.kind === 'round') {
    const center =
      original.native?.kind === 'circle' || original.native?.kind === 'arc'
        ? original.native.center
        : localMaskPoint(c.center, m);
    const radius =
      original.native?.kind === 'circle' || original.native?.kind === 'arc'
        ? original.native.radius
        : c.radius / m.scale;
    const startPoint = localMaskPoint(curvePoint(c, 0), m),
      startAngle =
        (normAngle(
          Math.atan2(startPoint.y - center.y, startPoint.x - center.x),
        ) *
          180) /
        Math.PI;
    const shape: NativeShape = {
      kind: 'arc',
      center,
      radius,
      startAngle,
      sweepAngle: (c.sweep * 180) / Math.PI,
    };
    return nativePrimitive(shape, original.id ?? 'geometry', original.layer);
  }
  const points = c.points.map((q) => localMaskPoint(q, m));
  const native: NativeShape | undefined =
    points.length <= 500
      ? {
          kind: points.length === 2 ? 'line' : 'polyline',
          points,
          closed: c.closed,
        }
      : undefined;
  if (!native && m.format === 'NATIVE')
    throw new Error(
      'Remanescente nativo excede 500 vértices; operação recusada sem discretização.',
    );
  return native
    ? nativePrimitive(native, original.id ?? 'geometry', original.layer)
    : { native: undefined, points, closed: c.closed };
}
export function applyMaskCadEdit(
  p: Project,
  plan: MaskCadPlan,
  context: MaskDrawingContext,
) {
  if (p !== plan.project)
    throw new Error(
      'O projeto mudou após a prévia. Recalcule o corte/prolongamento.',
    );
  const fresh = previewMaskCadEdit(
    p,
    plan.mask.id,
    plan.mode,
    plan.target.ref,
    plan.boundaries,
    false,
    plan.click,
    context,
  );
  const index = plan.mask.primitives.indexOf(plan.target.ref.primitive);
  if (index < 0) throw new Error('A entidade mudou. Reinicie o comando.');
  const origin = plan.target.ref.primitive,
    sourceEntityId =
      origin.sourceEntityId ??
      origin.id ??
      `${plan.mask.id}/reference/${index}`;
  const remnants = fresh.remaining.map(
    (c, i): Primitive => ({
      ...origin,
      ...localResult(c, plan.mask, origin),
      id: i === 0 ? (origin.id ?? uid()) : uid(),
      sourceEntityId,
    }),
  );
  const primitives = [
    ...plan.mask.primitives.slice(0, index),
    ...remnants,
    ...plan.mask.primitives.slice(index + 1),
  ];
  if (primitives.length > 100000)
    throw new Error('Limite de 100 mil entidades da máscara atingido.');
  const mask = { ...plan.mask, primitives };
  validateNativeMask(mask);
  return { ...p, masks: p.masks.map((m) => (m.id === mask.id ? mask : m)) };
}
