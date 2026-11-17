import { z } from 'zod';
import type { Mask, Point, Project } from './types';
import { maskPoint } from '../cad/import';
import { localMaskPoint } from './nativeMasks';
import { withSeriesMaskVersion } from './projectSchema';

// /40 está reservado pela PR #215 (séries variáveis).
export const MASK_REFERENCE_PROJECT_SCHEMA = 'armadurastruct/41' as const;
const point = z
  .object({
    x: z.number().finite().min(-1e9).max(1e9),
    y: z.number().finite().min(-1e9).max(1e9),
  })
  .strict();
export const detailMaskReferencesSchema = z
  .object({
    currentMaskId: z.string().min(1).max(200).optional(),
    items: z
      .array(
        z
          .object({
            maskId: z.string().min(1).max(200),
            visible: z.boolean(),
            origin: point,
            anchor: point.optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type DetailMaskReferences = z.infer<typeof detailMaskReferencesSchema>;

export function hasIndependentMaskData(input: unknown): boolean {
  const p = input as {
    maskReferences?: unknown;
    masks?: { independent?: unknown }[];
  } | null;
  return (
    p?.maskReferences !== undefined ||
    !!p?.masks?.some((m) => m.independent !== undefined)
  );
}
export function withMaskReferenceVersion(p: Project): Project {
  return hasIndependentMaskData(p)
    ? withSeriesMaskVersion(p, MASK_REFERENCE_PROJECT_SCHEMA)
    : p;
}
export function validateMaskReferences(p: Project) {
  for (const m of p.masks) {
    if (m.independent && Object.hasOwn(p.hierarchy.objectDetails, m.id))
      throw new Error(
        'Máscara independente não pode ter detalhamento proprietário.',
      );
  }
  for (const [detailId, state] of Object.entries(p.maskReferences ?? {})) {
    detailMaskReferencesSchema.parse(state);
    if (!p.hierarchy.details.some((d) => d.id === detailId))
      throw new Error('Referência de máscara em detalhamento inexistente.');
    if (new Set(state.items.map((i) => i.maskId)).size !== state.items.length)
      throw new Error('Referência de máscara repetida no detalhamento.');
    if (state.items.some((i) => !p.masks.some((m) => m.id === i.maskId)))
      throw new Error('Referência de máscara inexistente.');
    if (
      state.currentMaskId &&
      !state.items.some((i) => i.maskId === state.currentMaskId && i.visible)
    )
      throw new Error('A referência atual deve estar visível no detalhamento.');
  }
}
/** Only called at a transaction boundary: deletion removes dangling references. */
export function reconcileMaskReferences(p: Project): Project {
  if (!p.maskReferences) return withMaskReferenceVersion(p);
  const entries = Object.entries(p.maskReferences)
    .filter(([id]) => p.hierarchy.details.some((d) => d.id === id))
    .map(([id, s]) => {
      const items = s.items.filter((i) =>
        p.masks.some((m) => m.id === i.maskId),
      );
      const currentVisible = items.some(
        (i) => i.maskId === s.currentMaskId && i.visible,
      );
      // Não reescreva registros de outros detalhes: a guarda de isolamento
      // compara a fotografia persistida, inclusive após abrir o projeto.
      if (
        items.length === s.items.length &&
        (!s.currentMaskId || currentVisible)
      )
        return [id, s];
      return [
        id,
        {
          ...(currentVisible ? { currentMaskId: s.currentMaskId } : {}),
          items,
        },
      ];
    });
  return withMaskReferenceVersion({
    ...p,
    maskReferences: Object.fromEntries(entries),
  });
}
/** Legacy masks keep their appearance until this detail explicitly uses the selector. */
export function detailMaskReferences(
  p: Project,
  detailId: string,
): DetailMaskReferences {
  return (
    p.maskReferences?.[detailId] ?? {
      items: p.masks
        .filter(
          (m) => !m.independent && p.hierarchy.objectDetails[m.id] === detailId,
        )
        .map((m) => ({
          maskId: m.id,
          visible: m.visible,
          origin: { ...m.origin },
        })),
      currentMaskId: p.masks.find(
        (m) =>
          !m.independent &&
          m.visible &&
          p.hierarchy.objectDetails[m.id] === detailId,
      )?.id,
    }
  );
}
function put(
  p: Project,
  detailId: string,
  state: DetailMaskReferences,
): Project {
  if (!p.hierarchy.details.some((d) => d.id === detailId))
    throw new Error('Detalhamento de referência inexistente.');
  const next = withMaskReferenceVersion({
    ...p,
    maskReferences: { ...p.maskReferences, [detailId]: state },
  });
  validateMaskReferences(next);
  return next;
}
export function setMaskReference(
  p: Project,
  detailId: string,
  maskId: string,
  action: 'show' | 'hide' | 'replace',
): Project {
  const mask = p.masks.find((m) => m.id === maskId);
  if (!mask) throw new Error('Máscara de referência inexistente.');
  const s = detailMaskReferences(p, detailId);
  const currentMaskId =
    action === 'hide'
      ? s.currentMaskId === maskId
        ? undefined
        : s.currentMaskId
      : action === 'replace' || !s.currentMaskId
        ? maskId
        : s.currentMaskId;
  const items = [...s.items];
  if (!items.some((i) => i.maskId === maskId))
    items.push({ maskId, visible: false, origin: { ...mask.origin } });
  return put(p, detailId, {
    currentMaskId,
    items: items.map((i) => ({
      ...i,
      visible:
        i.maskId === maskId
          ? action !== 'hide'
          : action === 'replace' && i.maskId === s.currentMaskId
            ? false
            : i.visible,
    })),
  });
}
export function referenceMask(
  p: Project,
  detailId: string,
  maskId: string,
  includeHidden = false,
): Mask | undefined {
  const m = p.masks.find((m) => m.id === maskId),
    i = detailMaskReferences(p, detailId).items.find(
      (i) => i.maskId === maskId,
    );
  return m && i && (i.visible || includeHidden)
    ? { ...m, visible: true, origin: i.origin }
    : undefined;
}
export type MaskReferenceContext = {
  key: string;
  detailId: string;
  scopeDetailId?: string;
  editingMaskId?: string;
};
/** Editor/query projection; never persist it or send it to a paper exporter. */
export function referenceMasks(p: Project, ctx: MaskReferenceContext): Mask[] {
  if (
    ctx.key.startsWith('sheet:') ||
    (ctx.scopeDetailId && ctx.scopeDetailId !== ctx.detailId)
  )
    return [];
  if (ctx.editingMaskId) {
    const target = p.masks.find((m) => m.id === ctx.editingMaskId);
    return p.masks.filter((m) =>
      target?.independent
        ? m.id === target.id
        : !m.independent &&
          (!ctx.scopeDetailId ||
            p.hierarchy.objectDetails[m.id] === ctx.scopeDetailId),
    );
  }
  if (!p.maskReferences?.[ctx.detailId])
    return p.masks.filter(
      (m) =>
        !m.independent &&
        (!ctx.scopeDetailId ||
          p.hierarchy.objectDetails[m.id] === ctx.scopeDetailId),
    );
  return detailMaskReferences(p, ctx.detailId)
    .items.filter((i) => i.visible)
    .flatMap((i) => {
      const m = p.masks.find((m) => m.id === i.maskId);
      return m ? [{ ...m, visible: true, origin: i.origin }] : [];
    });
}
/** Store a local anchor, keep geometry/unit/scale/rotation and all other placements. */
export function alignMaskReference(
  p: Project,
  detailId: string,
  maskId: string,
  local: Point,
  target: Point = { x: 0, y: 0 },
): Project {
  const m = p.masks.find((m) => m.id === maskId);
  if (!m) throw new Error('Máscara de referência inexistente.');
  point.parse(local);
  point.parse(target);
  const offset = maskPoint(local, { ...m, origin: { x: 0, y: 0 } });
  const origin = point.parse({
    x: target.x - offset.x,
    y: target.y - offset.y,
  });
  const s = detailMaskReferences(p, detailId),
    old = s.items.find((i) => i.maskId === maskId);
  const placement = {
    maskId,
    visible: old?.visible ?? true,
    origin,
    anchor: local,
  };
  const next = put(p, detailId, {
    ...s,
    currentMaskId: s.currentMaskId ?? (placement.visible ? maskId : undefined),
    items: old
      ? s.items.map((i) => (i.maskId === maskId ? placement : i))
      : [...s.items, placement],
  });
  return next;
}
export function maskAnchorFromWorld(m: Mask, world: Point): Point {
  return point.parse(localMaskPoint(world, m));
}
export function canEditMaskGeometry(
  p: Project,
  m: Mask,
  ctx: MaskReferenceContext,
): boolean {
  return (
    !ctx.key.startsWith('sheet:') &&
    (m.independent
      ? ctx.editingMaskId === m.id && !ctx.scopeDetailId
      : p.hierarchy.objectDetails[m.id] === ctx.detailId &&
        (!ctx.scopeDetailId || ctx.scopeDetailId === ctx.detailId))
  );
}
