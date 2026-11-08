import { z } from 'zod';
import type { Point, Project } from './types';
import { local, world, distance, geometry, nearest } from './geometry';
import { completeOwnership } from './hierarchy';
import { assertLayerEdit } from './layerProfiles';
import { assertVisibilityEdit } from './visibility';
import { assertDetailEdit } from './detailEditing';
import { dimensionalEditSchema, dimensionalPoints } from './segments';
const point = z
  .object({
    x: z.number().finite().min(-1e9).max(1e9),
    y: z.number().finite().min(-1e9).max(1e9),
  })
  .strict();
export const vertexEditSchema = z.discriminatedUnion('kind', [
  ...dimensionalEditSchema.options,
  z
    .object({
      kind: z.literal('insert'),
      segment: z.number().int().nonnegative(),
      point,
    })
    .strict(),
  z
    .object({ kind: z.literal('extend'), end: z.enum(['start', 'end']), point })
    .strict(),
  z
    .object({
      kind: z.literal('remove'),
      vertex: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type VertexEdit = z.infer<typeof vertexEditSchema>;
export function editablePath(p: Project, id: string) {
  const bar = p.bars.find((b) => b.id === id),
    line = p.polylines.find((l) => l.id === id);
  if (bar && bar.kind !== 'free')
    throw new Error(
      'O estribo permanece paramétrico. Use uma barra livre para editar vértices.',
    );
  if (!bar && !line) throw new Error('Selecione uma barra livre ou polilinha.');
  return {
    object: bar ?? line!,
    points: bar ? bar.points.map((v) => world(v, bar)) : line!.points,
    closed: !!line?.closed,
    bar,
  };
}
/** Receipt maps old topology to the new topology; physical/graphical IDs stay stable. */
export function editVertices(
  p: Project,
  id: string,
  input: VertexEdit,
  context: { layerContext?: string; scopeDetailId?: string } = {},
) {
  const edit = vertexEditSchema.parse(input),
    path = editablePath(p, id),
    count = path.points.length;
  if (edit.kind === 'extend' && path.closed)
    throw new Error('Uma polilinha fechada não possui ponta para continuar.');
  const segments = path.closed ? count : count - 1;
  if (edit.kind === 'segment' || edit.kind === 'lengthen') {
    if (!path.bar)
      throw new Error(
        'A edição dimensional exige uma barra livre física; desenhos e inserções não são armaduras.',
      );
    const points = dimensionalPoints(path.bar, edit);
    return {
      project: replacePathPoints(
        p,
        id,
        points.map((v) => world(v, path.bar!)),
        context,
        points,
      ),
      vertexMap: path.points.map((_, i) => i),
      segmentMap: Array.from({ length: segments }, (_, i) => [i]),
      warnings: [] as string[],
    };
  }
  if (
    (edit.kind === 'insert' && edit.segment >= segments) ||
    (edit.kind === 'remove' && edit.vertex >= count)
  )
    throw new Error('Índice de vértice/segmento inexistente.');
  const index =
    edit.kind === 'insert'
      ? edit.segment + 1
      : edit.kind === 'remove'
        ? edit.vertex
        : edit.end === 'start'
          ? 0
          : count;
  const points = [...path.points];
  points.splice(
    index,
    edit.kind === 'remove' ? 1 : 0,
    ...(edit.kind === 'remove' ? [] : [edit.point]),
  );
  const next = replacePathPoints(p, id, points, context);
  const vertexMap = path.points.map((_, i) =>
    edit.kind === 'remove'
      ? i === index
        ? null
        : i > index
          ? i - 1
          : i
      : i >= index
        ? i + 1
        : i,
  );
  const segmentMap = Array.from({ length: segments }, (_, i) => {
    if (edit.kind === 'insert')
      return i === edit.segment ? [i, i + 1] : [i > edit.segment ? i + 1 : i];
    if (edit.kind === 'extend') return [edit.end === 'start' ? i + 1 : i];
    const a = vertexMap[i],
      b = vertexMap[(i + 1) % count];
    if (a !== null && b !== null) return [a];
    if (!path.closed && (index === 0 || index === count - 1)) return [];
    return [(index - 1 + points.length) % points.length];
  });
  return {
    project: next,
    vertexMap,
    segmentMap,
    warnings:
      edit.kind === 'remove'
        ? [
            'O nó removido e os segmentos adjacentes foram remapeados; confira cotas independentes posicionadas manualmente.',
          ]
        : [],
  };
}

/** Common geometry and permission gate for topology and dimension edits. */
function replacePathPoints(
  p: Project,
  id: string,
  points: Point[],
  context: { layerContext?: string; scopeDetailId?: string },
  localPoints?: Point[],
) {
  const path = editablePath(p, id);
  for (const v of points) point.parse(v);
  if (points.length < (path.closed ? 3 : 2))
    throw new Error(
      path.closed
        ? 'Mantenha ao menos três vértices no contorno fechado.'
        : 'Mantenha ao menos dois vértices.',
    );
  if (points.length > 500) throw new Error('Limite de vértices excedido.');
  for (let i = 1; i < points.length + (path.closed ? 1 : 0); i++)
    if (distance(points[i - 1], points[i % points.length]) < 0.01)
      throw new Error('Vértices consecutivos não podem coincidir.');
  let next = path.bar
    ? {
        ...p,
        bars: p.bars.map((b) =>
          b.id === id
            ? { ...b, points: localPoints ?? points.map((v) => local(v, b)) }
            : b,
        ),
      }
    : {
        ...p,
        polylines: p.polylines.map((l) => (l.id === id ? { ...l, points } : l)),
      };
  if (path.bar) {
    const errors = geometry(next.bars.find((b) => b.id === id)!).errors;
    if (errors.length) throw new Error(errors.join(' '));
  }
  next = completeOwnership(next);
  assertLayerEdit(p, next, context.layerContext ?? 'model');
  assertVisibilityEdit(p, next, context.layerContext ?? 'model');
  if (context.scopeDetailId) assertDetailEdit(p, next, context.scopeDetailId);
  return next;
}

export function vertexEditAt(
  p: Project,
  id: string,
  mode: 'insert' | 'extend' | 'remove',
  at: Point,
  end: 'start' | 'end' = 'end',
): VertexEdit {
  const path = editablePath(p, id);
  if (mode === 'extend') return { kind: 'extend', end, point: at };
  if (mode === 'remove') {
    const vertex = path.points.reduce(
      (best, v, i) =>
        distance(v, at) < distance(path.points[best], at) ? i : best,
      0,
    );
    return { kind: 'remove', vertex };
  }
  let segment = 0,
    best = Infinity;
  for (let i = 0; i < path.points.length - (path.closed ? 0 : 1); i++) {
    const d = distance(
      at,
      nearest(at, path.points[i], path.points[(i + 1) % path.points.length]),
    );
    if (d < best) {
      best = d;
      segment = i;
    }
  }
  return { kind: 'insert', segment, point: at };
}
