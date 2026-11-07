import { z } from 'zod';
import type { Project } from './types';
const ids = z
  .array(z.string().min(1).max(200))
  .max(100000)
  .refine(
    (v) => new Set(v).size === v.length,
    'IDs de visibilidade duplicados.',
  );
export const visibilitySchema = z
  .object({
    hiddenIds: ids,
    isolation: z.object({ ids }).strict().optional(),
    showHidden: z.boolean(),
    printHidden: z.boolean(),
  })
  .strict();
export type ObjectVisibility = z.infer<typeof visibilitySchema>;
export function validVisibilityContext(p: Project, key: string) {
  return (
    key === 'model' ||
    (key.startsWith('drawing:') &&
      p.hierarchy.drawings.some((d) => key === `drawing:${d.id}`)) ||
    (key.startsWith('view:') &&
      p.hierarchy.placements.some((d) => key === `view:${d.id}`))
  );
}
/** Presentation references are removed with their objects/views, and return on undo. */
export function pruneVisibility(p: Project): Project {
  if (!p.layerEnvironment) return p;
  const live = new Set(
    [...p.bars, ...p.details, ...p.annotations, ...p.polylines, ...p.masks].map(
      (o) => o.id,
    ),
  );
  let changed = false;
  const contexts = Object.fromEntries(
    Object.entries(p.layerEnvironment.contexts).map(([key, c]) => {
      const v = c.visibility;
      if (!v) return [key, c];
      const drawingId = key.startsWith('view:')
        ? p.hierarchy.placements.find((v) => key === `view:${v.id}`)?.drawingId
        : key.startsWith('drawing:')
          ? key.slice(8)
          : undefined;
      const detailId = p.hierarchy.drawings.find(
        (d) => d.id === drawingId,
      )?.detailId;
      const keep = (id: string) =>
        live.has(id) &&
        (!detailId || p.hierarchy.objectDetails[id] === detailId);
      const visibility = validVisibilityContext(p, key)
        ? {
            ...v,
            hiddenIds: v.hiddenIds.filter(keep),
            isolation: v.isolation
              ? { ids: v.isolation.ids.filter(keep) }
              : undefined,
          }
        : undefined;
      if (JSON.stringify(v) === JSON.stringify(visibility)) return [key, c];
      changed = true;
      return [key, { ...c, visibility }];
    }),
  );
  return changed
    ? { ...p, layerEnvironment: { ...p.layerEnvironment, contexts } }
    : p;
}
