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
  angleByPoints,
  selectionTransformSchema,
  transformPoint,
  type SelectionTransform,
} from './transforms';
import { sub } from './geometry';
import {
  uid,
  type Mask,
  type Point,
  type Primitive,
  type Project,
} from './types';

export type MaskManipMode = 'copy' | 'erase' | 'mirror' | 'rotate';
export type MaskManipTransform = SelectionTransform;
export const maskManipNames: Record<MaskManipMode, string> = {
  copy: 'Copiar',
  mirror: 'Espelhar',
  rotate: 'Rotacionar',
  erase: 'Apagar',
};
/** 0°, ±360°, 720°… return the geometry to where it was: nothing to commit. */
export function neutralRotation(angle: number) {
  const r = ((angle % 360) + 360) % 360;
  return r < 1e-9 || 360 - r < 1e-9;
}
const finitePoint = (p: Point) =>
  [p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9);
/** Direction of an optional Reference (two points); +X when absent. */
export function referenceDirection(reference?: readonly Point[]): Point {
  if (!reference?.length) return { x: 1, y: 0 };
  if (reference.length !== 2 || !reference.every(finitePoint))
    throw new Error('Referência requer dois pontos finitos.');
  const d = sub(reference[1], reference[0]);
  if (Math.hypot(d.x, d.y) < 0.01)
    throw new Error(
      'Referência requer dois pontos distintos (mínimo 0,01 mm).',
    );
  return d;
}
/**
 * Rotation that takes the reference direction (default +X) to base → target,
 * counter-clockwise positive, in model mm.
 */
export function rotationAngle(
  base: Point,
  target: Point,
  reference?: readonly Point[],
) {
  if (!finitePoint(base) || !finitePoint(target))
    throw new Error('Informe um ponto finito dentro dos limites do modelo.');
  const from = referenceDirection(reference);
  if (Math.hypot(target.x - base.x, target.y - base.y) < 0.01)
    throw new Error('A direção precisa de um ponto distinto da base.');
  return angleByPoints({ x: 0, y: 0 }, from, sub(target, base));
}
/** A typed value is the rotation itself, or the new absolute direction under Reference. */
export function typedRotationAngle(
  value: number,
  reference?: readonly Point[],
) {
  if (!Number.isFinite(value) || Math.abs(value) > 360000)
    throw new Error('Ângulo deve ser um número finito entre ±360000°.');
  if (!reference?.length) return value;
  const d = referenceDirection(reference);
  return value - (Math.atan2(d.y, d.x) * 180) / Math.PI;
}
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
      // Mask scale is always positive, so a model rotation keeps the local
      // opening; a reflection reverses it. The start is re-derived from the
      // transformed start point in both cases.
      if (s.kind === 'arc' && t.kind !== 'translate') {
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
          sweepAngle: t.kind === 'mirror' ? -s.sweepAngle : s.sweepAngle,
        };
      }
    } else {
      if (s.kind === 'rectangle' && t.kind !== 'translate') {
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
  if (q.text && t.kind === 'rotate') {
    // Rigid turn: the baseline follows the angle; content, height and
    // alignment stay. Normalised to (−180°, 180°] so repeats do not accumulate.
    let angle = ((((q.textRotation ?? 0) + t.angle) % 360) + 360) % 360;
    if (angle > 180) angle -= 360;
    result.textRotation = angle;
  }
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
  if (
    plan.transform?.kind === 'rotate' &&
    neutralRotation(plan.transform.angle)
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
  } else if (plan.mode === 'mirror' || plan.mode === 'rotate') {
    // In-place replacement: same IDs, lineage, layers and styles.
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
