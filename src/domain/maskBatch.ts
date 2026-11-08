import {
  completeOwnership,
  moveObjectsToDetail,
  validateHierarchy,
} from './hierarchy';
import { decodeProject } from './model';
import { layerState, objectState } from './layerProfiles';
import { objectHidden } from './visibility';
import { uid, type Mask, type Project } from './types';

export const MASK_LIMIT = 20;
export const PROJECT_BYTE_LIMIT = 100 * 1024 * 1024;
export type MaskBatchContext = { key: string; scopeDetailId?: string };
export type MaskAssignment = { mask: Mask; detailId: string };
/** UTF-8 bytes of the indented JSON emitted by Save project, not character count. */
export function maskProjectBytes(p: unknown) {
  return new TextEncoder().encode(JSON.stringify(p, null, 2)).byteLength;
}
function destination(p: Project, id: string, context: MaskBatchContext) {
  if (context.key.startsWith('sheet:'))
    throw new Error(
      'Abra o desenho da vista antes de importar ou associar máscaras.',
    );
  if (!p.hierarchy.details.some((d) => d.id === id))
    throw new Error('Detalhamento de destino inexistente.');
  if (context.scopeDetailId && id !== context.scopeDetailId)
    throw new Error(
      'Saia explicitamente da edição isolada para trabalhar em outros detalhamentos.',
    );
}
function validateResult(p: Project) {
  if (p.masks.length > MASK_LIMIT)
    throw new Error('Limite de 20 máscaras por projeto. Retire itens do lote.');
  if (maskProjectBytes(p) > PROJECT_BYTE_LIMIT)
    throw new Error(
      'O projeto normalizado excederia 100 MB. Simplifique ou divida as referências.',
    );
  validateHierarchy(p);
  // Uses the same schema, limits and reference validation as save/reopen.
  decodeProject(JSON.stringify(p));
  return p;
}
/** Only new hierarchy nodes are accepted from the isolated preparation draft. */
export function importMaskBatch(
  base: Project,
  draft: Project,
  items: MaskAssignment[],
  context: MaskBatchContext,
): Project {
  if (!items.length) throw new Error('Escolha ao menos um arquivo válido.');
  if (base.masks.length + items.length > MASK_LIMIT)
    throw new Error('Limite de 20 máscaras por projeto. Retire itens do lote.');
  if (draft.id !== base.id) throw new Error('O projeto da preparação mudou.');
  const h = base.hierarchy,
    dh = draft.hierarchy;
  if (
    context.scopeDetailId &&
    ['floors', 'elements', 'details', 'drawings'].some(
      (key) =>
        JSON.stringify(h[key as keyof typeof h]) !==
        JSON.stringify(dh[key as keyof typeof dh]),
    )
  )
    throw new Error('Abra o modelo geral para preparar novos destinos.');
  for (const key of ['floors', 'elements', 'details', 'drawings'] as const)
    for (const node of h[key])
      if (
        JSON.stringify(dh[key].find((n) => n.id === node.id)) !==
        JSON.stringify(node)
      )
        throw new Error(
          'A preparação só pode acrescentar destinos, sem alterar os existentes.',
        );
  const nextHierarchy = {
    ...h,
    floors: dh.floors,
    elements: dh.elements,
    details: dh.details,
    drawings: dh.drawings,
    objectDetails: { ...h.objectDetails },
  };
  let next = { ...base, hierarchy: nextHierarchy, masks: [...base.masks] };
  const ids = new Set(base.masks.map((m) => m.id));
  for (const { mask, detailId } of items) {
    destination(next, detailId, context);
    if (ids.has(mask.id))
      throw new Error('ID de máscara duplicado; releia o arquivo.');
    ids.add(mask.id);
    if (!['DXF', 'DWG'].includes(mask.format))
      throw new Error('Use referências DXF/DWG neste lote.');
    if (!Number.isFinite(mask.scale) || mask.scale <= 0)
      throw new Error('Informe uma escala positiva.');
    if (!mask.name.trim() || mask.name.trim().length > 200)
      throw new Error('Nome da referência: informe de 1 a 200 caracteres.');
    next.masks.push({ ...mask, name: mask.name.trim() });
    nextHierarchy.objectDetails[mask.id] = detailId;
  }
  next = completeOwnership(next);
  for (const { mask, detailId } of items)
    assertMaskDestination(next, mask.id, detailId, context);
  return validateResult(next);
}
function drawingKey(p: Project, owner: string) {
  const d = p.hierarchy.drawings.find((d) => d.detailId === owner);
  return d ? `drawing:${d.id}` : 'model';
}
function assertMaskDestination(
  p: Project,
  id: string,
  owner: string,
  context: MaskBatchContext,
) {
  const mask = p.masks.find((m) => m.id === id)!;
  for (const key of new Set([context.key, drawingKey(p, owner)])) {
    if (!objectState(p, key, mask).editable || objectHidden(p, key, id))
      throw new Error(
        `Máscara ${mask.name}: layer/contexto protegido ou objeto oculto. Abra e libere o contexto explicitamente.`,
      );
    for (const q of mask.primitives)
      if (q.layerId && !layerState(p, key, q.layerId).editable)
        throw new Error(`Máscara ${mask.name}: layer de entidade protegido.`);
  }
}
/** Moving changes only ownership. Copying is explicit and creates an independent reference. */
export function associateMasks(
  base: Project,
  ids: string[],
  detailId: string,
  mode: 'move' | 'copy',
  context: MaskBatchContext,
): Project {
  destination(base, detailId, context);
  if (mode === 'copy' && base.masks.length + ids.length > MASK_LIMIT)
    throw new Error('Limite de 20 máscaras por projeto.');
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Escolha máscaras distintas para associar.');
  const masks = ids.map((id) => {
    const mask = base.masks.find((m) => m.id === id);
    if (!mask) throw new Error('Máscara inexistente.');
    const owner = base.hierarchy.objectDetails[id];
    destination(base, owner, context);
    if (
      !mask.visible ||
      mask.opacity === 0 ||
      Object.values(mask.layers).some((v) => !v)
    )
      throw new Error(
        `Máscara ${mask.name} oculta ou com camadas desligadas. Reexiba-a antes de reassociar.`,
      );
    assertMaskDestination(base, id, owner, context);
    assertMaskDestination(base, id, detailId, context);
    return mask;
  });
  let next: Project;
  if (mode === 'move') next = moveObjectsToDetail(base, ids, detailId);
  else {
    const copies = masks.map(
      (m): Mask => ({
        ...structuredClone(m),
        id: uid(),
        name: `${m.name} (cópia)`.slice(0, 200),
        primitives: m.primitives.map((q) => ({
          ...structuredClone(q),
          ...(q.id ? { id: uid() } : {}),
        })),
      }),
    );
    next = {
      ...base,
      masks: [...base.masks, ...copies],
      hierarchy: {
        ...base.hierarchy,
        objectDetails: {
          ...base.hierarchy.objectDetails,
          ...Object.fromEntries(copies.map((m) => [m.id, detailId])),
        },
      },
    };
  }
  return validateResult(completeOwnership(next));
}
