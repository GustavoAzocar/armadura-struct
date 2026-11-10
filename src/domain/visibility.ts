import { changedSymbolGeometry } from './symbolRender';
import type { Project } from './types';
import { layerObjects } from './layers';
import {
  ensureProfiles,
  layerProjection,
  objectState,
  layerState,
} from './layerProfiles';
import {
  visibilitySchema,
  validVisibilityContext,
  type ObjectVisibility,
} from './visibilitySchema';
export const visibilityState = (p: Project, key: string): ObjectVisibility =>
  p.layerEnvironment?.contexts[key]?.visibility ?? {
    hiddenIds: [],
    showHidden: false,
    printHidden: false,
  };
export function visibilityObjects(p: Project, key: string) {
  const drawingId = key.startsWith('view:')
    ? p.hierarchy.placements.find((v) => key === `view:${v.id}`)?.drawingId
    : key.startsWith('drawing:')
      ? key.slice(8)
      : undefined;
  const detailId = p.hierarchy.drawings.find(
    (d) => d.id === drawingId,
  )?.detailId;
  return layerObjects(p).filter(
    (o) => !detailId || p.hierarchy.objectDetails[o.id] === detailId,
  );
}
export function objectHidden(p: Project, key: string, id: string) {
  const v = visibilityState(p, key);
  return (
    v.hiddenIds.includes(id) || !!(v.isolation && !v.isolation.ids.includes(id))
  );
}
export function visibilityReasons(
  p: Project,
  key: string,
  id: string,
): string[] {
  const o = layerObjects(p).find((o) => o.id === id);
  if (!o) return ['Objeto excluído ou inexistente'];
  const v = visibilityState(p, key),
    reasons: string[] = [];
  if (v.hiddenIds.includes(id)) reasons.push('Ocultação do objeto');
  if (v.isolation && !v.isolation.ids.includes(id))
    reasons.push('Fora do isolamento');
  if (!objectState(p, key, o).visible) reasons.push('Layer desligado');
  if ('primitives' in o) {
    if (!o.visible) reasons.push('Máscara desligada');
    if (
      o.primitives.some(
        (q) =>
          o.layers[q.layer] === false ||
          (q.layerId && !layerState(p, key, q.layerId).visible),
      )
    )
      reasons.push('Layers de origem desligados (máscara parcial ou total)');
  }
  return reasons;
}
export function canCaptureObject(p: Project, key: string, id: string) {
  const o = layerObjects(p).find((o) => o.id === id);
  return !!o && !objectHidden(p, key, id) && objectState(p, key, o).capture;
}
export function setVisibility(
  p: Project,
  key: string,
  patch: Partial<ObjectVisibility>,
): Project {
  if (!validVisibilityContext(p, key))
    throw new Error('Escolha um desenho ou uma vista existente.');
  const visibility = visibilitySchema.parse({
    ...visibilityState(p, key),
    ...patch,
  });
  const live = new Set(visibilityObjects(p, key).map((o) => o.id));
  if (
    [...visibility.hiddenIds, ...(visibility.isolation?.ids ?? [])].some(
      (id) => !live.has(id),
    )
  )
    throw new Error('Objeto inexistente ou fora do contexto da vista.');
  p = ensureProfiles(p);
  const e = p.layerEnvironment!,
    c = e.contexts[key];
  return {
    ...p,
    layerEnvironment: {
      ...e,
      contexts: {
        ...e.contexts,
        [key]: { ...c, states: c?.states ?? {}, visibility },
      },
    },
  };
}
function checked(p: Project, key: string, ids: string[]) {
  if (!ids.length) throw new Error('Selecione ao menos um objeto.');
  const live = new Set(visibilityObjects(p, key).map((o) => o.id));
  if (ids.some((id) => !live.has(id)))
    throw new Error('Objeto inexistente ou fora do contexto da vista.');
  return [...new Set(ids)];
}
export function hideObjects(p: Project, key: string, ids: string[]) {
  return setVisibility(p, key, {
    hiddenIds: [
      ...new Set([
        ...visibilityState(p, key).hiddenIds,
        ...checked(p, key, ids),
      ]),
    ],
  });
}
export function isolateObjects(p: Project, key: string, ids: string[]) {
  return setVisibility(p, key, { isolation: { ids: checked(p, key, ids) } });
}
export function endObjectIsolation(p: Project, key: string) {
  return setVisibility(p, key, { isolation: undefined });
}
export function showAllObjects(p: Project, key: string) {
  return setVisibility(p, key, { hiddenIds: [], isolation: undefined });
}
export function restoreObjects(p: Project, key: string, ids: string[]) {
  const chosen = checked(p, key, ids),
    v = visibilityState(p, key);
  return setVisibility(p, key, {
    hiddenIds: v.hiddenIds.filter((id) => !chosen.includes(id)),
    isolation: v.isolation
      ? { ids: [...new Set([...v.isolation.ids, ...chosen])] }
      : undefined,
  });
}
/** Read-only projection; full definitions remain available for linked graphics and RA. */
export function visibilityProjection(
  p: Project,
  key: string,
  mode: 'visible' | 'capture' | 'print',
): Project {
  const base = layerProjection(
    p,
    key,
    mode === 'capture' ? 'capture' : 'visible',
  );
  const keep = (o: { id: string }) =>
    (mode === 'print' && visibilityState(p, key).printHidden) ||
    !objectHidden(p, key, o.id);
  return {
    ...base,
    bars: base.bars.filter(keep),
    details: base.details.filter(keep),
    annotations: base.annotations.filter(keep),
    polylines: base.polylines.filter(keep),
    masks: base.masks.filter(keep),
    symbolInstances: (base.symbolInstances ?? []).filter(keep),
  };
}
/** Ghosts are never capturable/editable or passed to an exporter. */
export function visibilityReview(p: Project, key: string): Project {
  const keep = (o: { id: string }) =>
    visibilityReasons(p, key, o.id).length > 0;
  return {
    ...p,
    bars: p.bars.filter(keep),
    details: p.details.filter(keep),
    annotations: p.annotations.filter(keep),
    polylines: p.polylines.filter(keep),
    symbolInstances: (p.symbolInstances ?? []).filter(keep),
    masks: p.masks.filter(keep).map((m) => ({
      ...m,
      primitives:
        objectHidden(p, key, m.id) ||
        !m.visible ||
        !objectState(p, key, m).visible
          ? m.primitives
          : m.primitives.filter(
              (q) =>
                m.layers[q.layer] === false ||
                (q.layerId && !layerState(p, key, q.layerId).visible),
            ),
      visible: true,
      layers: {},
    })),
  };
}
export function assertVisibilityEdit(
  before: Project,
  after: Project,
  key: string,
) {
  if (before.id !== after.id) return;
  const changedSymbols = changedSymbolGeometry(before, after);
  const current = new Map(layerObjects(after).map((o) => [o.id, o]));
  for (const o of layerObjects(before))
    if (
      objectHidden(before, key, o.id) &&
      (JSON.stringify(o) !== JSON.stringify(current.get(o.id)) ||
        ('definitionId' in o && changedSymbols.has(o.definitionId)))
    )
      throw new Error(
        'Objeto oculto ou fora do isolamento: recupere-o nesta vista antes de editar.',
      );
}
