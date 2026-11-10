import { z } from 'zod';
import type { Point, Project } from './types';
import { add, sub, mul, dot, distance } from './geometry';
import { drawingPrimitives } from './drawingPrimitives';
import { primitiveBounds } from './drafting';
import { contentObjects, detailPath } from './hierarchy';
import { selectionTransformIds, transformSelection } from './transforms';
import { composeSheet, paperPrimitiveBounds } from './paper';
const point = z
  .object({
    x: z.number().finite().min(-1e9).max(1e9),
    y: z.number().finite().min(-1e9).max(1e9),
  })
  .strict();
export const alignmentSchema = z
  .object({
    mode: z.enum(['align', 'distribute']),
    axis: z.enum(['x', 'y', 'reference']),
    anchor: z.enum(['min', 'center', 'max']),
    fixedId: z.string().min(1),
    gap: z.number().finite().min(0).max(1e9),
    reference: z.object({ start: point, end: point }).strict().optional(),
  })
  .strict();
export type AlignmentOptions = z.infer<typeof alignmentSchema>;
/** Common contract for model objects, semantic groups and present/future paper entities. */
export type AlignmentItem = {
  id: string;
  label: string;
  ids: string[];
  points: Point[];
};
export type AlignmentMove = { id: string; delta: Point };
export function planAlignmentItems(
  items: AlignmentItem[],
  input: AlignmentOptions,
): AlignmentMove[] {
  const o = alignmentSchema.parse(input);
  if (items.length < 2 || new Set(items.map((v) => v.id)).size !== items.length)
    throw new Error('Escolha ao menos dois conjuntos distintos.');
  if (!items.some((v) => v.id === o.fixedId))
    throw new Error('Escolha o conjunto fixo da seleção.');
  let n: Point = o.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  if (o.axis === 'reference') {
    if (!o.reference || distance(o.reference.start, o.reference.end) < 0.01)
      throw new Error('Defina dois pontos distintos para a referência.');
    const u = mul(
      sub(o.reference.end, o.reference.start),
      1 / distance(o.reference.start, o.reference.end),
    );
    n = o.mode === 'align' ? { x: -u.y, y: u.x } : u;
  }
  const projected = items.map((v) => {
    if (
      !v.points.length ||
      v.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      throw new Error(`Caixa gráfica indisponível: ${v.label}.`);
    const values = v.points.map((p) => dot(p, n));
    return {
      ...v,
      min: values.reduce((a, b) => Math.min(a, b), Infinity),
      max: values.reduce((a, b) => Math.max(a, b), -Infinity),
    };
  });
  const fixed = projected.find((v) => v.id === o.fixedId)!;
  const anchor = (v: typeof fixed) =>
    o.anchor === 'min'
      ? v.min
      : o.anchor === 'max'
        ? v.max
        : (v.min + v.max) / 2;
  if (o.mode === 'align') {
    const target =
      o.axis === 'reference' ? dot(o.reference!.start, n) : anchor(fixed);
    return projected.map((v) => ({
      id: v.id,
      delta: v.id === fixed.id ? { x: 0, y: 0 } : mul(n, target - anchor(v)),
    }));
  }
  projected.sort(
    (a, b) => a.min - b.min || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const prefix = [0];
  for (let i = 1; i < projected.length; i++)
    prefix.push(
      prefix[i - 1] + projected[i - 1].max - projected[i - 1].min + o.gap,
    );
  const start =
    fixed.min - prefix[projected.findIndex((v) => v.id === fixed.id)];
  return projected.map((v, i) => ({
    id: v.id,
    delta: mul(n, start + prefix[i] - v.min),
  }));
}
export function modelAlignmentItems(
  p: Project,
  ids: string[],
  scopeDetailId?: string,
): AlignmentItem[] {
  const objects = contentObjects(p),
    live = new Map(objects.map((o) => [o.id, o]));
  if (ids.some((id) => !live.has(id)))
    throw new Error('Objeto de alinhamento inexistente.');
  const units: { id: string; ids: string[] }[] = [];
  for (const id of [...new Set(ids)]) {
    const owner = p.hierarchy.objectDetails[id];
    const group =
      !scopeDetailId &&
      p.hierarchy.details.some((d) => d.id === owner && d.grouped);
    const members = group
      ? objects
          .filter((o) => p.hierarchy.objectDetails[o.id] === owner)
          .map((o) => o.id)
      : [id];
    const closure = selectionTransformIds(p, members).ids;
    const overlaps = units.filter((u) =>
      u.ids.some((v) => closure.includes(v)),
    );
    if (overlaps.length) {
      const first = overlaps[0];
      first.ids = [
        ...new Set([
          ...first.ids,
          ...closure,
          ...overlaps.flatMap((v) => v.ids),
        ]),
      ];
      for (const extra of overlaps.slice(1))
        units.splice(units.indexOf(extra), 1);
    } else units.push({ id: group ? `group:${owner}` : id, ids: closure });
  }
  return units.map((u) => {
    const set = new Set(u.ids),
      view = {
        ...p,
        bars: p.bars.filter((v) => set.has(v.id)),
        details: p.details.filter((v) => set.has(v.id)),
        annotations: p.annotations.filter((v) => set.has(v.id)),
        polylines: p.polylines.filter((v) => set.has(v.id)),
        masks: p.masks.filter((v) => set.has(v.id)),
        symbolInstances: (p.symbolInstances ?? []).filter((v) => set.has(v.id)),
      };
    const first = live.get(u.ids[0])!;
    return {
      ...u,
      label: u.id.startsWith('group:')
        ? detailPath(p, p.hierarchy.objectDetails[u.ids[0]])
        : 'mark' in first
          ? first.mark
          : 'name' in first
            ? first.name
            : 'barId' in first && !('kind' in first)
              ? `Inserção ${u.id}`
              : `${'kind' in first ? first.kind : 'Polilinha'} ${u.id}`,
      points: drawingPrimitives(view, p).flatMap(primitiveBounds),
    };
  });
}
export function paperAlignmentItems(
  p: Project,
  sheetId: string,
): AlignmentItem[] {
  return composeSheet(p, sheetId).views.map((v, i) => ({
    id: v.placement.id,
    ids: [v.placement.id],
    label: `Vista ${i + 1} · ${p.hierarchy.drawings.find((d) => d.id === v.placement.drawingId)?.name}`,
    points: [...v.frame, ...v.lines.flatMap(paperPrimitiveBounds)],
  }));
}
export function alignSelection(
  p: Project,
  ids: string[],
  input: AlignmentOptions,
  context: {
    sheetId?: string;
    layerContext?: string;
    scopeDetailId?: string;
  } = {},
) {
  const items = context.sheetId
    ? paperAlignmentItems(p, context.sheetId).filter((v) => ids.includes(v.id))
    : modelAlignmentItems(p, ids, context.scopeDetailId);
  if (context.sheetId && ids.some((id) => !items.some((v) => v.id === id)))
    throw new Error('Vista fora da folha de alinhamento.');
  const moves = planAlignmentItems(items, input);
  let project = p;
  for (const move of moves) {
    if (distance(move.delta, { x: 0, y: 0 }) < 1e-9) continue;
    if (context.sheetId)
      project = {
        ...project,
        hierarchy: {
          ...project.hierarchy,
          placements: project.hierarchy.placements.map((v) =>
            v.id === move.id ? { ...v, origin: add(v.origin, move.delta) } : v,
          ),
        },
      };
    else
      project = transformSelection(
        project,
        items.find((v) => v.id === move.id)!.ids,
        { kind: 'translate', delta: move.delta },
        { ...context, associated: false },
      );
  }
  return { project, items, moves };
}
