import { layerState } from './layerProfiles';
import { stylePrimitive } from './layers';
import { maskPoint, maskPrimitives } from '../cad/import';
import {
  localMaskPoint,
  nativePrimitive,
  validateNativeMask,
} from './nativeMasks';
import {
  maskCadEntities,
  maskEditTarget,
  sameMaskEntity,
  type MaskEntityRef,
  type MaskCadEntity,
} from './maskCadEditing';
import type { MaskDrawingContext } from './maskDrawing';
import {
  selectionTransformSchema,
  transformPoint,
  type SelectionTransform,
} from './transforms';
import {
  uid,
  type Mask,
  type Point,
  type Primitive,
  type Project,
} from './types';

export type MaskManipMode = 'move' | 'copy' | 'erase' | 'mirror';
/** Move reach: chosen entities (local geometry) or the whole mask (origin only). */
export type MaskMoveScope = 'entities' | 'mask';
export type MaskManipTransform = Extract<
  SelectionTransform,
  { kind: 'translate' | 'mirror' }
>;
export const maskManipNames: Record<MaskManipMode, string> = {
  move: 'Mover',
  copy: 'Copiar',
  mirror: 'Espelhar',
  erase: 'Apagar',
};
/** References are resolved against this exact snapshot, never by a residual steel selection. */
export function maskManipSelection(
  p: Project,
  maskId: string,
  refs: MaskEntityRef[],
  context: MaskDrawingContext,
  prepared?: MaskCadEntity[],
) {
  const mask = maskEditTarget(p, maskId, context);
  if (!refs.length)
    throw new Error(
      'Selecione entidades da máscara ativa; nenhuma entidade será alterada.',
    );
  const available = new Map(
    (prepared ?? maskCadEntities(p, context)).map((entity) => [
      entity.ref.primitive,
      entity,
    ]),
  );
  const seen = new Set<Primitive>();
  const entities = refs.map((ref) => {
    const entity = available.get(ref.primitive);
    if (!entity || !sameMaskEntity(entity.ref, ref) || entity.mask !== mask)
      throw new Error(
        'Seleção inválida ou de outra máscara. Reinicie a seleção no alvo ativo.',
      );
    if (
      !entity.editable ||
      !layerState(
        p,
        context.key,
        stylePrimitive(p, mask, entity.ref.primitive).layerId!,
      ).editable
    )
      throw new Error(
        'Entidade oculta, sem captura ou bloqueada; libere seu layer explicitamente.',
      );
    if (seen.has(entity.ref.primitive))
      throw new Error('Entidade repetida na seleção.');
    seen.add(entity.ref.primitive);
    return entity;
  });
  return { mask, entities };
}
/** Same rigid transform as the CAD, composed model → local exactly once. */
export function transformMaskPrimitive(
  q: Primitive,
  mask: Mask,
  input: MaskManipTransform,
): Primitive {
  const t = selectionTransformSchema.parse(input);
  if (
    t.kind === 'mirror' &&
    Math.hypot(t.axisEnd.x - t.base.x, t.axisEnd.y - t.base.y) < 0.01
  )
    throw new Error(
      'Defina dois pontos distintos para o eixo do espelho (mínimo 0,01 mm).',
    );
  const at = (p: Point) =>
    localMaskPoint(transformPoint(maskPoint(p, mask), t), mask);
  const result = structuredClone(q);
  if (q.native) {
    const s = q.native;
    if (s.kind === 'circle' || s.kind === 'arc') {
      const center = at(s.center);
      result.native = { ...s, center };
      if (s.kind === 'arc' && t.kind === 'mirror') {
        const a = (s.startAngle * Math.PI) / 180;
        const start = at({
          x: s.center.x + s.radius * Math.cos(a),
          y: s.center.y + s.radius * Math.sin(a),
        });
        result.native = {
          ...s,
          center,
          startAngle:
            (Math.atan2(start.y - center.y, start.x - center.x) * 180) /
            Math.PI,
          sweepAngle: -s.sweepAngle,
        };
      }
    } else {
      if (s.kind === 'rectangle' && t.kind === 'mirror') {
        const corners = nativePrimitive(s).points.map(at);
        // Two diagonal corners cannot describe an oblique rectangle. Four exact
        // vertices retain its geometry without tessellating or exploding curves.
        const rectangle = { ...s, points: [corners[0], corners[2]] };
        const [a, c] = rectangle.points;
        const exact = [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }].every(
          (p, i) => Math.hypot(p.x - corners[i].x, p.y - corners[i].y) < 1e-7,
        );
        result.native = exact
          ? rectangle
          : { kind: 'polyline', points: corners, closed: true };
      } else result.native = { ...s, points: s.points.map(at) };
    }
    const rendered = nativePrimitive(
      result.native,
      result.id ?? 'preview',
      q.layer,
    );
    result.points = rendered.points;
    result.closed = rendered.closed;
  } else result.points = q.points.map(at);
  if (q.text && t.kind === 'mirror') {
    const theta = (((q.textRotation ?? 0) + mask.rotation) * Math.PI) / 180;
    const axis = Math.atan2(t.axisEnd.y - t.base.y, t.axisEnd.x - t.base.x);
    let angle = (((((2 * axis - theta) * 180) / Math.PI) % 360) + 360) % 360;
    const reversed = angle > 90 && angle <= 270;
    if (reversed) angle -= 180;
    if (angle > 270) angle -= 360;
    result.textRotation = angle - mask.rotation;
    const align = q.textAlign ?? 'left';
    result.textAlign = reversed
      ? align === 'left'
        ? 'right'
        : align === 'right'
          ? 'left'
          : align
      : align;
  }
  const coords = [
    ...result.points,
    ...maskPrimitives({ ...mask, primitives: [result] }).flatMap(
      (v) => v.points,
    ),
  ];
  if (result.native?.kind === 'circle' || result.native?.kind === 'arc') {
    const c = maskPoint(result.native.center, mask),
      r = result.native.radius * mask.scale;
    if (
      ![c.x - r, c.x + r, c.y - r, c.y + r].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= 1e9,
      )
    )
      throw new Error('Curva fora dos limites de coordenadas.');
  }
  if (
    !coords.every((v) =>
      [v.x, v.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9),
    )
  )
    throw new Error(
      'Resultado fora dos limites de coordenadas ±1.000.000.000 mm.',
    );
  return result;
}
export type MaskManipPlan = {
  project: Project;
  mask: Mask;
  refs: MaskEntityRef[];
  mode: MaskManipMode;
  transform?: MaskManipTransform;
  result: Primitive[];
  removeSource: boolean;
  context: MaskDrawingContext;
};
export function previewMaskManipulation(
  p: Project,
  maskId: string,
  refs: MaskEntityRef[],
  mode: MaskManipMode,
  context: MaskDrawingContext,
  transform?: MaskManipTransform,
  removeSource = false,
): MaskManipPlan {
  const { mask, entities } = maskManipSelection(p, maskId, refs, context);
  if (mode !== 'erase' && !transform)
    throw new Error('Escolha o ponto base e destino da operação.');
  if (mode === 'copy' && transform?.kind !== 'translate')
    throw new Error('Copiar usa translação do ponto base ao destino.');
  if (mode === 'move' && transform?.kind !== 'translate')
    throw new Error('Mover usa translação do ponto base ao destino.');
  if (mode === 'mirror' && transform?.kind !== 'mirror')
    throw new Error('Espelhar requer dois pontos do eixo.');
  if (mode === 'erase' && transform)
    throw new Error('Apagar não aceita transformação.');
  if (
    (mode === 'copy' || (mode === 'mirror' && !removeSource)) &&
    mask.primitives.length + entities.length > 100000
  )
    throw new Error('Limite de 100 mil entidades da máscara atingido.');
  const result =
    mode === 'erase'
      ? []
      : entities.map((e) =>
          transformMaskPrimitive(e.ref.primitive, mask, transform!),
        );
  return {
    project: p,
    mask,
    refs,
    mode,
    transform,
    result,
    removeSource,
    context: { ...context },
  };
}
export function applyMaskManipulation(
  p: Project,
  plan: MaskManipPlan,
  context: MaskDrawingContext,
): Project {
  if (
    p !== plan.project ||
    context.key !== plan.context.key ||
    context.detailId !== plan.context.detailId ||
    context.scopeDetailId !== plan.context.scopeDetailId
  )
    throw new Error('O projeto mudou. Reinicie Manipular no contexto correto.');
  const fresh = previewMaskManipulation(
    p,
    plan.mask.id,
    plan.refs,
    plan.mode,
    context,
    plan.transform,
    plan.removeSource,
  );
  if (
    plan.transform?.kind === 'translate' &&
    Math.hypot(plan.transform.delta.x, plan.transform.delta.y) < 1e-6
  )
    return p;
  const chosen = new Set(plan.refs.map((r) => r.primitive));
  let primitives: Primitive[];
  if (plan.mode === 'copy' || (plan.mode === 'mirror' && !plan.removeSource)) {
    const idMap = new Map(
      plan.refs.flatMap((r) => (r.id ? [[r.id, uid()] as const] : [])),
    );
    const copies = fresh.result.map((q) => ({
      ...q,
      id: q.id ? idMap.get(q.id)! : uid(),
      ...(q.sourceEntityId
        ? { sourceEntityId: idMap.get(q.sourceEntityId) ?? q.sourceEntityId }
        : {}),
    }));
    primitives = [...plan.mask.primitives, ...copies];
  } else if (plan.mode === 'mirror' || plan.mode === 'move') {
    // In-place replacement: IDs, layers, styles and lineage stay with the entity.
    const replacements = new Map(
      plan.refs.map((r, i) => [r.primitive, fresh.result[i]]),
    );
    primitives = plan.mask.primitives.map((q) => replacements.get(q) ?? q);
  } else {
    primitives = plan.mask.primitives.filter((q) => !chosen.has(q));
  }
  const mask = { ...plan.mask, primitives };
  validateNativeMask(mask);
  return { ...p, masks: p.masks.map((m) => (m === plan.mask ? mask : m)) };
}
const extents = new WeakMap<
  Mask,
  { x0: number; y0: number; x1: number; y1: number }
>();
export type WholeMaskMovePlan = {
  project: Project;
  mask: Mask;
  delta: Point;
  result: Mask;
  /** Entities on hidden layers that follow the origin; reported, never silent. */
  hidden: number;
  context: MaskDrawingContext;
};
/**
 * Whole-mask reach: only `origin` changes. Local primitives, scale, rotation,
 * layers and association stay byte-identical, so nothing is displaced twice.
 */
export function previewWholeMaskMove(
  p: Project,
  maskId: string,
  context: MaskDrawingContext,
  delta: Point,
): WholeMaskMovePlan {
  const mask = maskEditTarget(p, maskId, context);
  if (
    ![delta.x, delta.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9)
  )
    throw new Error(
      'Informe um deslocamento finito dentro dos limites do modelo.',
    );
  let hidden = 0;
  for (const q of mask.primitives) {
    const s = layerState(p, context.key, stylePrimitive(p, mask, q).layerId!);
    if (s.visible && !s.editable)
      throw new Error(
        'A máscara inteira contém entidades em layer bloqueado; libere o layer ou mova somente as entidades editáveis.',
      );
    if (!s.visible || mask.layers[q.layer] === false) hidden++;
  }
  const origin = { x: mask.origin.x + delta.x, y: mask.origin.y + delta.y };
  const result = { ...mask, origin };
  // Pure translation shifts the model extent by exactly delta; the extent of
  // this immutable mask snapshot is computed once and reused by the preview.
  let e = extents.get(mask);
  if (!e) {
    e = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    // Hidden local layers also follow the origin and must stay within bounds.
    for (const v of mask.primitives)
      for (const local of v.points) {
        const a = maskPoint(local, mask);
        e.x0 = Math.min(e.x0, a.x);
        e.y0 = Math.min(e.y0, a.y);
        e.x1 = Math.max(e.x1, a.x);
        e.y1 = Math.max(e.y1, a.y);
      }
    extents.set(mask, e);
  }
  const coords = [
    origin,
    ...(e.x0 <= e.x1
      ? [
          { x: e.x0 + delta.x, y: e.y0 + delta.y },
          { x: e.x1 + delta.x, y: e.y1 + delta.y },
        ]
      : []),
  ];
  if (
    !coords.every((v) =>
      [v.x, v.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9),
    )
  )
    throw new Error(
      'Resultado fora dos limites de coordenadas ±1.000.000.000 mm.',
    );
  return { project: p, mask, delta, result, hidden, context: { ...context } };
}
export function applyWholeMaskMove(
  p: Project,
  plan: WholeMaskMovePlan,
  context: MaskDrawingContext,
): Project {
  if (
    p !== plan.project ||
    context.key !== plan.context.key ||
    context.detailId !== plan.context.detailId ||
    context.scopeDetailId !== plan.context.scopeDetailId
  )
    throw new Error('O projeto mudou. Reinicie Manipular no contexto correto.');
  const fresh = previewWholeMaskMove(p, plan.mask.id, context, plan.delta);
  if (fresh.mask !== plan.mask)
    throw new Error('A máscara mudou. Reinicie Manipular.');
  if (Math.hypot(plan.delta.x, plan.delta.y) < 1e-6) return p;
  return {
    ...p,
    masks: p.masks.map((m) => (m === plan.mask ? fresh.result : m)),
  };
}
