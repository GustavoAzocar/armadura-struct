import { layerState } from './layerProfiles';
import { stylePrimitive } from './layers';
import { maskPoint } from '../cad/import';
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

export type MaskManipMode = 'move' | 'copy' | 'erase' | 'mirror' | 'rotate';
/** Chosen local entities or the whole mask. */
export type MaskManipScope = 'entities' | 'mask';
export type MaskManipTransform = Extract<
  SelectionTransform,
  { kind: 'translate' | 'mirror' | 'rotate' }
>;
export const maskManipNames: Record<MaskManipMode, string> = {
  move: 'Mover',
  copy: 'Copiar',
  mirror: 'Espelhar',
  rotate: 'Rotacionar',
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
    if (!editableMaskLayer(p, mask, entity.ref.primitive, context))
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
function editableMaskLayer(
  p: Project,
  mask: Mask,
  q: Primitive,
  context: MaskDrawingContext,
) {
  return (
    mask.layers[q.layer] !== false &&
    (!q.layerId || layerState(p, context.key, q.layerId).editable) &&
    layerState(p, context.key, stylePrimitive(p, mask, q).layerId!).editable
  );
}
/** Moving the entire reference also moves hidden geometry, so every layer must allow it. */
export function maskRotationTarget(
  p: Project,
  maskId: string,
  context: MaskDrawingContext,
) {
  const mask = maskEditTarget(p, maskId, context);
  if (mask.primitives.some((q) => !editableMaskLayer(p, mask, q, context)))
    throw new Error(
      'Máscara inteira contém entidades ocultas, sem captura ou bloqueadas. Libere os layers ou selecione entidades.',
    );
  return mask;
}

const coordinateValid = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1e9;
const normalizeAngle = (angle: number) => angle % 360;

function assertMaskCoordinates(q: Primitive, mask: Mask) {
  if (q.native?.kind === 'circle' || q.native?.kind === 'arc') {
    const c = maskPoint(q.native.center, mask),
      r = q.native.radius * mask.scale;
    if (![c.x - r, c.x + r, c.y - r, c.y + r].every(coordinateValid))
      throw new Error('Curva fora dos limites de coordenadas.');
  }
  if (
    !q.points.every((local) => {
      const model = maskPoint(local, mask);
      return [local.x, local.y, model.x, model.y].every(coordinateValid);
    })
  )
    throw new Error(
      'Resultado fora dos limites de coordenadas ±1.000.000.000 mm.',
    );
}

/** Same rigid transform as the CAD, composed model → local exactly once. */
export function transformMaskPrimitive(
  q: Primitive,
  mask: Mask,
  input: MaskManipTransform,
): Primitive {
  const t = selectionTransformSchema.parse(input);
  if (t.kind === 'rotate') {
    t.angle = normalizeAngle(t.angle);
    if (!t.angle) return q;
  }
  if (
    t.kind === 'mirror' &&
    Math.hypot(t.axisEnd.x - t.base.x, t.axisEnd.y - t.base.y) < 0.01
  )
    throw new Error(
      'Defina dois pontos distintos para o eixo do espelho (mínimo 0,01 mm).',
    );
  // Uniform scale and rotation commute. Convert the common pivot once.
  const localRotation =
    t.kind === 'rotate'
      ? { ...t, base: localMaskPoint(t.base, mask) }
      : undefined;
  const at = (p: Point) =>
    localRotation
      ? transformPoint(p, localRotation)
      : localMaskPoint(transformPoint(maskPoint(p, mask), t), mask);
  const result = structuredClone(q);
  if (q.native) {
    const s = q.native;
    if (s.kind === 'circle' || s.kind === 'arc') {
      const center = at(s.center);
      result.native = { ...s, center };
      if (s.kind === 'arc' && t.kind === 'rotate')
        result.native = {
          ...s,
          center,
          startAngle: normalizeAngle(s.startAngle + t.angle),
        };
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
      if (s.kind === 'rectangle' && t.kind !== 'translate') {
        const corners = nativePrimitive(s).points.map(at);
        // Two diagonal corners cannot describe an oblique rectangle. Four exact
        // vertices retain its geometry without tessellating or exploding curves.
        const i = t.kind === 'rotate' && Math.abs(t.angle % 180) === 90 ? 1 : 0;
        const rectangle = { ...s, points: [corners[i], corners[i + 2]] };
        const [a, c] = rectangle.points;
        const exact =
          t.kind === 'rotate'
            ? t.angle % 90 === 0
            : [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }].every(
                (p, j) =>
                  Math.hypot(p.x - corners[j].x, p.y - corners[j].y) < 1e-7,
              );
        result.native = exact
          ? rectangle
          : { kind: 'polyline', points: corners, closed: true };
      } else if (s.kind === 'text') result.native = { ...s, at: at(s.at) };
      else result.native = { ...s, points: s.points.map(at) };
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
  if (q.text && t.kind === 'rotate')
    result.textRotation = normalizeAngle((q.textRotation ?? 0) + t.angle);
  assertMaskCoordinates(result, mask);
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
  pose?: Pick<Mask, 'origin' | 'rotation'>;
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
  wholeMask = false,
  prepared?: MaskCadEntity[],
): MaskManipPlan {
  if (wholeMask && (mode !== 'rotate' || refs.length))
    throw new Error('Escolha apenas um alvo: entidades ou máscara inteira.');
  const { mask, entities } = wholeMask
    ? { mask: maskRotationTarget(p, maskId, context), entities: [] }
    : maskManipSelection(p, maskId, refs, context, prepared);
  if (mode !== 'erase' && !transform)
    throw new Error('Escolha o ponto base e destino da operação.');
  if (mode === 'copy' && transform?.kind !== 'translate')
    throw new Error('Copiar usa translação do ponto base ao destino.');
  if (mode === 'move' && transform?.kind !== 'translate')
    throw new Error('Mover usa translação do ponto base ao destino.');
  if (mode === 'mirror' && transform?.kind !== 'mirror')
    throw new Error('Espelhar requer dois pontos do eixo.');
  if (mode === 'rotate' && transform?.kind !== 'rotate')
    throw new Error('Rotacionar requer ponto base e ângulo.');
  if (mode === 'erase' && transform)
    throw new Error('Apagar não aceita transformação.');
  if (
    (mode === 'copy' || (mode === 'mirror' && !removeSource)) &&
    mask.primitives.length + entities.length > 100000
  )
    throw new Error('Limite de 100 mil entidades da máscara atingido.');
  if (mode === 'rotate') {
    const selected = wholeMask
      ? mask.primitives
      : entities.map((e) => e.ref.primitive);
    if (
      selected.some(
        (q) => !q.native && q.points.length < (q.text ? 1 : q.closed ? 3 : 2),
      )
    )
      throw new Error(
        'Entidade sem geometria de rotação suportada. Revise o alvo selecionado.',
      );
  }
  let pose: MaskManipPlan['pose'];
  if (wholeMask && transform?.kind === 'rotate') {
    selectionTransformSchema.parse(transform);
    const t = { ...transform, angle: normalizeAngle(transform.angle) };
    pose = t.angle
      ? {
          origin: transformPoint(mask.origin, t),
          rotation: normalizeAngle(mask.rotation + t.angle),
        }
      : { origin: mask.origin, rotation: mask.rotation };
    if (![pose.origin.x, pose.origin.y].every(coordinateValid))
      throw new Error('Origem da máscara fora dos limites de coordenadas.');
    if (t.angle) {
      const rotated = { ...mask, ...pose };
      for (const q of mask.primitives) assertMaskCoordinates(q, rotated);
    }
  }
  const result = wholeMask
    ? mask.primitives
    : mode === 'erase'
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
    pose,
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
    !!plan.pose,
  );
  if (
    plan.transform?.kind === 'translate' &&
    Math.hypot(plan.transform.delta.x, plan.transform.delta.y) < 1e-6
  )
    return p;
  if (
    plan.transform?.kind === 'rotate' &&
    !normalizeAngle(plan.transform.angle)
  )
    return p;
  if (fresh.pose)
    return {
      ...p,
      masks: p.masks.map((m) =>
        m === fresh.mask ? { ...m, ...fresh.pose } : m,
      ),
    };
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
  } else if (
    plan.mode === 'mirror' ||
    plan.mode === 'move' ||
    plan.mode === 'rotate'
  ) {
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
  let hidden = 0;
  for (const q of mask.primitives) {
    const s = layerState(p, context.key, stylePrimitive(p, mask, q).layerId!);
    if (s.visible && !s.editable)
      throw new Error(
        'A máscara inteira contém entidades em layer bloqueado; libere o layer ou mova somente as entidades editáveis.',
      );
    if (!s.visible || mask.layers[q.layer] === false) hidden++;
  }
  return wholeMaskMovePlan(p, mask, context, delta, hidden);
}

/** Only presentation may reuse eligibility. applyWholeMaskMove revalidates fully. */
export function prepareWholeMaskMovePreview(
  p: Project,
  maskId: string,
  context: MaskDrawingContext,
) {
  const initial = previewWholeMaskMove(p, maskId, context, { x: 0, y: 0 });
  return (delta: Point) =>
    wholeMaskMovePlan(p, initial.mask, initial.context, delta, initial.hidden);
}

function wholeMaskMovePlan(
  p: Project,
  mask: Mask,
  context: MaskDrawingContext,
  delta: Point,
  hidden: number,
): WholeMaskMovePlan {
  if (
    ![delta.x, delta.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9)
  )
    throw new Error(
      'Informe um deslocamento finito dentro dos limites do modelo.',
    );
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
